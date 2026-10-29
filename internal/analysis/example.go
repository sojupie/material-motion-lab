package analysis

import (
	"embed"
	"encoding/json"
	"os"
	"path/filepath"
)

// The bundled recording and measurements are templates; each opening creates a project.
//
//go:embed example/carousel.mp4 example/project.json
var exampleFiles embed.FS

func (s Store) CreateExample() (_ *Project, err error) {
	dir, err := os.MkdirTemp("", "motion-example-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	video, err := exampleFiles.ReadFile("example/carousel.mp4")
	if err != nil {
		return nil, err
	}
	source := filepath.Join(dir, "carousel.mp4")
	if err = os.WriteFile(source, video, 0600); err != nil {
		return nil, err
	}
	raw, err := exampleFiles.ReadFile("example/project.json")
	if err != nil {
		return nil, err
	}
	var template Project
	if err = json.Unmarshal(raw, &template); err != nil {
		return nil, err
	}
	p, err := s.Import(source, template.Name)
	if err != nil {
		return nil, err
	}
	folder, _ := s.Folder(p.ID)
	defer func() {
		if err != nil {
			os.RemoveAll(folder)
		}
	}()
	template.ID, template.Source = p.ID, p.Source
	if err = s.Save(&template); err != nil {
		return nil, err
	}
	first, last := template.Settings.Start, template.Settings.End
	_, err = s.SaveWorkspace(p.ID, &Workspace{Schema: 1, Name: "Carousel press",
		Tracks:   []WorkspaceTrack{{ID: p.ID, First: first, Last: last}},
		Playback: &Playback{Range: []float64{p.Times[first], p.Times[last]}, Speed: .5, Loop: true},
	})
	return &template, err
}
