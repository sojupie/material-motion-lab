package analysis

import (
	"encoding/xml"
	"image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"

	"strings"
	"testing"
)

func spanFixture(t *testing.T, method string) (Store, *Project) {
	t.Helper()
	shifts := []float64{0, .3, .8, 1.5, 2.2, 3}
	return synthetic(t, func(x, y int, s float64) float64 {
		u := float64(x)
		if method == "height" {
			u = float64(y)
		}
		// Both edges translate; separation grows by twice s.
		left, right := 25+s, 65+3*s
		return 230 - 190*(.5+.5*math.Tanh((u-left)/1.3))*(.5-.5*math.Tanh((u-right)/1.3))
	}, shifts)
}
func TestOpposingEdgesMeasureSizeIndependentOfTranslation(t *testing.T) {
	for _, axis := range []string{"width", "height"} {
		t.Run(axis, func(t *testing.T) {
			store, p := spanFixture(t, axis)
			region := []float64{25, 15, 40, 65}
			if axis == "height" {
				region = []float64{15, 25, 90, 40}
			}
			got, e := store.TrackMethod(p.ID, region, 0, nil, nil, 8, .65, axis)
			if e != nil {
				t.Fatal(e)
			}
			for i, s := range []float64{0, .3, .8, 1.5, 2.2, 3} {
				row := got.Samples[i]
				value := axisValue(row, axis)
				if !row.Valid || value == nil || math.Abs(*value-(40+2*s)) > .25 {
					t.Fatalf("frame %d: %+v, span %v", i, row, value)
				}
				if row.Width != int(region[2]) || row.Height != int(region[3]) {
					t.Fatal("ROI dimensions changed")
				}
			}
			report, e := store.MeasureReference(p.ID, axis, 0, 5, Reference{Kind: "bezier", Curve: [4]float64{0, 0, 1, 1}}, 85, false)
			if e != nil || math.Abs(report.Displacement-6) > .25 {
				t.Fatal(report, e)
			}
			file, e := store.CSV(p.ID)
			if e != nil {
				t.Fatal(e)
			}
			bytes, _ := os.ReadFile(file)
			if !strings.Contains(string(bytes), "measuredWidth,measuredHeight") {
				t.Fatal(string(bytes))
			}
		})
	}
}
func TestChartAndTrimmedVideoExport(t *testing.T) {
	store, p := spanFixture(t, "width")
	p, e := store.TrackMethod(p.ID, []float64{25, 15, 40, 65}, 0, nil, nil, 8, .65, "width")
	if e != nil {
		t.Fatal(e)
	}
	p.Name = "A < B & C"
	store.Save(p)
	ref, _ := ReferencePreset("md3-standard")
	o := DefaultVideoOptions(p, "width")
	o.First = 2
	o.Last = 4
	o.Speed = .5
	o.Repeat = 2
	o.Chart.Reference = &ref
	o.Chart.Duration = 60
	before, _ := store.Load(p.ID)
	data, e := store.buildChart(p, o.Chart)
	if e != nil {
		t.Fatal(e)
	}
	if len(data.Series) != 1 || len(data.Series[0].Points) != 6 {
		t.Fatal(data)
	}
	svg, e := store.Chart(p.ID, o.Chart)
	if e != nil {
		t.Fatal(e)
	}
	bytes, _ := os.ReadFile(svg)
	if !strings.Contains(string(bytes), "A &lt; B &amp; C") || !strings.Contains(string(bytes), "RMSE") || !strings.Contains(string(bytes), "stroke-dasharray") {
		t.Fatal(string(bytes))
	}
	dec := xml.NewDecoder(strings.NewReader(string(bytes)))
	for {
		_, e := dec.Token()
		if e == io.EOF {
			break
		}
		if e != nil {
			t.Fatal(e)
		}
	}
	path, e := store.VideoWithOptions(p.ID, o)
	if e != nil {
		t.Fatal(e)
	}
	inspected, e := Inspect(path)
	if e != nil {
		t.Fatal(e)
	}
	if len(inspected.Times) != 7 {
		t.Fatalf("exported %d frames, want 3 frames repeated twice plus final frame", len(inspected.Times))
	}
	for i, want := range []float64{0, 34, 68, 102, 136, 170, 204} {
		if math.Abs(inspected.Times[i]-want) > 1 {
			t.Fatalf("timestamps: %v", inspected.Times)
		}
	}
	after, _ := store.Load(p.ID)
	if len(after.Samples) != len(before.Samples) || after.Settings.Start != before.Settings.Start {
		t.Fatal("export changed project")
	}
	for _, mutate := range []func(*VideoOptions){func(v *VideoOptions) { v.Last = 99 }, func(v *VideoOptions) { v.First = -1 }, func(v *VideoOptions) { v.Speed = 0 }, func(v *VideoOptions) { v.Repeat = 11 }, func(v *VideoOptions) { v.Chart.Scale = &[2]float64{2, 1} }} {
		bad := o
		mutate(&bad)
		if _, e := store.VideoWithOptions(p.ID, bad); e == nil {
			t.Fatal("invalid export accepted", bad)
		}
	}
}
func TestChartComparisonOffsetAndScale(t *testing.T) {
	store, p := spanFixture(t, "width")
	p, e := store.TrackMethod(p.ID, []float64{25, 15, 40, 65}, 0, nil, nil, 8, .65, "width")
	if e != nil {
		t.Fatal(e)
	}
	other := *p
	other.ID = "0c57da09-e860-44f3-9f7f-2cd3cdbb1263"
	folder, _ := store.Folder(other.ID)
	os.MkdirAll(folder, 0700)
	if e := store.Save(&other); e != nil {
		t.Fatal(e)
	}
	o := DefaultVideoOptions(p, "width").Chart
	o.Units = "progress"
	o.Scale = &[2]float64{95, 105}
	o.Comparison = &ChartComparison{ID: other.ID, First: 0, Last: 5, Offset: 17}
	data, e := store.buildChart(p, o)
	if e != nil {
		t.Fatal(e)
	}
	if data.Low != 95 || data.High != 105 || data.Series[1].Points[0].T != 17 || math.Abs(data.Series[1].Points[5].V-100) > 1e-8 {
		t.Fatal(data)
	}
	original, _ := store.Folder(p.ID)
	if e := os.Symlink(filepath.Join(original, "frames"), filepath.Join(folder, "frames")); e != nil {
		t.Fatal(e)
	}
	video := DefaultVideoOptions(p, "width")
	video.First = 2
	video.Last = 3
	video.Chart = o
	if _, e := store.VideoWithOptions(p.ID, video); e != nil {
		t.Fatal("aligned comparison export", e)
	}

}

