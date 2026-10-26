package analysis

import (
	"fmt"
	"gocv.io/x/gocv"
	"image"
	"math"
	"path/filepath"
	"sort"
)

func ValidateRegion(values []float64, width, height int) (Region, error) {
	var r Region
	if len(values) != 4 {
		return r, fmt.Errorf("region needs x,y,width,height")
	}
	for i, v := range values {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > float64(max(width, height))*2 {
			return r, fmt.Errorf("region values must be finite and inside the frame")
		}
		r[i] = int(math.RoundToEven(v))
	}
	if r[2] < 4 || r[3] < 4 || r[0] < 0 || r[1] < 0 || r[0]+r[2] > width || r[1]+r[3] > height {
		return r, fmt.Errorf("select a region at least 4 × 4 pixels inside the frame")
	}
	return r, nil
}
func (r Region) floats() []float64 {
	return []float64{float64(r[0]), float64(r[1]), float64(r[2]), float64(r[3])}
}
func (s Store) Track(id string, values []float64, start int, end *int, anchors *[]Anchor, search int, threshold float64) (*Project, error) {
	p, e := s.Load(id)
	if e != nil {
		return nil, e
	}
	last := len(p.Times) - 1
	if end != nil {
		last = *end
	}
	if start < 0 || start > last || last >= len(p.Times) {
		return nil, fmt.Errorf("invalid frame interval")
	}
	if search < 4 || search > 1000 || math.IsNaN(threshold) || threshold < 0 || threshold > 1 {
		return nil, fmt.Errorf("invalid tracking settings")
	}
	selection, e := ValidateRegion(values, p.Width, p.Height)
	if e != nil {
		return nil, e
	}
	fixed := map[int]Region{}
	existing := p.Anchors
	if anchors != nil {
		existing = *anchors
	}
	for _, a := range existing {
		if a.Frame >= start && a.Frame <= last {
			r, e := ValidateRegion(a.Region.floats(), p.Width, p.Height)
			if e != nil {
				return nil, e
			}
			fixed[a.Frame] = r
		}
	}
	fixed[start] = selection
	folder, _ := s.Folder(id)
	samples := make([]Sample, 0, last-start+1)
	r := selection
	template := gocv.NewMat()
	defer func() { template.Close() }()
	mask := gocv.NewMat()
	defer mask.Close()
	for i := start; i <= last; i++ {
		path := filepath.Join(folder, "frames", fmt.Sprintf("%06d.png", i+1))
		gray := gocv.IMRead(path, gocv.IMReadGrayScale)
		if gray.Empty() {
			gray.Close()
			return nil, fmt.Errorf("cannot decode frame %d", i)
		}
		manual, ok := fixed[i]
		score := float32(1)
		valid := true
		if ok {
			r = manual
			view := gray.Region(image.Rect(r[0], r[1], r[0]+r[2], r[1]+r[3]))
			template.Close()
			template = view.Clone()
			view.Close()
			mean, std := gocv.NewMat(), gocv.NewMat()
			err := gocv.MeanStdDev(template, &mean, &std)
			uniform := std.Empty() || std.GetDoubleAt(0, 0) < 2
			mean.Close()
			std.Close()
			if err != nil || uniform {
				gray.Close()
				return nil, fmt.Errorf("frame %d: region is too uniform; include an edge or texture", i)
			}
		} else {
			left, top := max(0, r[0]-search), max(0, r[1]-search)
			right, bottom := min(gray.Cols(), r[0]+r[2]+search), min(gray.Rows(), r[1]+r[3]+search)
			view := gray.Region(image.Rect(left, top, right, bottom))
			scores := gocv.NewMat()
			err := gocv.MatchTemplate(view, template, &scores, gocv.TmCcoeffNormed, mask)
			view.Close()
			if err != nil {
				scores.Close()
				gray.Close()
				return nil, err
			}
			_, best, _, point := gocv.MinMaxLoc(scores)
			score = best
			scores.Close()
			valid = !math.IsNaN(float64(score)) && !math.IsInf(float64(score), 0) && float64(score) >= threshold
			if valid {
				r[0], r[1] = left+point.X, top+point.Y
			}
		}
		gray.Close()
		row := Sample{Frame: i, T: p.Times[i], Width: r[2], Height: r[3], Score: float64(score), Valid: valid, Manual: ok}
		if math.IsNaN(row.Score) || math.IsInf(row.Score, 0) {
			row.Score = 0
		}
		if valid {
			x, y := r[0], r[1]
			row.X = &x
			row.Y = &y
		}
		samples = append(samples, row)
	}
	p.Selection = &selection
	p.Samples = samples
	p.Settings = &Settings{start, last, search, threshold}
	p.Anchors = []Anchor{}
	keys := []int{}
	for i := range fixed {
		keys = append(keys, i)
	}
	sort.Ints(keys)
	for _, i := range keys {
		p.Anchors = append(p.Anchors, Anchor{i, fixed[i]})
	}
	return p, s.Save(p)
}
func (s Store) Correct(id string, frame int, values []float64) (*Project, error) {
	p, e := s.Load(id)
	if e != nil {
		return nil, e
	}
	if p.Settings == nil || p.Selection == nil || len(p.Samples) == 0 {
		return nil, fmt.Errorf("track a region first")
	}
	settings := p.Settings
	if frame < settings.Start || frame > settings.End {
		return nil, fmt.Errorf("correction must be inside the tracked interval")
	}
	r, e := ValidateRegion(values, p.Width, p.Height)
	if e != nil {
		return nil, e
	}
	anchors := []Anchor{}
	for _, a := range p.Anchors {
		if a.Frame != frame {
			anchors = append(anchors, a)
		}
	}
	anchors = append(anchors, Anchor{frame, r})
	selection := *p.Selection
	if frame == settings.Start {
		selection = r
	}
	return s.Track(id, selection.floats(), settings.Start, &settings.End, &anchors, settings.Search, settings.Threshold)
}
