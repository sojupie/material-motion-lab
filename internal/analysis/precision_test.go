package analysis

import (
	"fmt"
	"github.com/google/uuid"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func synthetic(t *testing.T, draw func(x, y int, shift float64) float64, shifts []float64) (Store, *Project) {
	t.Helper()
	store := Store{Dir: t.TempDir()}
	p := &Project{Schema: 1, ID: uuid.NewString(), Name: "fractional", Width: 160, Height: 100, Times: []float64{}, Anchors: []Anchor{}, Samples: []Sample{}}
	dir, _ := store.Folder(p.ID)
	os.MkdirAll(filepath.Join(dir, "frames"), 0700)
	for i, shift := range shifts {
		img := image.NewGray(image.Rect(0, 0, p.Width, p.Height))
		for y := 0; y < p.Height; y++ {
			for x := 0; x < p.Width; x++ {
				img.SetGray(x, y, color.Gray{uint8(math.Round(max(0, min(255, draw(x, y, shift)))))})
			}
		}
		f, e := os.Create(filepath.Join(dir, "frames", fmt.Sprintf("%06d.png", i+1)))
		if e != nil {
			t.Fatal(e)
		}
		if e = png.Encode(f, img); e != nil {
			t.Fatal(e)
		}
		f.Close()
		p.Times = append(p.Times, float64(i)*17)
	}
	if e := store.Save(p); e != nil {
		t.Fatal(e)
	}
	return store, p
}
func TestFractionalFeatureMovement(t *testing.T) {
	shifts := []float64{0, .2, .4, .6, .8, 1, 1.2}
	store, p := synthetic(t, func(x, y int, s float64) float64 {
		u, v := float64(x)-s-60, float64(y)-45
		return 120 + math.Exp(-(u*u+v*v)/900)*(45*math.Sin(u*.5)+35*math.Cos(v*.43)+25*math.Sin((u+v)*.3))
	}, shifts)
	got, e := store.Track(p.ID, []float64{40, 28, 40, 35}, 0, nil, nil, 8, .65)
	if e != nil {
		t.Fatal(e)
	}
	for i, want := range shifts {
		row := got.Samples[i]
		if !row.Valid || math.Abs(*row.X-40-want) > .12 {
			t.Fatalf("frame %d: want %.3f, got %+v", i, 40+want, row.X)
		}
	}
	if *got.Samples[1].X == *got.Samples[0].X {
		t.Fatal("fractional motion was quantized")
	}
}
func TestFractionalEdgesBothAxesAndLoss(t *testing.T) {
	for _, method := range []string{"edge-x", "edge-y"} {
		t.Run(method, func(t *testing.T) {
			shifts := []float64{0, .2, .4, .6, .8, 1, 1.2}
			store, p := synthetic(t, func(x, y int, s float64) float64 {
				v := float64(x)
				if method == "edge-y" {
					v = float64(y)
				}
				return 60 + 140*(1+math.Erf((v-50-s)/1.5))/2
			}, shifts)
			region := []float64{42, 20, 20, 50}
			if method == "edge-y" {
				region = []float64{20, 42, 80, 20}
			}
			got, e := store.TrackMethod(p.ID, region, 0, nil, nil, 8, .65, method)
			if e != nil {
				t.Fatal(e)
			}
			origin := *axisValue(got.Samples[0], string(method[len(method)-1]))
			for i, want := range shifts {
				value := axisValue(got.Samples[i], string(method[len(method)-1]))
				if value == nil || math.Abs(*value-origin-want) > .12 {
					t.Fatalf("frame %d: want delta %.3f, got %v", i, want, value)
				}
			}
			if got.Settings.Precision != "subpixel" {
				t.Fatal(got.Settings)
			}
			// A uniform frame must create a gap rather than a manufactured position.
			dir, _ := store.Folder(p.ID)
			img := image.NewGray(image.Rect(0, 0, 160, 100))
			f, _ := os.Create(filepath.Join(dir, "frames", "000004.png"))
			png.Encode(f, img)
			f.Close()
			got, e = store.TrackMethod(p.ID, region, 0, nil, nil, 8, .65, method)
			if e != nil {
				t.Fatal(e)
			}
			if got.Samples[3].Valid || got.Samples[3].X != nil || got.Samples[3].Y != nil {
				t.Fatal("uniform frame was accepted")
			}
		})
	}
}
func TestCurveTimingAndFit(t *testing.T) {
	curve := Curve{.2, 0, 0, 1}
	p := &Project{Times: []float64{}, Samples: []Sample{}}
	for i := 0; i <= 50; i++ {
		ms := float64(i) * 10
		value := 20 + 80*curve.At(ms/320)
		x, y := value, 0.0
		p.Times = append(p.Times, ms)
		p.Samples = append(p.Samples, Sample{Frame: i, T: ms, X: &x, Y: &y, Valid: true})
	}
	report, e := Measure(p, "x", 0, 50, curve, 300, true)
	if e != nil {
		t.Fatal(e)
	}
	if math.Abs(report.Duration-320) > .01 || report.RMSE > .001 {
		t.Fatal(report)
	}
	wrong, _ := Measure(p, "x", 0, 50, curve, 100, false)
	if wrong.RMSE < 5 {
		t.Fatal("wrong duration did not produce error")
	}
	p.Samples[15].Valid = false
	report, e = Measure(p, "x", 0, 50, curve, 320, false)
	if e != nil || report.Weak != 1 || report.Samples != 50 {
		t.Fatal(report, e)
	}
	p.Samples[0].Valid = false
	if _, e = Measure(p, "x", 0, 50, curve, 320, false); e == nil {
		t.Fatal("invalid alignment frame accepted")
	}
	if math.Abs((Curve{0, 0, 1, 1}).At(.25)-.25) > 1e-8 {
		t.Fatal("CSS time inversion failed")
	}
}

func TestEdgeCorrectionPreservesMethodAndPolarity(t *testing.T) {
	store, p := synthetic(t, func(x, y int, s float64) float64 {
		return 200 - 140*(1+math.Erf((float64(x)-50-s)/1.5))/2
	}, []float64{0, .2, .4, .6, .8})
	tracked, e := store.TrackMethod(p.ID, []float64{42, 20, 20, 50}, 0, nil, nil, 8, .65, "edge-x")
	if e != nil {
		t.Fatal(e)
	}
	got, e := store.Correct(p.ID, 2, []float64{44, 20, 20, 50})
	if e != nil {
		t.Fatal(e)
	}
	if got.Settings.Method != "edge-x" || !got.Samples[2].Manual || len(got.Anchors) != 2 {
		t.Fatal(got.Settings, got.Anchors)
	}
	for i, row := range got.Samples {
		if !row.Valid || math.Abs(*row.X-*tracked.Samples[0].X-float64(i)*.2) > .12 {
			t.Fatalf("frame %d: %+v", i, row)
		}
	}
}
