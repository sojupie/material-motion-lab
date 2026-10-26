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
	for _, text := range []string{"data-navigation-modal", "data-field-combo", "md-outlined-text-field", "field-option-template", "recording-item-template", "/assets/main.js", "A &lt;script&gt;", `id="timeline"`, `id="playhead-time"`, `id="inspector-title"`, "Track selected range", "Mark sync point", "Viewer zoom", `id="reference-controls"`, `id="graph-fit"`, `id="graph-fit-end"`, `id="graph-zoom-in"`, `id="graph-scale-info"`, `aria-label="Clip alignment"`, `<h3>Export</h3>`, `id="playback-speed"`, `id="playback-loop"`, `id="playback-start"`, `id="playback-end"`, `id="playback-reset"`} {
		if !strings.Contains(body, text) {
			t.Fatal("missing server markup", text)
		}
	}
	if strings.Contains(body, "<script>alert(1)</script>") {
		t.Fatal("filename was not escaped")
	}
	for _, obsolete := range []string{`id="a-scrub"`, `id="b-scrub"`, `id="a-play"`, `id="linked"`, "Track interval", "Correct here", "<summary>Curve comparison</summary>", "<summary>Alignment</summary>", "<summary>Export</summary>", "Target ±10 px", `id="vertical-scale"`} {
		if strings.Contains(body, obsolete) {
			t.Fatal("obsolete independent controls", obsolete)
		}
	}
	if w := get("/api/projects/" + id + "/workspace"); w.Code != 200 || strings.TrimSpace(w.Body.String()) != "null" {
		t.Fatal(w.Code, w.Body.String())
	}
	payload := `{"schema":1,"tracks":[{"id":"` + id + `","offset":-12.5,"sync":1,"first":0,"last":2}]}`
	wWorkspace := httptest.NewRecorder()
	server.ServeHTTP(wWorkspace, httptest.NewRequest("PUT", "/api/projects/"+id+"/workspace", strings.NewReader(payload)))
	if wWorkspace.Code != 200 {
		t.Fatal(wWorkspace.Code, wWorkspace.Body.String())
	}
	if w := get("/api/projects/" + id + "/workspace"); !strings.Contains(w.Body.String(), `"offset":-12.5`) {
		t.Fatal(w.Body.String())
	}

	presets := get("/api/references")
	var refs []analysis.Reference
	if e := json.Unmarshal(presets.Body.Bytes(), &refs); e != nil || len(refs) != 23 {
		t.Fatal("reference catalogue", e, presets.Body.String())
	}
	for _, body := range []string{`{"kind":"spring","stiffness":380,"damping":0.8,"velocity":1.5}`, `{"kind":"bezier","curve":[0.2,0,0,1]}`} {
		w := httptest.NewRecorder()
		server.ServeHTTP(w, httptest.NewRequest("POST", "/api/references/validate", strings.NewReader(body)))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	for _, body := range []string{`{"kind":"spring","stiffness":0}`, `{"kind":"bezier","curve":[2,0,0,1]}`, `{"kind":"spring","stiffness":380,"bogus":1}`} {
		w := httptest.NewRecorder()
		server.ServeHTTP(w, httptest.NewRequest("POST", "/api/references/validate", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatal("invalid reference accepted", w.Code, w.Body.String())
		}
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

func TestMeasurementsAreReadOnlyAndValidateInput(t *testing.T) {
	store := analysis.Store{Dir: t.TempDir()}
	id := "c6988398-16fd-4258-8eb9-693c03e10ce4"
	folder, _ := store.Folder(id)
	os.MkdirAll(folder, 0700)
	x0, x1, x2 := 0.25, 5.5, 10.75
	p := &analysis.Project{Schema: 1, ID: id, Name: "fractional.mp4", Times: []float64{0, 150, 300}, Samples: []analysis.Sample{
		{Frame: 0, T: 0, X: &x0, Valid: true}, {Frame: 1, T: 150, X: &x1, Valid: true}, {Frame: 2, T: 300, X: &x2, Valid: true},
	}}
	if e := store.Save(p); e != nil {
		t.Fatal(e)
	}
	before, _ := os.ReadFile(filepath.Join(folder, "project.json"))
	handler := (&Server{Store: store, Dist: store.Dir}).Handler()
	for _, tc := range []struct {
		path, body string
		want       int
	}{
		{"measure", `{"start":0,"end":2,"curve":[0,0,1,1],"duration":300,"fit":true}`, 200},
		{"measure", `{"start":2,"end":0}`, 400},
		{"measure", `{"start":0,"end":2,"axis":"z"}`, 400},
		{"measure", `{"start":0,"end":2,"curve":[2,0,1,1]}`, 400},
		{"measure", `{"start":0,"end":2,"duration":-1}`, 400},
		{"track", `{"region":[0,0,10,10],"start":0,"end":2,"method":"unknown"}`, 400},
	} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("POST", "/api/projects/"+id+"/"+tc.path, strings.NewReader(tc.body)))
		if w.Code != tc.want {
			t.Fatalf("%s: %d %s", tc.body, w.Code, w.Body.String())
		}
		if w.Code == 200 {
			var result analysis.Measurement
			if e := json.Unmarshal(w.Body.Bytes(), &result); e != nil {
				t.Fatal(e)
			}
			if result.RMSE > 0.001 || result.Duration < 299.9 || result.Duration > 300.1 {
				t.Fatal(result)
			}
		}
	}
	after, _ := os.ReadFile(filepath.Join(folder, "project.json"))
	if string(before) != string(after) {
		t.Fatal("measurement or rejected input changed project")
	}
}
