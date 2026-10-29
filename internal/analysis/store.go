package analysis

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"gocv.io/x/gocv"
)

const MaxFrames = 6000

type Region [4]int

func (r *Region) UnmarshalJSON(raw []byte) error {
	var values []float64
	if err := json.Unmarshal(raw, &values); err != nil {
		return err
	}
	if len(values) != 4 {
		return fmt.Errorf("region needs four values")
	}
	for i, v := range values {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 1<<31 {
			return fmt.Errorf("invalid region coordinate")
		}
		r[i] = int(math.RoundToEven(v))
	}
	return nil
}

type Anchor struct {
	Frame  int    `json:"frame"`
	Region Region `json:"region"`
}
type Sample struct {
	MeasuredWidth  *float64 `json:"measuredWidth,omitempty"`
	MeasuredHeight *float64 `json:"measuredHeight,omitempty"`
	Frame          int      `json:"frame"`
	T              float64  `json:"t"`
	X              *float64 `json:"x"`
	Y              *float64 `json:"y"`
	Width          int      `json:"width"`
	Height         int      `json:"height"`
	Score          float64  `json:"score"`
	Valid          bool     `json:"valid"`
	Manual         bool     `json:"manual"`
}
type Settings struct {
	Method    string  `json:"method,omitempty"`
	Precision string  `json:"precision,omitempty"`
	Start     int     `json:"start"`
	End       int     `json:"end"`
	Search    int     `json:"search"`
	Threshold float64 `json:"threshold"`
}
type Comparison struct {
	ID        string `json:"id"`
	ZeroFrame int    `json:"zeroFrame"`
}
type Project struct {
	Example    string      `json:"example,omitempty"`
	Schema     int         `json:"schema"`
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Source     string      `json:"source"`
	Width      int         `json:"width"`
	Height     int         `json:"height"`
	Times      []float64   `json:"times"`
	ZeroFrame  int         `json:"zeroFrame"`
	Selection  *Region     `json:"selection"`
	Anchors    []Anchor    `json:"anchors"`
	Samples    []Sample    `json:"samples"`
	Settings   *Settings   `json:"settings"`
	Comparison *Comparison `json:"comparison,omitempty"`
}

// Untracked schema-1 projects have an empty settings object, as in the
// original Python format. Keep that contract for saved files and the web UI.
func (p Project) MarshalJSON() ([]byte, error) {
	type projectAlias Project
	var settings any = p.Settings
	if p.Settings == nil || len(p.Samples) == 0 {
		settings = struct{}{}
	}
	return json.Marshal(struct {
		*projectAlias
		Settings any `json:"settings"`
	}{(*projectAlias)(&p), settings})
}

type Metadata struct {
	Width  int       `json:"width"`
	Height int       `json:"height"`
	Codec  string    `json:"codec_name"`
	Times  []float64 `json:"times"`
}
type Store struct{ Dir string }

