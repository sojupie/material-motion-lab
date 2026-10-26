package analysis

import (
	"fmt"
	"math"
)

type Curve [4]float64
type ExpectedPoint struct {
	T     float64 `json:"t"`
	Value float64 `json:"value"`
}
type Measurement struct {
	Reference    Reference       `json:"reference"`
	Start        int             `json:"start"`
	End          int             `json:"end"`
	Duration     float64         `json:"duration"`
	RMSE         float64         `json:"rmse"`
	MaxError     float64         `json:"maxError"`
	Samples      int             `json:"samples"`
	Weak         int             `json:"weak"`
	Displacement float64         `json:"displacement"`
	Points       []ExpectedPoint `json:"points"`
}

func (c Curve) Validate() error {
	for _, v := range c {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("curve coordinates must be finite")
		}
	}
	if c[0] < 0 || c[0] > 1 || c[2] < 0 || c[2] > 1 || math.Abs(c[1]) > 10 || math.Abs(c[3]) > 10 {
		return fmt.Errorf("invalid cubic-bezier coordinates")
	}
	return nil
}

// CSS cubic-bezier uses x as elapsed time, so solve x(u) before evaluating y(u).
func (c Curve) At(t float64) float64 {
	if t <= 0 {
		return 0
	}
	if t >= 1 {
		return 1
	}
	bezier := func(u, a, b float64) float64 { return 3*(1-u)*(1-u)*u*a + 3*(1-u)*u*u*b + u*u*u }
	lo, hi := 0.0, 1.0
	for i := 0; i < 40; i++ {
		mid := (lo + hi) / 2
		if bezier(mid, c[0], c[2]) < t {
			lo = mid
		} else {
			hi = mid
		}
	}
	return bezier((lo+hi)/2, c[1], c[3])
}
func (s Store) Measure(id, axis string, start, end int, curve Curve, duration float64, fit bool) (Measurement, error) {
	p, e := s.Load(id)
	if e != nil {
		return Measurement{}, e
	}
	return Measure(p, axis, start, end, curve, duration, fit)
}
func Measure(p *Project, axis string, start, end int, curve Curve, duration float64, fit bool) (Measurement, error) {
	return MeasureReference(p, axis, start, end, Reference{Kind: "bezier", Curve: curve}, duration, fit)
}
func (s Store) MeasureReference(id, axis string, start, end int, ref Reference, duration float64, fit bool) (Measurement, error) {
	p, e := s.Load(id)
	if e != nil {
		return Measurement{}, e
	}
	return MeasureReference(p, axis, start, end, ref, duration, fit)
}
func MeasureReference(p *Project, axis string, start, end int, ref Reference, duration float64, fit bool) (Measurement, error) {
	var result Measurement
	if axis != "x" && axis != "y" {
		return result, fmt.Errorf("axis must be x or y")
	}
	if e := ref.Validate(); e != nil {
		return result, e
	}
	if start < 0 || end <= start || end >= len(p.Times) {
		return result, fmt.Errorf("choose an alignment frame before the last frame")
	}
	if ref.Kind != "spring" && (math.IsNaN(duration) || math.IsInf(duration, 0) || duration < 1 || duration > 60000) {
		return result, fmt.Errorf("reference duration must be 1–60000 ms")
	}
	if ref.Kind == "spring" {
		if fit {
			return result, fmt.Errorf("springs use physical time; duration fitting applies to easing curves")
		}
		duration = p.Times[end] - p.Times[start]
	}
	var from, to *float64
	selected := []Sample{}
	weak := 0
	for _, sample := range p.Samples {
		if sample.Frame < start || sample.Frame > end {
			continue
		}
		if !sample.Valid || axisValue(sample, axis) == nil {
			weak++
			continue
		}
		if sample.Frame == start {
			from = axisValue(sample, axis)
		}
		if sample.Frame == end {
			to = axisValue(sample, axis)
		}
		selected = append(selected, sample)
	}
	if from == nil || to == nil {
		return result, fmt.Errorf("alignment and last frames both need valid tracking samples")
	}
	distance := *to - *from
	if math.Abs(distance) < 1e-6 {
		return result, fmt.Errorf("choose an interval with different start and end positions")
	}
	if len(selected) < 3 {
		return result, fmt.Errorf("at least three valid samples are needed")
	}
	zero := p.Times[start]
	errorAt := func(d float64) (float64, float64) {
		var squares, maximum float64
		for _, sample := range selected {
			expected := *from + distance*ref.At(sample.T-zero, d)
			delta := math.Abs(*axisValue(sample, axis) - expected)
			squares += delta * delta
			maximum = max(maximum, delta)
		}
		return math.Sqrt(squares / float64(len(selected))), maximum
	}
	if fit {
		lower, upper := 1.0, min(60000.0, max(2, (p.Times[end]-zero)*2))
		step := (upper - lower) / 240
		best := math.Inf(1)
		chosen := duration
		for i := 0; i <= 240; i++ {
			candidate := lower + float64(i)*step
			err, _ := errorAt(candidate)
			if err < best {
				best = err
				chosen = candidate
			}
		}
		lo, hi := max(lower, chosen-step), min(upper, chosen+step)
		for i := 0; i < 60; i++ {
			a, b := lo+(hi-lo)/3, hi-(hi-lo)/3
			ea, _ := errorAt(a)
			eb, _ := errorAt(b)
			if ea < eb {
				hi = b
			} else {
				lo = a
			}
		}
		duration = (lo + hi) / 2
	}
	rmse, maximum := errorAt(duration)
	result = Measurement{Reference: ref, Start: start, End: end, Duration: duration, RMSE: rmse, MaxError: maximum, Samples: len(selected), Weak: weak, Displacement: distance, Points: []ExpectedPoint{}}
	// Sample the reference across the measured interval and full reference duration.
	extent := max(duration, p.Times[end]-zero)
	steps := max(120, min(15000, int(math.Ceil(extent/4))))
	for i := 0; i <= steps; i++ {
		t := extent * float64(i) / float64(steps)
		result.Points = append(result.Points, ExpectedPoint{T: t, Value: distance * ref.At(t, duration)})
	}
	return result, nil
}
