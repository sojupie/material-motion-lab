package analysis

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestProjectFileRoundTripIncludesMediaAndWorkspace(t *testing.T) {
	source := Store{Dir: t.TempDir()}
	a, err := source.CreateExample()
	if err != nil {
		t.Fatal(err)
	}
	b, err := source.CreateExample()
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := source.LoadWorkspace(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace.Tracks = append(workspace.Tracks, WorkspaceTrack{ID: b.ID, Offset: 17, First: 131, Last: 151})
	workspace.View = json.RawMessage(`{"controls":{"axis":"width","units":"progress","curve":"md3"},"time":2300,"vertical":[-10,110]}`)
	if _, err = source.SaveWorkspace(a.ID, workspace); err != nil {
		t.Fatal(err)
	}
	archive, err := source.ExportProject(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(archive)
	// The archive must reopen without access to the original project's directory.
	if err = os.RemoveAll(source.Dir); err != nil {
		t.Fatal(err)
	}
	target := Store{Dir: t.TempDir()}
	restored, err := target.ImportProject(archive)
	if err != nil {
		t.Fatal(err)
	}
	restoredVideo, err := target.Load(restored.Tracks[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ID == a.ID || !reflect.DeepEqual(restoredVideo.Samples, a.Samples) {
		t.Fatal("measurements or new identity not preserved")
	}
	saved, err := target.LoadWorkspace(restored.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Tracks) != 2 || saved.Tracks[0].ID == a.ID || saved.Tracks[1].ID == b.ID || saved.Tracks[1].Offset != 17 || !reflect.DeepEqual(saved.Playback, workspace.Playback) || !jsonEquivalent(saved.View, workspace.View) {
		t.Fatalf("workspace not restored: %+v", saved)
	}
	for _, track := range saved.Tracks {
		frame, err := target.Frame(track.ID, 137)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = os.Stat(frame); err != nil {
			t.Fatal(err)
		}
	}
}
func TestInvalidProjectDoesNotCreateRecordings(t *testing.T) {
	file := filepath.Join(t.TempDir(), "bad.motion")
	output, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(output)
	entry, _ := archive.Create("project.json")
	entry.Write([]byte(`{"format":"other","schema":1}`))
	archive.Close()
	output.Close()
	store := Store{Dir: t.TempDir()}
	if _, err = store.ImportProject(file); err == nil {
		t.Fatal("accepted unsupported project")
	}
	entries, _ := os.ReadDir(store.Dir)
	if len(entries) != 0 {
		t.Fatal("failed import left projects behind")
	}
}

func jsonEquivalent(a, b []byte) bool {
	var x, y any
	return json.Unmarshal(a, &x) == nil && json.Unmarshal(b, &y) == nil && reflect.DeepEqual(x, y)
}

func TestProjectIdentitySurvivesRemovingAllVideos(t *testing.T) {
	store := Store{Dir: t.TempDir()}
	if _, err := store.Workspaces(); err != nil {
		t.Fatal(err)
	}
	w, err := store.NewWorkspace("Empty project")
	if err != nil {
		t.Fatal(err)
	}
	p, err := store.CreateExample()
	if err != nil {
		t.Fatal(err)
	}
	w.Tracks = []WorkspaceTrack{{ID: p.ID, First: 131, Last: 151}}
	if _, err = store.SaveWorkspace(w.ID, w); err != nil {
		t.Fatal(err)
	}
	w.Tracks = []WorkspaceTrack{}
	if _, err = store.SaveWorkspace(w.ID, w); err != nil {
		t.Fatal(err)
	}
	file, err := store.ExportProject(w.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(file)
	restored, err := store.ImportProject(file)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.Tracks) != 0 || restored.Name != w.Name || restored.ID == w.ID {
		t.Fatal("empty project identity not preserved", restored)
	}
	if _, err = store.Load(p.ID); err != nil {
		t.Fatal("removing track deleted source", err)
	}
}

func TestLegacyLibraryAdoptsProjectsWithoutPromotingNewMedia(t *testing.T) {
	store := Store{Dir: t.TempDir()}
	makeVideo := func(name string) *Project {
		id := "00000000-0000-0000-0000-00000000000" + name
		folder, _ := store.Folder(id)
		if err := os.MkdirAll(folder, 0700); err != nil {
			t.Fatal(err)
		}
		p := &Project{Schema: 1, ID: id, Name: "Video " + name, Times: []float64{0, 40}}
		if err := store.Save(p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	a, b := makeVideo("1"), makeVideo("2")
	if _, err := store.SaveWorkspace(a.ID, &Workspace{Schema: 1, Name: "Comparison", Tracks: []WorkspaceTrack{{ID: a.ID, Last: 1}, {ID: b.ID, Last: 1}}}); err != nil {
		t.Fatal(err)
	}
	list, err := store.Workspaces()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Name != "Comparison" {
		t.Fatal("comparison split into video entries", list)
	}
	makeVideo("3")
	list, err = store.Workspaces()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatal("new unassigned media became a project", list)
	}
	if _, err = store.Load(b.ID); err != nil {
		t.Fatal("migration lost comparison video", err)
	}
}
