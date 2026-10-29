package analysis

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

type WorkspaceTrack struct {
	ID     string  `json:"id"`
	Offset float64 `json:"offset"`
	Sync   *int    `json:"sync"`
	First  int     `json:"first"`
	Last   int     `json:"last"`
}
type Playback struct {
	Range []float64 `json:"range"`
	Speed float64   `json:"speed"`
	Loop  bool      `json:"loop"`
}
type Workspace struct {
	ID       string           `json:"id,omitempty"`
	Name     string           `json:"name,omitempty"`
	View     json.RawMessage  `json:"view,omitempty"`
	Playback *Playback        `json:"playback,omitempty"`
	Schema   int              `json:"schema"`
	Tracks   []WorkspaceTrack `json:"tracks"`
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
	w.ID = id
	if w.Name == "" {
		w.Name = "Untitled project"
		if len(w.Tracks) > 0 {
			if p, err := s.Load(w.Tracks[0].ID); err == nil {
				w.Name = strings.TrimSuffix(p.Name, filepath.Ext(p.Name))
			}
		}
	}
	if e = s.validateWorkspace(id, &w); e != nil {
		return nil, e
	}
	return &w, nil
}
func (s Store) validateWorkspace(id string, w *Workspace) error {
	if w.Schema != 1 || len(w.Tracks) > 2 || (w.ID != "" && w.ID != id) || len(w.Name) > 200 {
		return fmt.Errorf("invalid workspace tracks")
	}
	first, last := math.Inf(1), math.Inf(-1)
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
		first = math.Min(first, track.Offset)
		last = math.Max(last, track.Offset+p.Times[len(p.Times)-1])
		if track.Sync != nil && (*track.Sync < 0 || *track.Sync >= len(p.Times)) {
			return fmt.Errorf("sync point outside recording")
		}
	}
	if p := w.Playback; p != nil {
		switch p.Speed {
		case .125, .25, .5, 1, 2, 4:
		default:
			return fmt.Errorf("invalid playback speed")
		}
		if p.Range != nil {
			if len(p.Range) != 2 {
				return fmt.Errorf("playback range needs start and end")
			}
			a, b := p.Range[0], p.Range[1]
			if math.IsNaN(a) || math.IsNaN(b) || math.IsInf(a, 0) || math.IsInf(b, 0) || a < first || b > last || b < a {
				return fmt.Errorf("playback range outside workspace")
			}
		}
	}
	return nil
}
func (s Store) SaveWorkspace(id string, w *Workspace) (*Workspace, error) {
	if _, err := s.Folder(id); err != nil {
		return nil, err
	}
	if e := s.validateWorkspace(id, w); e != nil {
		return nil, e
	}
	folder, _ := s.Folder(id)
	if e := os.MkdirAll(folder, 0700); e != nil {
		return nil, e
	}
	w.ID = id
	if w.Tracks == nil {
		w.Tracks = []WorkspaceTrack{}
	}
	if strings.TrimSpace(w.Name) == "" {
		w.Name = "Untitled project"
	}
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

// Project identity is independent of the videos it contains. Legacy recording
// workspaces are adopted once; newly imported media are never separate projects.
var libraryMigration sync.Mutex

func (s Store) NewWorkspace(name string) (*Workspace, error) {
	return s.SaveWorkspace(uuid.NewString(), &Workspace{Schema: 1, Name: name, Tracks: []WorkspaceTrack{}, Playback: &Playback{Speed: 1}})
}
func (s Store) Workspaces() ([]Workspace, error) {
	libraryMigration.Lock()
	defer libraryMigration.Unlock()
	if err := os.MkdirAll(s.Dir, 0700); err != nil {
		return nil, err
	}
	marker := filepath.Join(s.Dir, ".project-library-v1")
	if _, err := os.Stat(marker); os.IsNotExist(err) {
		files, err := filepath.Glob(filepath.Join(s.Dir, "*", "workspace.json"))
		if err != nil {
			return nil, err
		}
		referenced := map[string]bool{}
		roots := map[string]bool{}
		for _, file := range files {
			id := filepath.Base(filepath.Dir(file))
			w, err := s.LoadWorkspace(id)
			if err != nil {
				return nil, err
			}
			roots[id] = true
			for _, track := range w.Tracks {
				referenced[track.ID] = true
			}
		}
		media, err := filepath.Glob(filepath.Join(s.Dir, "*", "project.json"))
		if err != nil {
			return nil, err
		}
		for _, file := range media {
			id := filepath.Base(filepath.Dir(file))
			if roots[id] || referenced[id] {
				continue
			}
			p, err := s.Load(id)
			if err != nil {
				return nil, err
			}
			first, last := 0, len(p.Times)-1
			if p.Settings != nil {
				first, last = p.Settings.Start, p.Settings.End
			}
			_, err = s.SaveWorkspace(id, &Workspace{Schema: 1, Name: strings.TrimSuffix(p.Name, filepath.Ext(p.Name)), Tracks: []WorkspaceTrack{{ID: id, First: first, Last: last}}})
			if err != nil {
				return nil, err
			}
		}
		if err := os.WriteFile(marker, []byte("1\n"), 0600); err != nil {
			return nil, err
		}
	}
	files, err := filepath.Glob(filepath.Join(s.Dir, "*", "workspace.json"))
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool {
		a, _ := os.Stat(files[i])
		b, _ := os.Stat(files[j])
		return a.ModTime().After(b.ModTime())
	})
	result := []Workspace{}
	for _, file := range files {
		id := filepath.Base(filepath.Dir(file))
		w, err := s.LoadWorkspace(id)
		if err != nil {
			return nil, err
		}
		w.ID = id
		if w.Name == "" {
			w.Name = "Untitled project"
			if len(w.Tracks) > 0 {
				p, err := s.Load(w.Tracks[0].ID)
				if err != nil {
					return nil, err
				}
				w.Name = strings.TrimSuffix(p.Name, filepath.Ext(p.Name))
			}
		}
		result = append(result, *w)
	}
	return result, nil
}
