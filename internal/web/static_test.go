package web

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticExportHasNoProjectStoreOrAbsoluteToolAssets(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"main.js", "main.css"} {
		if err := os.WriteFile(filepath.Join(dir, "assets", name), []byte("test"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := ExportStatic(dir); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{`src="/assets/`, `src="/material/`, `href="/assets/`} {
		if strings.Contains(string(body), bad) {
			t.Fatal("absolute tool asset", bad)
		}
	}
	if !strings.Contains(string(body), `src="./assets/main.js?v=`) {
		t.Fatal("missing versioned relative entry")
	}
	for _, name := range []string{"site-logo.svg", "site-logo.png"} {
		if _, err = os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), `href="./`+name+`"`) {
			t.Fatal("missing relative icon", name)
		}
	}
	if _, err = os.Stat(filepath.Join(dir, "references.json")); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(dir, "projects")); !os.IsNotExist(err) {
		t.Fatal("static export touched project storage")
	}
}

func TestStaticHandlerRejectsUploadsAndHasNoProjectAPI(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("Material Motion Lab"), 0644); err != nil {
		t.Fatal(err)
	}
	h := StaticHandler(dir)
	for _, test := range []struct {
		method, path string
		status       int
	}{{"GET", "/", 200}, {"POST", "/api/import", 405}, {"PUT", "/api/workspaces/test", 405}, {"DELETE", "/api/workspaces/test", 405}, {"GET", "/api/workspaces", 404}} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(test.method, test.path, nil))
		if r.Code != test.status {
			t.Errorf("%s %s: got %d", test.method, test.path, r.Code)
		}
	}
}

func TestStaticHandlerNegotiatesCompressedAssets(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{"app.css": "plain", "app.css.gz": "gzip bytes", "app.css.br": "brotli bytes"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	handler := StaticHandler(dir)
	for _, test := range []struct{ accept, encoding, body string }{{"", "", "plain"}, {"gzip", "gzip", "gzip bytes"}, {"gzip, br", "br", "brotli bytes"}, {"br;q=0, gzip", "gzip", "gzip bytes"}, {"gzip;q=0", "", "plain"}} {
		request := httptest.NewRequest("GET", "/app.css", nil)
		request.Header.Set("Accept-Encoding", test.accept)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 200 || response.Header().Get("Content-Encoding") != test.encoding || response.Body.String() != test.body {
			t.Errorf("%s: %d %s %s", test.accept, response.Code, response.Header().Get("Content-Encoding"), response.Body.String())
		}
		if !strings.HasPrefix(response.Header().Get("Content-Type"), "text/css") || response.Header().Get("Vary") != "Accept-Encoding" {
			t.Fatal(response.Header())
		}
	}
}
