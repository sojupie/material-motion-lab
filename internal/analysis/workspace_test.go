package analysis

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceDoesNotChangeRecordings(t *testing.T) {
	s := Store{Dir: t.TempDir()}
	ids := []string{"c6988398-16fd-4258-8eb9-693c03e10ce4", "b5f25bcd-86d7-41e1-a685-629868fd4848"}
	before := map[string]string{}
	for _, id := range ids {
		folder, _ := s.Folder(id)
		os.MkdirAll(folder, 0700)
		if e := s.Save(&Project{Schema: 1, ID: id, Name: id, Times: []float64{0, 20, 40, 70}, ZeroFrame: 2}); e != nil {
			t.Fatal(e)
		}
		raw, _ := os.ReadFile(filepath.Join(folder, "project.json"))
		before[id] = string(raw)
	}
	point := 1
	w := &Workspace{Schema: 1, Tracks: []WorkspaceTrack{{ID: ids[0], Offset: 0, Sync: &point, First: 1, Last: 3}, {ID: ids[1], Offset: -12.5, Sync: &point, First: 0, Last: 3}}}
	if _, e := s.SaveWorkspace(ids[0], w); e != nil {
		t.Fatal(e)
	}
	got, e := s.LoadWorkspace(ids[0])
	if e != nil {
		t.Fatal(e)
	}
	if got.Tracks[1].Offset != -12.5 || *got.Tracks[0].Sync != 1 {
		t.Fatal(got)
	}
	for _, id := range ids {
		folder, _ := s.Folder(id)
		raw, _ := os.ReadFile(filepath.Join(folder, "project.json"))
		if before[id] != string(raw) {
			t.Fatal("workspace changed source recording", id)
		}
	}
	raw, _ := json.Marshal(w)
	for _, mutate := range []func(*Workspace){func(w *Workspace) { w.Schema = 2 }, func(w *Workspace) { w.Tracks[1].ID = ids[0] }, func(w *Workspace) { w.Tracks[1].Offset = 86400001 }, func(w *Workspace) { w.Tracks[0].First = 3; w.Tracks[0].Last = 1 }, func(w *Workspace) { w.Tracks[1].Last = 99 }, func(w *Workspace) { bad := -1; w.Tracks[0].Sync = &bad }, func(w *Workspace) { w.Tracks[0].ID = "../bad" }} {
		var bad Workspace
		json.Unmarshal(raw, &bad)
		mutate(&bad)
		if _, e = s.SaveWorkspace(ids[0], &bad); e == nil {
			t.Fatal("accepted invalid workspace", bad)
		}
	}
	final, e := s.LoadWorkspace(ids[0])
	if e != nil || final.Tracks[1].Offset != -12.5 {
		t.Fatal("invalid write damaged workspace", e)
	}
}
