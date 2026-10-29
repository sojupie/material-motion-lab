package web

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/sojupie/ui-motion/internal/analysis"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
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
	if strings.Contains(body, `id="open-dialog"`) {
		t.Fatal("video library must be visible in the workspace, without a project chooser")
	}
	ids := map[string]bool{}
	for _, match := range regexp.MustCompile(` id="([^"]+)"`).FindAllStringSubmatch(body, -1) {
		if ids[match[1]] {
			t.Fatal("duplicate control ID", match[1])
		}
		ids[match[1]] = true
	}

	for _, text := range []string{`aria-label="Workspace actions"`, `id="a-remove"`, `id="b-remove"`, `aria-label="Remove Video A from workspace"`, `id="inspector" class="inspector"`, `class="video-library"`, `id="recent-projects"`, `id="empty-viewer"`, `class="tool-accordion"`, `id="export-dialog"`, `id="export-run"`, `aria-label="Playback controls"`, `id="viewer-splitter"`, `id="graph-pan"`, `aria-label="Chart navigation"`, `aria-label="Vertical zoom"`, `class="timeline-tracks"`, "data-field-combo", "md-outlined-text-field", "field-option-template", "recording-item-template", "/assets/main.js", "A &lt;script&gt;", `id="timeline"`, `id="playhead-time"`, `id="inspector-title"`, "Track range", `id="duration-mode"`, `id="duration-status"`, "Auto-fit A", "Auto-fit B", "Mark sync point", "Viewer zoom", `id="reference-controls"`, `id="graph-fit"`, `id="graph-fit-end"`, `id="graph-zoom-in"`, `id="graph-scale-info"`, `aria-label="Clip alignment"`, `id="playback-speed"`, `id="playback-loop"`, `id="playback-start"`, `id="playback-end"`, `id="playback-reset"`, `id="a-export-first"`, `id="a-export-last"`, `id="a-export-plot"`, "Width (opposing edges)"} {
		if !strings.Contains(body, text) {
			t.Fatal("missing server markup", text)
		}
	}

	if !regexp.MustCompile(`<button[^>]*aria-pressed="false"[^>]*id="graph-pan"|<button[^>]*id="graph-pan"[^>]*aria-pressed="false"`).MatchString(body) {
		t.Fatal("chart pan must be a toggle action")
	}
	if strings.Contains(body, `type="checkbox" id="graph-pan"`) {
		t.Fatal("chart pan is still an inspector checkbox")
	}

	exportStart := strings.Index(body, `<dialog id="export-dialog"`)
	if exportStart < 0 {
		t.Fatal("export dialog absent")
	}
	exportEnd := strings.Index(body[exportStart:], `</dialog>`) + exportStart
	for _, id := range []string{`id="a-export-first"`, `id="b-export-first"`, `id="export-run"`} {
		at := strings.Index(body, id)
		if at < exportStart || at > exportEnd {
			t.Fatal("export control outside dialog", id)
		}
	}
	if regexp.MustCompile(`<dialog id="export-dialog"[^>]*\sopen(?:[\s=>])`).MatchString(body) {
		t.Fatal("export dialog opens by default")
	}
	if !regexp.MustCompile(`<button[^>]*class="md-button md-filled-button"[^>]*id="play"|<button[^>]*id="play"[^>]*class="md-button md-filled-button"`).MatchString(body) {
		t.Fatal("play button lost shared component class")
	}

	for _, id := range []string{"previous-frame", "play", "next-frame"} {
		match := regexp.MustCompile(`<button[^>]*id="` + id + `"[^>]*>`).FindString(body)
		if !strings.Contains(match, `data-group-button="`+id+`"`) {
			t.Fatal("transport child excluded by shared group runtime", id, match)
		}
	}
	if regexp.MustCompile(`<div[^>]*id="workspace"[^>]*hidden`).MatchString(body) {
		t.Fatal("workspace hidden before video selection")
	}
	for _, old := range []string{`id="timeline-splitter"`, `class="application-toolbar"`, `id="home"`, `id="empty-import"`, `class="editor-header"`, `id="media-panel"`, `id="toggle-media"`, `id="toggle-sidebar"`, `id="app-navigation"`, `id="layout-menu"`} {
		if strings.Contains(body, old) {
			t.Fatal("obsolete global workspace control", old)
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
	if w := get("/api/projects/" + id + "/workspace"); w.Code != 200 || !strings.Contains(w.Body.String(), `"tracks"`) {
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

	for _, body := range []string{`{"first":-1}`, `{"first":0,"last":99,"speed":1,"repeat":1}`, `{"first":0,"last":1,"speed":0,"repeat":1}`, `{"unknown":true}`} {
		w := httptest.NewRecorder()
		server.ServeHTTP(w, httptest.NewRequest("POST", "/api/projects/"+id+"/export/video", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatal("invalid export accepted", w.Code, w.Body.String())
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

// Prevent another app-local button or popup imitation from entering the page.
func TestAllWorkspaceButtonsUseSharedComponentAnatomy(t *testing.T) {
	var out bytes.Buffer
	if err := Page(nil).Render(context.Background(), &out); err != nil {
		t.Fatal(err)
	}
	for _, button := range regexp.MustCompile(`<button\b[^>]*>`).FindAllString(out.String(), -1) {
		class := regexp.MustCompile(`class="([^"]+)"`).FindStringSubmatch(button)
		if len(class) != 2 || !regexp.MustCompile(`(?:^| )(?:md-button|md-icon-button|md-filter-chip|md-menu-item|md-list-item)(?: |$)`).MatchString(class[1]) {
			t.Fatal("button bypasses shared anatomy", button)
		}
	}
	for _, obsolete := range []string{"tokens-catalog-menu", "md-sheet-content", "md-sheet-body", "inspector-tabs", "show-status", "@ui."} {
		if strings.Contains(out.String(), obsolete) {
			t.Fatal("obsolete or unrendered component", obsolete)
		}
	}
}

func TestPageVersionsAssetsWhenBuildChanges(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(dir, "assets", "main.js")
	version := func(content string) string {
		if err := os.WriteFile(script, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		handler := (&Server{Store: analysis.Store{Dir: t.TempDir()}, Dist: dir}).Handler()
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", "/", nil))
		match := regexp.MustCompile(`/assets/main.js\?v=([a-f0-9]+)`).FindStringSubmatch(response.Body.String())
		if len(match) != 2 || !strings.Contains(response.Body.String(), `/assets/main.css?v=`+match[1]) {
			t.Fatal("page must load matching versioned assets")
		}
		return match[1]
	}
	if version("old build") == version("new build") {
		t.Fatal("rebuilt scripts kept their old cache key")
	}
}
