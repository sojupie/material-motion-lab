package analysis

import (
	"encoding/csv"
	"fmt"
	"gocv.io/x/gocv"
	"image"
	"image/color"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func (s Store) CSV(id string) (string, error) {
	p, e := s.Load(id)
	if e != nil {
		return "", e
	}
	dir, _ := s.Folder(id)
	path := filepath.Join(dir, "measurements.csv")
	f, e := os.Create(path)
	if e != nil {
		return "", e
	}
	w := csv.NewWriter(f)
	w.Write([]string{"frame", "t", "x", "y", "width", "height", "score", "valid", "manual", "measuredWidth", "measuredHeight"})
	for _, v := range p.Samples {
		coord := func(p *float64) string {
			if p == nil {
				return ""
			}
			return strconv.FormatFloat(*p, 'f', 6, 64)
		}
		w.Write([]string{strconv.Itoa(v.Frame), strconv.FormatFloat(v.T, 'f', -1, 64), coord(v.X), coord(v.Y), strconv.Itoa(v.Width), strconv.Itoa(v.Height), strconv.FormatFloat(v.Score, 'g', -1, 64), strconv.FormatBool(v.Valid), strconv.FormatBool(v.Manual), coord(v.MeasuredWidth), coord(v.MeasuredHeight)})
	}
	w.Flush()
	e = w.Error()
	closeErr := f.Close()
	if e != nil {
		return "", e
	}
	return path, closeErr
}
func axisValue(s Sample, axis string) *float64 {
	switch axis {
	case "y":
		return s.Y
	case "width":
		return s.MeasuredWidth
	case "height":
		return s.MeasuredHeight
	default:
		return s.X
	}
}
func text(m *gocv.Mat, value string, x, y int, scale float64) {
	gocv.PutTextWithParams(m, value, image.Pt(x, y), gocv.FontHersheySimplex, scale, color.RGBA{235, 235, 235, 255}, 1, gocv.LineAA, false)
}

type VideoOptions struct {
	First      int          `json:"first"`
	Last       int          `json:"last"`
	Speed      float64      `json:"speed"`
	Repeat     int          `json:"repeat"`
	Tracking   bool         `json:"tracking"`
	Plot       bool         `json:"plot"`
	Statistics bool         `json:"statistics"`
	Markers    bool         `json:"markers"`
	Time       bool         `json:"time"`
	Chart      ChartOptions `json:"chart"`
}

func DefaultVideoOptions(p *Project, axis string) VideoOptions {
	first, last := 0, len(p.Times)-1
	if p.Settings != nil {
		first, last = p.Settings.Start, p.Settings.End
	}
	return VideoOptions{First: 0, Last: len(p.Times) - 1, Speed: 1, Repeat: 1, Tracking: true, Plot: true, Statistics: true, Markers: true, Time: true, Chart: ChartOptions{Axis: axis, Units: "px", Start: first, End: last, Duration: 300, Statistics: true, Markers: true}}
}
func (s Store) Video(id, axis string) (string, error) {
	p, e := s.Load(id)
	if e != nil {
		return "", e
	}
	return s.VideoWithOptions(id, DefaultVideoOptions(p, axis))
}
func validateVideo(p *Project, o VideoOptions) error {
	if o.First < 0 || o.Last < o.First || o.Last >= len(p.Times) {
		return fmt.Errorf("export interval outside recording")
	}
	if !finite(o.Speed) || o.Speed < .125 || o.Speed > 4 || o.Repeat < 1 || o.Repeat > 10 {
		return fmt.Errorf("export speed must be 0.125–4 and repetitions 1–10")
	}
	return validateChart(p, o.Chart)
}
func (s Store) VideoWithOptions(id string, o VideoOptions) (string, error) {
	p, e := s.Load(id)
	if e != nil {
		return "", e
	}
	if e = validateVideo(p, o); e != nil {
		return "", e
	}
	o.Chart.Statistics = o.Statistics
	o.Chart.Markers = o.Markers
	var data chartData
	if o.Plot || o.Statistics {
		data, e = s.buildChart(p, o.Chart)
		if e != nil {
			return "", e
		}
	}
	dir, _ := s.Folder(id)
	work, e := os.MkdirTemp(dir, "export-")
	if e != nil {
		return "", e
	}
	defer os.RemoveAll(work)
	var second *Project
	if q := o.Chart.Comparison; q != nil {
		if q.ID == p.ID || !finite(q.Offset) || math.Abs(q.Offset) > 86400000 {
			return "", fmt.Errorf("invalid comparison")
		}
		second, e = s.Load(q.ID)
		if e != nil {
			return "", e
		}
		check := o.Chart
		check.Start = q.First
		check.End = q.Last
		if e = validateChart(second, check); e != nil {
			return "", e
		}
	}
	for i := o.First; i <= o.Last; i++ {
		if e = s.renderExportFrame(p, second, dir, work, i, o, data); e != nil {
			return "", e
		}
	}
	var concat strings.Builder
	for repeat := 0; repeat < o.Repeat; repeat++ {
		for i := o.First; i <= o.Last; i++ {
			d := 1. / 30
			if i+1 < len(p.Times) {
				d = (p.Times[i+1] - p.Times[i]) / 1000
			} else if i > 0 {
				d = (p.Times[i] - p.Times[i-1]) / 1000
			}
			fmt.Fprintf(&concat, "file '%06d.png'\noption framerate 1000\nduration %.9f\n", i, d/o.Speed)
		}
	}
	fmt.Fprintf(&concat, "file '%06d.png'\noption framerate 1000\n", o.Last)
	if e = os.WriteFile(filepath.Join(work, "frames.txt"), []byte(concat.String()), 0600); e != nil {
		return "", e
	}
	f, e := os.CreateTemp(dir, "annotated-*.mp4")
	if e != nil {
		return "", e
	}
	dest := f.Name()
	f.Close()
	_, e = command("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", filepath.Join(work, "frames.txt"), "-fps_mode", "vfr", "-enc_time_base", "1:1000", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dest)
	if e != nil {
		os.Remove(dest)
	}
	return dest, e
}
func trackedOutline(frame *gocv.Mat, p *Project, row Sample) {
	if !row.Valid || row.X == nil || row.Y == nil {
		return
	}
	x, y := int(math.Round(*row.X)), int(math.Round(*row.Y))
	c := color.RGBA{100, 220, 70, 255}
	method := ""
	if p.Settings != nil {
		method = p.Settings.Method
	}
	switch method {
	case "edge-x":
		gocv.Line(frame, image.Pt(x, y), image.Pt(x, y+row.Height), c, 2)
	case "edge-y":
		gocv.Line(frame, image.Pt(x, y), image.Pt(x+row.Width, y), c, 2)
	case "width":
		if row.MeasuredWidth != nil {
			r := int(math.Round(*row.X + *row.MeasuredWidth))
			gocv.Line(frame, image.Pt(x, y), image.Pt(x, y+row.Height), c, 2)
			gocv.Line(frame, image.Pt(r, y), image.Pt(r, y+row.Height), c, 2)
		}
	case "height":
		if row.MeasuredHeight != nil {
			b := int(math.Round(*row.Y + *row.MeasuredHeight))
			gocv.Line(frame, image.Pt(x, y), image.Pt(x+row.Width, y), c, 2)
			gocv.Line(frame, image.Pt(x, b), image.Pt(x+row.Width, b), c, 2)
		}
	default:
		gocv.Rectangle(frame, image.Rect(x, y, x+row.Width, y+row.Height), c, 2)
	}
}
func short(value string, n int) string {
	r := []rune(value)
	if len(r) > n {
		return string(r[:n-3]) + "..."
	}
	return value
}
func nearestFrame(times []float64, t float64) int {
	best := 0
	for i := 1; i < len(times); i++ {
		if math.Abs(times[i]-t) < math.Abs(times[best]-t) {
			best = i
		}
	}
	return best
}
func (s Store) renderExportFrame(p, second *Project, dir, work string, i int, o VideoOptions, data chartData) error {
	canvas := gocv.NewMatWithSizeFromScalar(gocv.NewScalar(32, 29, 29, 0), 900, 1600, gocv.MatTypeCV8UC3)
	defer canvas.Close()
	text(&canvas, short(p.Name, 90), 24, 32, .75)
	if o.Time {
		text(&canvas, fmt.Sprintf("Source time: %.3f s   Frame: %d   Speed: %.3gx   Interval: %d-%d", p.Times[i]/1000, i, o.Speed, o.First, o.Last), 24, 62, .55)
	}
	leftWidth := 1600
	if o.Plot {
		leftWidth = 960
	}
	projects := []*Project{p}
	indices := []int{i}
	if second != nil {
		projects = append(projects, second)
		indices = append(indices, nearestFrame(second.Times, p.Times[i]-o.Chart.Comparison.Offset))
	}
	cellHeight := 810 / len(projects)
	for n, project := range projects {
		folder, _ := s.Folder(project.ID)
		frame := gocv.IMRead(filepath.Join(folder, "frames", fmt.Sprintf("%06d.png", indices[n]+1)), gocv.IMReadColor)
		if frame.Empty() {
			frame.Close()
			return fmt.Errorf("cannot decode frame %d", indices[n])
		}
		var sample Sample
		found := false
		for _, v := range project.Samples {
			if v.Frame == indices[n] {
				sample = v
				found = true
				break
			}
		}
		if o.Tracking {
			trackedOutline(&frame, project, sample)
		}
		scale := min(float64(leftWidth-32)/float64(frame.Cols()), float64(cellHeight-48)/float64(frame.Rows()))
		w, h := max(1, int(float64(frame.Cols())*scale)), max(1, int(float64(frame.Rows())*scale))
		resized := gocv.NewMat()
		gocv.Resize(frame, &resized, image.Pt(w, h), 0, 0, gocv.InterpolationArea)
		frame.Close()
		x, y := (leftWidth-w)/2, 90+n*cellHeight+35+(cellHeight-48-h)/2
		dst := canvas.Region(image.Rect(x, y, x+w, y+h))
		e := resized.CopyTo(&dst)
		dst.Close()
		resized.Close()
		if e != nil {
			return e
		}
		label := fmt.Sprintf("%c: %s", 'A'+n, short(project.Name, 65))
		if o.Time {
			label += fmt.Sprintf("   Frame %d", indices[n])
			if n == 1 && (p.Times[i]-o.Chart.Comparison.Offset < 0 || p.Times[i]-o.Chart.Comparison.Offset > project.Times[len(project.Times)-1]) {
				label += " (outside clip)"
			}
		}
		text(&canvas, label, 20, 110+n*cellHeight, .5)
		if o.Statistics {
			status := "No measurement"
			if sample.Valid {
				if value := axisValue(sample, o.Chart.Axis); value != nil {
					status = fmt.Sprintf("%s: %.3f px   Score: %.3f", o.Chart.Axis, *value, sample.Score)
				}
			} else if found {
				status = "Tracking lost"
			}
			text(&canvas, status, 20, 130+n*cellHeight, .43)
		}
	}
	if o.Plot {
		panel := renderChart(data, p.Times[i], 640, 810, o.Statistics, o.Markers)
		defer panel.Close()
		dst := canvas.Region(image.Rect(960, 90, 1600, 900))
		e := panel.CopyTo(&dst)
		dst.Close()
		if e != nil {
			return e
		}
	} else if o.Statistics {
		for n := range data.Series {
			text(&canvas, data.summary(n), 24, 870+n*20, .45)
		}
	}
	if !gocv.IMWrite(filepath.Join(work, fmt.Sprintf("%06d.png", i)), canvas) {
		return fmt.Errorf("cannot write annotated frame")
	}
	return nil
}
func renderChart(c chartData, current float64, width, height int, stats, markers bool) gocv.Mat {
	panel := gocv.NewMatWithSizeFromScalar(gocv.NewScalar(32, 29, 29, 0), height, width, gocv.MatTypeCV8UC3)
	text(&panel, c.Title+" ("+c.Unit+")", 20, 30, .65)
	for i, s := range c.Series {
		text(&panel, fmt.Sprintf("%c: %s", 'A'+i, short(s.Name, 58)), 20, 58+i*23, .43)
	}
	if c.Options.Reference != nil {
		name := c.Options.Reference.Label
		if name == "" {
			name = "Custom " + c.Options.Reference.Kind
		}
		text(&panel, "Reference: "+short(name, 55), 20, 110, .45)
		text(&panel, referenceDetails(*c.Options.Reference, c.Options.Duration), 20, 132, .38)
	}
	left, top, right, bottom := 75, 145, width-20, height-110
	point := func(t, v float64) image.Point {
		return image.Pt(int((t-c.Min)/(c.Max-c.Min)*float64(right-left)), int(float64(bottom-top)-(v-c.Low)/(c.High-c.Low)*float64(bottom-top)))
	}
	grid := color.RGBA{80, 75, 85, 255}
	for i := 0; i <= 4; i++ {
		t := c.Min + (c.Max-c.Min)*float64(i)/4
		v := c.Low + (c.High-c.Low)*float64(i)/4
		q := point(t, v)
		gocv.Line(&panel, image.Pt(left+q.X, top), image.Pt(left+q.X, bottom), grid, 1)
		gocv.Line(&panel, image.Pt(left, top+q.Y), image.Pt(right, top+q.Y), grid, 1)
		text(&panel, fmt.Sprintf("%.2f", t/1000), left+q.X-12, bottom+25, .4)
		text(&panel, fmt.Sprintf("%.1f", v), 5, top+q.Y+4, .4)
	}
	plot := panel.Region(image.Rect(left, top, right, bottom))
	defer plot.Close()
	colors := []color.RGBA{{190, 165, 240, 255}, {240, 165, 185, 255}}
	for n, s := range c.Series {
		for kind, points := range [][]chartPoint{s.Points, s.Expected} {
			var prev *image.Point
			for j, v := range points {
				if !v.Valid {
					prev = nil
					continue
				}
				q := point(v.T, v.V)
				if prev != nil && (kind == 0 || j%4 < 2) {
					gocv.Line(&plot, *prev, q, colors[n], 2)
				}
				if kind == 0 && markers && v.Manual {
					gocv.Circle(&plot, q, 4, colors[n], 2)
				}
				prev = &q
			}
		}
		if markers {
			for j, frame := range []int{0, len(s.Points) - 1} {
				if frame < 0 {
					continue
				}
				v := s.Points[frame]
				if v.T < c.Min || v.T > c.Max {
					continue
				}
				x := point(v.T, 0).X + left
				for y := top; y < bottom; y += 10 {
					gocv.Line(&panel, image.Pt(x, y), image.Pt(x, min(y+4, bottom)), colors[n], 1)
				}
				word := "In"
				if j == 1 {
					word = "Out"
				}
				text(&panel, fmt.Sprintf("%c %s", 'A'+n, word), min(x+3, right-50), top+14+n*18, .4)
			}
			for _, v := range s.Points {
				if !v.Valid && v.T >= c.Min && v.T <= c.Max {
					x := point(v.T, 0).X + left
					gocv.Line(&panel, image.Pt(x, bottom), image.Pt(x, bottom+7), color.RGBA{240, 80, 80, 255}, 2)
				}
			}
		}
		if stats {
			text(&panel, c.summary(n), 20, height-44+n*22, .43)
		}
	}
	if current >= c.Min && current <= c.Max {
		x := point(current, 0).X
		gocv.Line(&plot, image.Pt(x, 0), image.Pt(x, bottom-top), color.RGBA{150, 230, 130, 255}, 1)
	}
	text(&panel, "Source time (s)", width/2-65, bottom+53, .5)
	return panel
}
