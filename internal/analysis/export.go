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
	w.Write([]string{"frame", "t", "x", "y", "width", "height", "score", "valid", "manual"})
	for _, v := range p.Samples {
		coord := func(p *int) string {
			if p == nil {
				return ""
			}
			return strconv.Itoa(*p)
		}
		w.Write([]string{strconv.Itoa(v.Frame), strconv.FormatFloat(v.T, 'f', -1, 64), coord(v.X), coord(v.Y), strconv.Itoa(v.Width), strconv.Itoa(v.Height), strconv.FormatFloat(v.Score, 'g', -1, 64), strconv.FormatBool(v.Valid), strconv.FormatBool(v.Manual)})
	}
	w.Flush()
	e = w.Error()
	closeErr := f.Close()
	if e != nil {
		return "", e
	}
	return path, closeErr
}
func axisValue(s Sample, axis string) *int {
	if axis == "y" {
		return s.Y
	}
	return s.X
}
func text(m *gocv.Mat, value string, x, y int, scale float64) {
	gocv.PutTextWithParams(m, value, image.Pt(x, y), gocv.FontHersheySimplex, scale, color.RGBA{235, 235, 235, 255}, 1, gocv.LineAA, false)
}
func plot(p *Project, current int, axis string, height int) gocv.Mat {
	panel := gocv.NewMatWithSizeFromScalar(gocv.NewScalar(32, 29, 29, 0), height, 440, gocv.MatTypeCV8UC3)
	title := "Horizontal position"
	if axis == "y" {
		title = "Vertical position"
	}
	text(&panel, title, 20, 28, .6)
	text(&panel, "Displacement (recording px)", 20, 52, .46)
	var origin, low, high float64
	found := false
	zero := p.Times[p.ZeroFrame]
	for _, s := range p.Samples {
		v := axisValue(s, axis)
		if s.Valid && v != nil {
			if !found {
				origin = float64(*v)
				found = true
			}
			if s.T <= zero {
				origin = float64(*v)
			}
		}
	}
	if !found {
		text(&panel, "No valid matches", 20, 90, .5)
		return panel
	}
	for _, s := range p.Samples {
		if v := axisValue(s, axis); s.Valid && v != nil {
			d := float64(*v) - origin
			low = min(low, d)
			high = max(high, d)
		}
	}
	low -= 2
	high += 2
	duration := max(1, p.Times[len(p.Times)-1])
	left, right, top, bottom := 65, 415, 85, height-60
	point := func(t, value float64) image.Point {
		return image.Pt(int(math.RoundToEven(float64(left)+t/duration*float64(right-left))), int(math.RoundToEven(float64(bottom)-(value-origin-low)/(high-low)*float64(bottom-top))))
	}
	for n := 0; n < 5; n++ {
		t := duration * float64(n) / 4
		x := point(t, origin).X
		gocv.Line(&panel, image.Pt(x, top), image.Pt(x, bottom), color.RGBA{70, 70, 75, 255}, 1)
		text(&panel, fmt.Sprint(int(math.RoundToEven(t-zero))), x-14, bottom+22, .36)
		v := low + (high-low)*float64(n)/4
		y := point(0, origin+v).Y
		gocv.Line(&panel, image.Pt(left, y), image.Pt(right, y), color.RGBA{70, 70, 75, 255}, 1)
		text(&panel, fmt.Sprintf("%.0f", v), 12, y+4, .4)
	}
	var previous *image.Point
	for _, s := range p.Samples {
		v := axisValue(s, axis)
		if !s.Valid || v == nil {
			previous = nil
			continue
		}
		next := point(s.T, float64(*v))
		if previous != nil {
			gocv.Line(&panel, *previous, next, color.RGBA{184, 200, 235, 255}, 2)
		}
		previous = &next
	}
	x := point(p.Times[current], origin).X
	gocv.Line(&panel, image.Pt(x, top), image.Pt(x, bottom), color.RGBA{150, 230, 130, 255}, 1)
	text(&panel, "Time from selected zero (ms)", 100, height-12, .46)
	return panel
}
func (s Store) Video(id, axis string) (string, error) {
	if axis != "x" && axis != "y" {
		return "", fmt.Errorf("axis must be x or y")
	}
	p, e := s.Load(id)
	if e != nil {
		return "", e
	}
	if len(p.Samples) == 0 {
		return "", fmt.Errorf("track a region before exporting")
	}
	dir, _ := s.Folder(id)
	work, e := os.MkdirTemp(dir, "export-")
	if e != nil {
		return "", e
	}
	defer os.RemoveAll(work)
	rows := map[int]Sample{}
	for _, r := range p.Samples {
		rows[r.Frame] = r
	}
	var concat strings.Builder
	for i, t := range p.Times {
		if e = renderFrame(p, dir, work, i, axis, rows); e != nil {
			return "", e
		}
		duration := 1.0 / 30
		if i+1 < len(p.Times) {
			duration = (p.Times[i+1] - t) / 1000
		} else if i > 0 {
			duration = (t - p.Times[i-1]) / 1000
		}
		fmt.Fprintf(&concat, "file '%06d.png'\noption framerate 1000\nduration %.9f\n", i, duration)
	}
	fmt.Fprintf(&concat, "file '%06d.png'\noption framerate 1000\n", len(p.Times)-1)
	if e = os.WriteFile(filepath.Join(work, "frames.txt"), []byte(concat.String()), 0600); e != nil {
		return "", e
	}
	dest := filepath.Join(dir, "annotated.mp4")
	_, e = command("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", filepath.Join(work, "frames.txt"), "-fps_mode", "vfr", "-enc_time_base", "1:1000", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-movflags", "+faststart", dest)
	return dest, e
}
func renderFrame(p *Project, dir, work string, i int, axis string, rows map[int]Sample) error {
	frame := gocv.IMRead(filepath.Join(dir, "frames", fmt.Sprintf("%06d.png", i+1)), gocv.IMReadColor)
	defer frame.Close()
	if frame.Empty() {
		return fmt.Errorf("cannot decode frame %d", i)
	}
	row, ok := rows[i]
	if ok && row.Valid && row.X != nil && row.Y != nil {
		gocv.Rectangle(&frame, image.Rect(*row.X, *row.Y, *row.X+row.Width, *row.Y+row.Height), color.RGBA{100, 220, 70, 255}, 2)
	}
	label := fmt.Sprintf("Frame %d   %+.1f ms", i, p.Times[i]-p.Times[p.ZeroFrame])
	if ok && !row.Valid {
		label += "   TRACK LOST"
	}
	height := max(320, frame.Rows()+46)
	padded := gocv.NewMatWithSizeFromScalar(gocv.NewScalar(24, 24, 24, 0), height, frame.Cols(), gocv.MatTypeCV8UC3)
	defer padded.Close()
	region := padded.Region(image.Rect(0, 46, frame.Cols(), 46+frame.Rows()))
	err := frame.CopyTo(&region)
	region.Close()
	if err != nil {
		return err
	}
	text(&padded, label, 12, 28, .55)
	panel := plot(p, i, axis, height)
	defer panel.Close()
	combined := gocv.NewMat()
	defer combined.Close()
	if err = gocv.Hconcat(padded, panel, &combined); err != nil {
		return err
	}
	if !gocv.IMWrite(filepath.Join(work, fmt.Sprintf("%06d.png", i)), combined) {
		return fmt.Errorf("cannot write annotated frame")
	}
	return nil
}
