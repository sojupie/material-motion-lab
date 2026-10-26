package web

import (
	"encoding/json"
	"github.com/sojupie/ui-motion/internal/analysis"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServerRenderedControlsAndAPI(t *testing.T) {
	dir := t.TempDir()
	id := "c6988398-16fd-4258-8eb9-693c03e10ce4"
	store := analysis.Store{Dir: dir}
	folder, _ := store.Folder(id)
	os.MkdirAll(folder, 0700)
	p := &analysis.Project{Schema: 1, ID: id, Name: `A <script>alert(1)</script> & B.mp4`, Times: []float64{0, 17, 34}, Samples: []analysis.Sample{}, Anchors: []analysis.Anchor{}}
	if e := store.Save(p); e != nil {
		t.Fatal(e)
	}
	server := (&Server{Store: store, Dist: dir}).Handler()
	get := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		server.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	page := get("/")
	if page.Code != 200 {
		t.Fatal(page.Code, page.Body.String())
	}
	body := page.Body.String()
	for _, text := range []string{"data-navigation-modal", "data-field-combo", "md-outlined-text-field", "field-option-template", "recording-item-template", "/assets/main.js", "A &lt;script&gt;"} {
		if !strings.Contains(body, text) {
			t.Fatal("missing server markup", text)
		}
	}
	if strings.Contains(body, "<script>alert(1)</script>") {
		t.Fatal("filename was not escaped")
	}
	var saved map[string]any
	if e := json.Unmarshal(get("/api/projects/"+id).Body.Bytes(), &saved); e != nil {
		t.Fatal(e)
	}
	if settings, ok := saved["settings"].(map[string]any); !ok || len(settings) != 0 {
		t.Fatal("untracked settings must be an empty object", saved["settings"])
	}
	list := get("/api/projects")
	var entries []Entry
	if e := json.Unmarshal(list.Body.Bytes(), &entries); e != nil || len(entries) != 1 || entries[0].ID != id {
		t.Fatal(list.Body.String(), e)
	}
	for _, path := range []string{"/api/projects/invalid", "/api/projects/" + id + "/frames/99"} {
		if w := get(path); w.Code != 400 {
			t.Fatal(path, w.Code)
		}
	}
	for _, test := range []struct {
		body string
		want int
	}{{`{"frame":2}`, 200}, {`{"frame":9}`, 400}, {`{"frame":-1}`, 400}, {`{"frame":1,"unknown":true}`, 400}, {`{"frame":1} {"frame":2}`, 400}} {
		w := httptest.NewRecorder()
		server.ServeHTTP(w, httptest.NewRequest("POST", "/api/projects/"+id+"/zero", strings.NewReader(test.body)))
		if w.Code != test.want {
			t.Fatal(test, w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/projects/"+id+"/zero", strings.NewReader(`{"frame":1}`))
	r.Header.Set("Origin", "https://other.example")
	server.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-origin mutation accepted")
	}
	if w = get("/api/projects/00000000-0000-0000-0000-000000000000"); w.Code != 404 {
		t.Fatal(w.Code)
	}
	if _, e := os.Stat(filepath.Join(folder, "project.json")); e != nil {
		t.Fatal(e)
	}
}
