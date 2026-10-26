package analysis

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
)

type WorkspaceTrack struct {
	ID     string  `json:"id"`
	Offset float64 `json:"offset"`
	Sync   *int    `json:"sync"`
	First  int     `json:"first"`
	Last   int     `json:"last"`
}
type Workspace struct {
	Schema int              `json:"schema"`
	Tracks []WorkspaceTrack `json:"tracks"`
}

func (s Store) LoadWorkspace(id string) (*Workspace, error) {
	folder, e := s.Folder(id)
	if e != nil {
		return nil, e
	}
	raw, e := os.ReadFile(filepath.Join(folder, "workspace.json"))
	if e != nil {
		return nil, e
	}
	var w Workspace
	if e = json.Unmarshal(raw, &w); e != nil {
		return nil, e
	}
	if e = s.validateWorkspace(id, &w); e != nil {
		return nil, e
	}
	return &w, nil
}
func (s Store) validateWorkspace(id string, w *Workspace) error {
	if w.Schema != 1 || len(w.Tracks) < 1 || len(w.Tracks) > 2 || w.Tracks[0].ID != id {
		return fmt.Errorf("invalid workspace tracks")
	}
	seen := map[string]bool{}
	for _, track := range w.Tracks {
		if seen[track.ID] {
			return fmt.Errorf("workspace tracks must use different recordings")
		}
		seen[track.ID] = true
		p, e := s.Load(track.ID)
		if e != nil {
			return e
		}
		if math.IsNaN(track.Offset) || math.IsInf(track.Offset, 0) || math.Abs(track.Offset) > 86400000 {
			return fmt.Errorf("clip offset must be within one day")
		}
		if track.First < 0 || track.Last < track.First || track.Last >= len(p.Times) {
			return fmt.Errorf("tracking range outside recording")
		}
		if track.Sync != nil && (*track.Sync < 0 || *track.Sync >= len(p.Times)) {
			return fmt.Errorf("sync point outside recording")
		}
	}
	return nil
}
func (s Store) SaveWorkspace(id string, w *Workspace) (*Workspace, error) {
	if e := s.validateWorkspace(id, w); e != nil {
		return nil, e
	}
	folder, _ := s.Folder(id)
	raw, e := json.MarshalIndent(w, "", "  ")
	if e != nil {
		return nil, e
	}
	tmp := filepath.Join(folder, "workspace.json.tmp")
	if e = os.WriteFile(tmp, raw, 0600); e != nil {
		return nil, e
	}
	return w, os.Rename(tmp, filepath.Join(folder, "workspace.json"))
}
