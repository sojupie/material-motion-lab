package analysis

import (
	"math"
	"testing"
)

func TestReferencePresets(t *testing.T) {
	refs := ReferencePresets()
	if len(refs) != 23 {
		t.Fatal(len(refs))
	}
	ids := map[string]bool{}
	for _, r := range refs {
		if ids[r.ID] || r.Source == "" {
			t.Fatal(r)
		}
		ids[r.ID] = true
		if e := r.Validate(); e != nil {
			t.Fatal(r, e)
		}
		if r.At(0, 300) != 0 {
			t.Fatal("initial position", r)
		}
		if r.Kind != "spring" && r.At(300, 300) != 1 {
			t.Fatal("final position", r)
		}
	}
	for _, speed := range []string{"fast", "default", "slow"} {
		a, _ := ReferencePreset("standard-" + speed + "-effects")
		b, _ := ReferencePreset("expressive-" + speed + "-effects")
		if a.Stiffness != b.Stiffness || a.Damping != 1 || b.Damping != 1 {
			t.Fatal(a, b)
		}
	}
	r, _ := ReferencePreset("expressive-fast-spatial")
	if r.Stiffness != 800 || r.Damping != .6 {
		t.Fatal(r)
	}
	r, _ = ReferencePreset("standard-default-spatial")
	if r.Stiffness != 700 || r.Damping != .9 {
		t.Fatal(r)
	}
	path, _ := ReferencePreset("emphasized")
	if math.Abs(path.At(166.666, 1000)-.4) > 1e-6 {
		t.Fatal("two-segment join", path.At(166.666, 1000))
	}
	if math.Abs(path.At(166.666-1e-5, 1000)-path.At(166.666+1e-5, 1000)) > 1e-5 {
		t.Fatal("discontinuous emphasized path")
	}
}
func TestSpringPhysics(t *testing.T) {
	r := Reference{Kind: "spring", Stiffness: 100, Damping: 1}
	if math.Abs(r.At(100, 300)-(1-2/math.E)) > 1e-12 {
		t.Fatal("critical spring")
	}
	r.Damping = .5
	peak := math.Pi / (10 * math.Sqrt(.75))
	if math.Abs(r.At(peak*1000, 300)-(1+math.Exp(-5*peak))) > 1e-12 {
		t.Fatal("underdamped overshoot")
	}
	for _, d := range []float64{0, .5, .999999, 1, 1.000001, 2, 100} {
		r.Damping = d
		r.Velocity = 2
		if math.Abs(r.At(.001, 300)/.000001-2) > .01 {
			t.Fatal("initial velocity", d, r.At(.001, 300))
		}
		if math.IsNaN(r.At(1000, 300)) || math.IsInf(r.At(1000, 300), 0) {
			t.Fatal("nonfinite spring", d)
		}
		if r.At(100, 300) != r.At(100, 600) {
			t.Fatal("spring was time stretched")
		}
	}
	for _, r := range []Reference{{Kind: "unknown"}, {Kind: "spring", Stiffness: 0}, {Kind: "spring", Stiffness: 100, Damping: -1}, {Kind: "spring", Stiffness: 100, Velocity: math.Inf(1)}, {Kind: "bezier", Curve: Curve{-1, 0, 1, 1}}} {
		if r.Validate() == nil {
			t.Fatal("invalid reference accepted", r)
		}
	}
}
func TestMeasureSpring(t *testing.T) {
	r, _ := ReferencePreset("expressive-fast-spatial")
	p := &Project{}
	for i := 0; i <= 375; i++ {
		ms := float64(i) * 4
		x := 20 + 80*r.At(ms, 300)
		y := 0.
		p.Times = append(p.Times, ms)
		p.Samples = append(p.Samples, Sample{Frame: i, T: ms, X: &x, Y: &y, Valid: true})
	}
	report, e := MeasureReference(p, "x", 0, 375, r, 300, false)
	if e != nil || report.RMSE > .001 {
		t.Fatal(report.RMSE, e)
	}
	overshot := false
	for _, point := range report.Points {
		if point.Value > report.Displacement {
			overshot = true
		}
	}
	if !overshot {
		t.Fatal("spring overshoot flattened")
	}
	if _, e = MeasureReference(p, "x", 0, 375, r, 300, true); e == nil {
		t.Fatal("spring duration fit accepted")
	}
}
