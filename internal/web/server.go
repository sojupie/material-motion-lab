package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/sojupie/ui-motion/internal/analysis"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Server struct {
	Store analysis.Store
	Dist  string
	locks sync.Map
}
type Entry struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	modified time.Time
}

func (s *Server) entries() ([]Entry, error) {
	files, e := filepath.Glob(filepath.Join(s.Store.Dir, "*", "project.json"))
	if e != nil {
		return nil, e
	}
	entries := []Entry{}
	for _, file := range files {
		id := filepath.Base(filepath.Dir(file))
		p, e := s.Store.Load(id)
		if e != nil {
			return nil, e
		}
		info, e := os.Stat(file)
		if e != nil {
			return nil, e
		}
		entries = append(entries, Entry{id, p.Name, info.ModTime()})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].modified.After(entries[j].modified) })
	return entries, nil
}
func decode(r *http.Request, dest any) error {
	d := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	d.DisallowUnknownFields()
	if e := d.Decode(dest); e != nil {
		return fmt.Errorf("invalid request: %w", e)
	}
	var extra any
	if e := d.Decode(&extra); e != io.EOF {
		return fmt.Errorf("request must contain one JSON object")
	}
	return nil
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	api := func(pattern string, fn func(http.ResponseWriter, *http.Request) (any, error)) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "GET" && r.Header.Get("Origin") != "" {
				origin := r.Header.Get("Origin")
				if origin != "http://"+r.Host && origin != "https://"+r.Host {
					http.Error(w, "cross-origin request rejected", http.StatusForbidden)
					return
				}
			}
			if id := r.PathValue("id"); id != "" {
				v, _ := s.locks.LoadOrStore(id, &sync.Mutex{})
				lock := v.(*sync.Mutex)
				lock.Lock()
				defer lock.Unlock()
			}
			result, e := fn(w, r)
			if e != nil {
				status := 400
				if errors.Is(e, os.ErrNotExist) {
					status = 404
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				json.NewEncoder(w).Encode(map[string]string{"detail": e.Error()})
				return
			}
			if result != nil {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(result)
			}
		})
	}
	api("GET /api/projects", func(w http.ResponseWriter, r *http.Request) (any, error) { return s.entries() })
	api("POST /api/import", func(w http.ResponseWriter, r *http.Request) (any, error) {
		r.Body = http.MaxBytesReader(w, r.Body, (256<<20)+(1<<20))
		if e := r.ParseMultipartForm(8 << 20); e != nil {
			return nil, fmt.Errorf("cannot read upload (maximum 256 MB): %w", e)
		}
		defer r.MultipartForm.RemoveAll()
		file, header, e := r.FormFile("file")
		if e != nil {
			return nil, e
		}
		defer file.Close()
		ext := strings.ToLower(filepath.Ext(header.Filename))
		if !strings.Contains("|.mp4|.mov|.webm|.mkv|.avi|.gif|", "|"+ext+"|") {
			return nil, fmt.Errorf("choose an MP4, MOV, WebM, MKV, AVI or GIF video")
		}
		if header.Size > 256<<20 {
			return nil, fmt.Errorf("video exceeds 256 MB")
		}
		temp, e := os.CreateTemp("", "ui-motion-*"+ext)
		if e != nil {
			return nil, e
		}
		defer os.Remove(temp.Name())
		_, e = io.Copy(temp, file)
		closeErr := temp.Close()
		if e != nil {
			return nil, e
		}
		if closeErr != nil {
			return nil, closeErr
		}
		return s.Store.Import(temp.Name(), header.Filename)
	})
	api("GET /api/projects/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return s.Store.Load(r.PathValue("id")) })
	api("GET /api/projects/{id}/frames/{frame}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		frame, e := strconv.Atoi(r.PathValue("frame"))
		if e != nil {
			return nil, e
		}
		path, e := s.Store.Frame(r.PathValue("id"), frame)
		if e != nil {
			return nil, e
		}
		http.ServeFile(w, r, path)
		return nil, nil
	})
	api("GET /api/projects/{id}/workspace", func(w http.ResponseWriter, r *http.Request) (any, error) {
		if _, e := s.Store.Load(r.PathValue("id")); e != nil {
			return nil, e
		}
		result, e := s.Store.LoadWorkspace(r.PathValue("id"))
		if errors.Is(e, os.ErrNotExist) {
			return (*analysis.Workspace)(nil), nil
		}
		return result, e
	})
	api("PUT /api/projects/{id}/workspace", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var payload analysis.Workspace
		if e := decode(r, &payload); e != nil {
			return nil, e
		}
		return s.Store.SaveWorkspace(r.PathValue("id"), &payload)
	})

	api("POST /api/projects/{id}/track", func(w http.ResponseWriter, r *http.Request) (any, error) {
		payload := struct {
			Region    []float64          `json:"region"`
			Start     int                `json:"start"`
			End       *int               `json:"end"`
			Anchors   *[]analysis.Anchor `json:"anchors"`
			Search    int                `json:"search"`
			Threshold float64            `json:"threshold"`
			Method    string             `json:"method"`
		}{Search: 60, Threshold: .65}
		if e := decode(r, &payload); e != nil {
			return nil, e
		}
		if payload.Anchors != nil {
			for _, anchor := range *payload.Anchors {
				if anchor.Frame < 0 {
					return nil, fmt.Errorf("anchor frame must be nonnegative")
				}
			}
		}
		return s.Store.TrackMethod(r.PathValue("id"), payload.Region, payload.Start, payload.End, payload.Anchors, payload.Search, payload.Threshold, payload.Method)
	})
	api("GET /api/references", func(w http.ResponseWriter, r *http.Request) (any, error) { return analysis.ReferencePresets(), nil })
	api("POST /api/references/validate", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var ref analysis.Reference
		if e := decode(r, &ref); e != nil {
			return nil, e
		}
		if e := ref.Validate(); e != nil {
			return nil, e
		}
		return ref, nil
	})
	api("POST /api/projects/{id}/measure", func(w http.ResponseWriter, r *http.Request) (any, error) {
		payload := struct {
			Axis      string              `json:"axis"`
			Start     int                 `json:"start"`
			End       int                 `json:"end"`
			Curve     analysis.Curve      `json:"curve"`
			Reference *analysis.Reference `json:"reference"`
			Duration  float64             `json:"duration"`
			Fit       bool                `json:"fit"`
		}{Axis: "x", Curve: analysis.Curve{.2, 0, 0, 1}, Duration: 300}
		if e := decode(r, &payload); e != nil {
			return nil, e
		}
		if payload.Reference != nil {
			return s.Store.MeasureReference(r.PathValue("id"), payload.Axis, payload.Start, payload.End, *payload.Reference, payload.Duration, payload.Fit)
		}
		return s.Store.Measure(r.PathValue("id"), payload.Axis, payload.Start, payload.End, payload.Curve, payload.Duration, payload.Fit)
	})

	api("POST /api/projects/{id}/zero", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var payload struct {
			Frame int `json:"frame"`
		}
		if e := decode(r, &payload); e != nil {
			return nil, e
		}
		return s.Store.Zero(r.PathValue("id"), payload.Frame)
	})
	api("POST /api/projects/{id}/comparison", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var payload struct {
			Reference string `json:"reference"`
			Zero      int    `json:"zero"`
		}
		if e := decode(r, &payload); e != nil {
			return nil, e
		}
		return s.Store.Compare(r.PathValue("id"), payload.Reference, payload.Zero)
	})
	api("POST /api/projects/{id}/export/{kind}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var o analysis.VideoOptions
		if e := decode(r, &o); e != nil {
			return nil, e
		}
		var path string
		var e error
		switch r.PathValue("kind") {
		case "video":
			path, e = s.Store.VideoWithOptions(r.PathValue("id"), o)
		case "chart":
			path, e = s.Store.Chart(r.PathValue("id"), o.Chart)
		case "preview":
			path, e = s.Store.Preview(r.PathValue("id"), o)
		default:
			return nil, fmt.Errorf("export kind must be chart, video or preview")
		}
		if e != nil {
			return nil, e
		}
		defer os.Remove(path)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(path)))
		http.ServeFile(w, r, path)
		return nil, nil
	})
	api("GET /api/projects/{id}/download/{kind}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		id := r.PathValue("id")
		var path string
		var e error
		switch r.PathValue("kind") {
		case "json":
			_, e = s.Store.Load(id)
			if e == nil {
				var dir string
				dir, e = s.Store.Folder(id)
				path = filepath.Join(dir, "project.json")
			}
		case "csv":
			path, e = s.Store.CSV(id)
		case "video":
			axis := r.URL.Query().Get("axis")
			if axis == "" {
				axis = "x"
			}
			path, e = s.Store.Video(id, axis)
		default:
			e = os.ErrNotExist
		}
		if e != nil {
			return nil, e
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(path)))
		http.ServeFile(w, r, path)
		return nil, nil
	})
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		entries, e := s.entries()
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		Page(entries).Render(r.Context(), w)
	})
	mux.Handle("GET /assets/", http.FileServer(http.Dir(s.Dist)))
	mux.Handle("GET /material/", http.FileServer(http.Dir(s.Dist)))
	for _, name := range []string{"material.css", "roboto-latin.woff2", "OFL.txt", "token-source.json"} {
		mux.Handle("GET /"+name, http.FileServer(http.Dir(s.Dist)))
	}
	return mux
}
