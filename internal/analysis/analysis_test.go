package analysis

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"math/rand/v2"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestTrackingPipeline(t *testing.T) {
	dir := t.TempDir()
	positions := []int{20, 23, 26, 26, 31, 200, 205}
	times := []float64{0, 40, 100, 160, 200, 300, 360}
	rng := rand.New(rand.NewPCG(17, 23))
	patch := make([]byte, 30*24)
	for i := range patch {
		patch[i] = byte(10 + rng.IntN(235))
	}
	var concat strings.Builder
	for i, x := range positions {
		img := image.NewGray(image.Rect(0, 0, 320, 120))
		for k := range img.Pix {
			img.Pix[k] = 248
		}
		for y := 0; y < 24; y++ {
			for dx := 0; dx < 30; dx++ {
				img.SetGray(x+dx, 45+y, color.Gray{patch[y*30+dx]})
			}
		}
		path := filepath.Join(dir, fmtName(i))
		f, e := os.Create(path)
		if e != nil {
			t.Fatal(e)
		}
		if e = png.Encode(f, img); e != nil {
			t.Fatal(e)
		}
		f.Close()
		duration := .04
		if i+1 < len(times) {
			duration = (times[i+1] - times[i]) / 1000
		}
		concat.WriteString("file '" + fmtName(i) + "'\noption framerate 1000\nduration " + number(duration) + "\n")
	}
	concat.WriteString("file '" + fmtName(6) + "'\noption framerate 1000\n")
	list := filepath.Join(dir, "frames.txt")
	os.WriteFile(list, []byte(concat.String()), 0600)
	source := filepath.Join(dir, "test.mp4")
	if _, e := command("ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-fps_mode", "vfr", "-enc_time_base", "1:1000", "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p", source); e != nil {
		t.Fatal(e)
	}
	store := Store{Dir: filepath.Join(dir, "projects")}
	p, e := store.Import(source, "")
	if e != nil {
		t.Fatal(e)
	}
	if p.Width != 320 || p.Height != 120 {
		t.Fatal(p.Width, p.Height)
	}
	for i, want := range times {
		if math.Abs(p.Times[i]-want) > 1 {
			t.Fatal(p.Times)
		}
	}
	end := 6
	p, e = store.Track(p.ID, []float64{20, 45, 30, 24}, 0, &end, nil, 30, .65)
	if e != nil {
		t.Fatal(e)
	}
	for i, want := range positions[:5] {
		if p.Samples[i].X == nil || *p.Samples[i].X != want {
			t.Fatalf("frame %d: %+v", i, p.Samples[i])
		}
	}
	if p.Samples[5].Valid || p.Samples[5].X != nil {
		t.Fatal("loss must be null")
	}
	p, e = store.Correct(p.ID, 5, []float64{200, 45, 30, 24})
	if e != nil {
		t.Fatal(e)
	}
	for i, want := range positions {
		if p.Samples[i].X == nil || *p.Samples[i].X != want {
			t.Fatalf("correction frame %d: %+v", i, p.Samples[i])
		}
	}
	p, e = store.Zero(p.ID, 3)
	if e != nil || p.ZeroFrame != 3 {
		t.Fatal(e)
	}
	if _, e = store.Compare(p.ID, p.ID, 99); e == nil {
		t.Fatal("invalid comparison accepted")
	}
	p, e = store.Compare(p.ID, p.ID, 2)
	if e != nil || p.Comparison.ZeroFrame != 2 {
		t.Fatal(e)
	}
	csv, e := store.CSV(p.ID)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := os.ReadFile(csv)
	if !strings.Contains(string(raw), "300,200,45") {
		t.Fatal(string(raw))
	}
	out, e := store.Video(p.ID, "x")
	if e != nil {
		t.Fatal(e)
	}
	meta, e := Inspect(out)
	if e != nil {
		t.Fatal(e)
	}
	if len(meta.Times) != len(p.Times)+1 {
		t.Fatal(meta.Times)
	}
	for i, want := range p.Times {
		if math.Abs(meta.Times[i]-want) > 1 {
			t.Fatal(meta.Times)
		}
	}
	loaded, e := store.Load(p.ID)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ = json.Marshal(loaded)
	if !strings.Contains(string(raw), "\"manual\":true") {
		t.Fatal("manual anchors lost")
	}
	for _, bad := range [][]float64{{-1, 0, 10, 10}, {0, 0, 10, 10}} {
		if _, e = store.Track(p.ID, bad, 0, nil, nil, 60, .65); e == nil {
			t.Fatal("bad region accepted", bad)
		}
	}
	if _, e = store.Folder("../outside"); e == nil {
		t.Fatal("invalid ID accepted")
	}
}

func fmtName(i int) string    { return fmt.Sprintf("%d.png", i) }
func number(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