func command(name string, args ...string) ([]byte, error) {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		detail := string(out)
		if len(detail) > 1500 {
			detail = detail[len(detail)-1500:]
		}
		return nil, fmt.Errorf("%s: %w: %s", name, err, detail)
	}
	return out, nil
}
func Inspect(path string) (Metadata, error) {
	var result Metadata
	raw, err := command("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-show_frames", "-show_entries", "stream=width,height,codec_name:frame=best_effort_timestamp_time,pkt_duration_time", "-of", "json", path)
	if err != nil {
		return result, err
	}
	var data struct {
		Streams []Metadata `json:"streams"`
		Frames  []struct {
			T string `json:"best_effort_timestamp_time"`
		} `json:"frames"`
	}
	if err = json.Unmarshal(raw, &data); err != nil {
		return result, err
	}
	if len(data.Streams) == 0 || len(data.Frames) == 0 {
		return result, fmt.Errorf("no video frames found")
	}
	if len(data.Frames) > MaxFrames {
		return result, fmt.Errorf("video exceeds %d frames; trim it before importing", MaxFrames)
	}
	result = data.Streams[0]
	var start, previous float64
	for i, f := range data.Frames {
		t, e := strconv.ParseFloat(f.T, 64)
		if e != nil || math.IsNaN(t) || math.IsInf(t, 0) || (i > 0 && t <= previous) {
			return result, fmt.Errorf("video frames need finite, strictly increasing timestamps")
		}
		if i == 0 {
			start = t
		}
		previous = t
		result.Times = append(result.Times, (t-start)*1000)
	}
	return result, nil
}
func (s Store) Folder(id string) (string, error) {
	u, e := uuid.Parse(id)
	if e != nil || u.String() != id {
		return "", fmt.Errorf("invalid project ID")
	}
	return filepath.Join(s.Dir, id), nil
}
func (s Store) Load(id string) (*Project, error) {
	folder, e := s.Folder(id)
	if e != nil {
		return nil, e
	}
	raw, e := os.ReadFile(filepath.Join(folder, "project.json"))
	if e != nil {
		return nil, e
	}
	var p Project
	if e = json.Unmarshal(raw, &p); e != nil {
		return nil, e
	}
	if p.ID != id || len(p.Times) == 0 || p.ZeroFrame < 0 || p.ZeroFrame >= len(p.Times) {
		return nil, fmt.Errorf("invalid saved project")
	}
	return &p, nil
}
func (s Store) Save(p *Project) error {
	folder, e := s.Folder(p.ID)
	if e != nil {
		return e
	}
	raw, e := json.MarshalIndent(p, "", "  ")
	if e != nil {
		return e
	}
	tmp := filepath.Join(folder, "project.json.tmp")
	if e = os.WriteFile(tmp, raw, 0600); e != nil {
		return e
	}
	return os.Rename(tmp, filepath.Join(folder, "project.json"))
}
func (s Store) Import(path, name string) (p *Project, err error) {
	meta, err := Inspect(path)
	if err != nil {
		return nil, err
	}
	id := uuid.NewString()
	folder, _ := s.Folder(id)
	if err = os.MkdirAll(filepath.Join(folder, "frames"), 0700); err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			os.RemoveAll(folder)
		}
	}()
	ext := strings.ToLower(filepath.Ext(path))
	src, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer src.Close()
	dst, err := os.Create(filepath.Join(folder, "source"+ext))
	if err != nil {
		return nil, err
	}
	_, err = io.Copy(dst, src)
	closeErr := dst.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if _, err = command("ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-fps_mode", "passthrough", "-frames:v", strconv.Itoa(MaxFrames+1), filepath.Join(folder, "frames/%06d.png")); err != nil {
		return nil, err
	}
	frames, _ := filepath.Glob(filepath.Join(folder, "frames/*.png"))
	if len(frames) != len(meta.Times) {
		return nil, fmt.Errorf("decoded frames do not match timestamps")
	}
	first := gocv.IMRead(frames[0], gocv.IMReadColor)
	defer first.Close()
	if first.Empty() {
		return nil, fmt.Errorf("cannot decode first frame")
	}
	if name == "" {
		name = filepath.Base(path)
	}
	p = &Project{Schema: 1, ID: id, Name: name, Source: "source" + ext, Width: first.Cols(), Height: first.Rows(), Times: meta.Times, Anchors: []Anchor{}, Samples: []Sample{}}
	err = s.Save(p)
	return p, err
}
func (s Store) Frame(id string, index int) (string, error) {
	p, e := s.Load(id)
	if e != nil {
		return "", e
	}
	if index < 0 || index >= len(p.Times) {
		return "", fmt.Errorf("frame outside recording")
	}
	folder, _ := s.Folder(id)
	return filepath.Join(folder, "frames", fmt.Sprintf("%06d.png", index+1)), nil
}
func (s Store) Zero(id string, index int) (*Project, error) {
	p, e := s.Load(id)
	if e != nil {
		return nil, e
	}
	if index < 0 || index >= len(p.Times) {
		return nil, fmt.Errorf("frame outside recording")
	}
	p.ZeroFrame = index
	return p, s.Save(p)
}
func (s Store) Compare(id, ref string, zero int) (*Project, error) {
	p, e := s.Load(id)
	if e != nil {
		return nil, e
	}
	p.Comparison = nil
	if ref != "" {
		r, e := s.Load(ref)
		if e != nil {
			return nil, e
		}
		if zero < 0 || zero >= len(r.Times) {
			return nil, fmt.Errorf("comparison frame outside recording")
		}
		p.Comparison = &Comparison{ref, zero}
	}
	return p, s.Save(p)
}