func TestSpanLossDoesNotInventWidthAndCorrectionRestoresTracking(t *testing.T) {
	store, p := synthetic(t, func(x, y int, s float64) float64 {
		if s == 1 {
			return 230
		}
		u := float64(x)
		return 230 - 190*(.5+.5*math.Tanh((u-25)/1.3))*(.5-.5*math.Tanh((u-65)/1.3))
	}, []float64{0, 1, 2})
	p, e := store.TrackMethod(p.ID, []float64{25, 15, 40, 65}, 0, nil, nil, 8, .65, "width")
	if e != nil {
		t.Fatal(e)
	}
	if p.Samples[1].Valid || p.Samples[1].MeasuredWidth != nil || !p.Samples[2].Valid {
		t.Fatal(p.Samples)
	}
	p, e = store.Correct(p.ID, 2, []float64{25, 15, 40, 65})
	if e != nil {
		t.Fatal(e)
	}
	if !p.Samples[2].Manual || !p.Samples[2].Valid || p.Samples[2].MeasuredWidth == nil {
		t.Fatal(p.Samples[2])
	}
}

func TestExportPreviewUsesVideoRendererWithoutChangingProject(t *testing.T) {
	store, p := spanFixture(t, "width")
	p, trackErr := store.TrackMethod(p.ID, []float64{25, 15, 40, 65}, 0, nil, nil, 8, .65, "width")
	if trackErr != nil {
		t.Fatal(trackErr)
	}
	before, err := store.Load(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	options := DefaultVideoOptions(p, "width")
	file, err := store.Preview(p.ID, options)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(file)
	f, err := os.Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	image, err := png.DecodeConfig(f)
	if err != nil {
		t.Fatal(err)
	}
	if image.Width != 1600 || image.Height != 900 {
		t.Fatalf("preview dimensions: %+v", image)
	}
	after, err := store.Load(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("preview changed stored project")
	}
	options.First = len(p.Times)
	if _, err = store.Preview(p.ID, options); err == nil {
		t.Fatal("invalid preview interval accepted")
	}
}
