package web

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/sojupie/ui-motion/internal/motion"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
)

// ExportStatic writes the web shell without opening a project store or exposing an API.
func ExportStatic(dir string) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	if err := verifyComponentAssets(dir); err != nil {
		return err
	}
	var page bytes.Buffer
	hash := sha256.New()
	for _, name := range []string{"main.js", "main.css"} {
		data, e := os.ReadFile(filepath.Join(dir, "assets", name))
		if e != nil {
			return e
		}
		hash.Write(data)
	}
	if err := Page(nil, fmt.Sprintf("%x", hash.Sum(nil)[:8])).Render(context.Background(), &page); err != nil {
		return err
	}
	html := page.String()
	for _, prefix := range []string{"/assets/", "/material/", "/site-logo.svg", "/site-logo.png", "/roboto-latin.woff2"} {
		html = strings.ReplaceAll(html, `="`+prefix, `=".`+prefix)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(html), 0644); err != nil {
		return err
	}
	refs, err := json.Marshal(motion.ReferencePresets())
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(dir, "references.json"), refs, 0644); err != nil {
		return err
	}
	for name, target := range map[string]string{"logo.svg": "site-logo.svg", "logo-250x250.png": "site-logo.png", "logo-250x250.webp": "site-logo.webp"} {
		data, err := logoFiles.ReadFile(name)
		if err != nil {
			return err
		}
		if err = os.WriteFile(filepath.Join(dir, target), data, 0644); err != nil {
			return err
		}
	}
	return nil
}

// StaticHandler has no project store and accepts no uploads or mutation requests.
func StaticHandler(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			http.Error(w, "Static application", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Add("Vary", "Accept-Encoding")
		name := r.URL.Path
		if strings.HasSuffix(name, "/") {
			name += "index.html"
		}
		if r.Header.Get("Range") == "" {
			for _, candidate := range []struct{ encoding, suffix string }{{"br", ".br"}, {"gzip", ".gz"}} {
				if !acceptsEncoding(r.Header.Get("Accept-Encoding"), candidate.encoding) {
					continue
				}
				file, err := http.Dir(dir).Open(name + candidate.suffix)
				if err != nil {
					continue
				}
				info, err := file.Stat()
				if err != nil || info.IsDir() {
					file.Close()
					continue
				}
				w.Header().Set("Content-Encoding", candidate.encoding)
				w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
				if kind := mime.TypeByExtension(filepath.Ext(name)); kind != "" {
					w.Header().Set("Content-Type", kind)
				}
				http.ServeContent(w, r, name, info.ModTime(), file)
				file.Close()
				return
			}
		}
		files.ServeHTTP(w, r)
	})
}

func acceptsEncoding(header, encoding string) bool {
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		if fields[0] != encoding {
			continue
		}
		for _, parameter := range fields[1:] {
			if strings.HasPrefix(strings.TrimSpace(parameter), "q=") {
				quality, err := strconv.ParseFloat(strings.TrimPrefix(strings.TrimSpace(parameter), "q="), 64)
				return err == nil && quality > 0 && quality <= 1
			}
		}
		return true
	}
	return false
}

// Reject a stale import even when callers bypass make/npm's normal build order.
func verifyComponentAssets(dir string) error {
	data, err := os.ReadFile(filepath.Join(dir, "token-source.json"))
	if err != nil {
		return fmt.Errorf("component assets: run npm run build before exporting: %w", err)
	}
	var imported struct {
		ComponentManifest ComponentManifest `json:"componentManifest"`
		Outputs           map[string]string `json:"outputs"`
	}
	if err = json.Unmarshal(data, &imported); err != nil {
		return err
	}
	current, err := CollectComponentAssets(context.Background(), Page(nil))
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(current, imported.ComponentManifest) {
		return fmt.Errorf("component assets differ from the compiled page; run npm run build before exporting")
	}
	if len(imported.Outputs) == 0 {
		return fmt.Errorf("missing component output hashes; run npm run build before exporting")
	}
	for name, want := range imported.Outputs {
		if !filepath.IsLocal(name) {
			return fmt.Errorf("invalid component asset path %q", name)
		}
		data, e := os.ReadFile(filepath.Join(dir, name))
		if e != nil {
			return e
		}
		if fmt.Sprintf("%x", sha256.Sum256(data)) != want {
			return fmt.Errorf("component asset %s changed after import; run npm run build", name)
		}
	}
	return nil
}
