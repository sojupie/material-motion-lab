package analysis

import (
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestExampleCreatesEditableMeasuredProjects(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	store := Store{Dir: t.TempDir()}
	first, err := store.CreateExample()
	if err != nil {
		t.Fatal(err)
	}
	if first.Example != "carousel-width" || len(first.Samples) != 21 || first.Settings.Method != "width" || first.Settings.Start != 131 || first.Settings.End != 151 {
		t.Fatalf("missing bundled measurements: %+v", first.Settings)
	}
	path, err := store.Frame(first.ID, 137)
	if err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(path); err != nil || info.Size() == 0 {
		t.Fatalf("example frame unavailable: %v", err)
	}
	workspace, err := store.LoadWorkspace(first.ID)
	if err != nil || workspace.Tracks[0].ID != first.ID || !workspace.Playback.Loop {
		t.Fatalf("invalid workspace: %+v, %v", workspace, err)
	}
	last := first.Settings.End
	r := *first.Selection
	retracked, err := store.TrackMethod(first.ID, []float64{float64(r[0]), float64(r[1]), float64(r[2]), float64(r[3])}, first.Settings.Start, &last, nil, first.Settings.Search, first.Settings.Threshold, "width")
	if err != nil {
		t.Fatal(err)
	}
	for i, sample := range retracked.Samples {
		if !sample.Valid || sample.MeasuredWidth == nil || math.Abs(*sample.MeasuredWidth-*first.Samples[i].MeasuredWidth) > .2 {
			t.Fatalf("bundled region cannot reproduce sample %d: %+v", i, sample)
		}
	}
	first.Name = "Edited copy"
	if err = store.Save(first); err != nil {
		t.Fatal(err)
	}
	second, err := store.CreateExample()
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID || second.Name == first.Name {
		t.Fatal("example opening reused modified project")
	}
	original, err := store.Load(first.ID)
	if err != nil || original.Name != "Edited copy" {
		t.Fatal("opening example changed previous copy")
	}
	folder, _ := store.Folder(second.ID)
	if _, err = os.Stat(filepath.Join(folder, second.Source)); err != nil {
		t.Fatal(err)
	}
}
