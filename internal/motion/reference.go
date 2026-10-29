package motion

import (
	"fmt"
	"math"
)

// Reference uses seconds for spring time and unit mass. Velocity is travel distances/second.
type Reference struct {
	ID        string  `json:"id,omitempty"`
	Label     string  `json:"label,omitempty"`
	Kind      string  `json:"kind"`
	Curve     Curve   `json:"curve"`
	Stiffness float64 `json:"stiffness,omitempty"`
	Damping   float64 `json:"damping,omitempty"`
	Velocity  float64 `json:"velocity,omitempty"`
	Source    string  `json:"source,omitempty"`
}

// Values checked against AOSP MotionTokens v0_103 and motion scheme tokens v0_14_0,
// and MDC-Android docs/theming/Motion.md, on 2026-10-26. See docs/references.md.
func ReferencePresets() []Reference {
	motion := "https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md"
	compose := "https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/"
	result := []Reference{}
	for _, p := range []struct {
		id, label string
		curve     Curve
	}{
		{"md3", "MD3 standard", Curve{.2, 0, 0, 1}},
		{"standard-accelerate", "MD3 standard accelerate", Curve{.3, 0, 1, 1}},
		{"standard-decelerate", "MD3 standard decelerate", Curve{0, 0, 0, 1}},
		{"emphasized-bezier", "MD3 emphasized (Compose Bézier)", Curve{.2, 0, 0, 1}},
		{"emphasized-accelerate", "MD3 emphasized accelerate", Curve{.3, 0, .8, .15}},
		{"emphasized-decelerate", "MD3 emphasized decelerate", Curve{.05, .7, .1, 1}},
		{"legacy", "Material legacy", Curve{.4, 0, .2, 1}},
		{"legacy-accelerate", "Material legacy accelerate", Curve{.4, 0, 1, 1}},
		{"legacy-decelerate", "Material legacy decelerate", Curve{0, 0, .2, 1}},
		{"linear", "Linear", Curve{0, 0, 1, 1}},
	} {
		result = append(result, Reference{ID: p.id, Label: p.label, Kind: "bezier", Curve: p.curve, Source: compose + "MotionTokens.kt"})
	}
	result = append(result, Reference{ID: "emphasized", Label: "MD3 emphasized (path)", Kind: "emphasized", Source: motion})
	for _, scheme := range []string{"standard", "expressive"} {
		for i, speed := range []string{"fast", "default", "slow"} {
			stiffness, damping := []float64{1400, 700, 300}[i], .9
			if scheme == "expressive" {
				stiffness = []float64{800, 380, 200}[i]
				damping = []float64{.6, .8, .8}[i]
			}
			source := compose + "StandardMotionTokens.kt"
			if scheme == "expressive" {
				source = compose + "ExpressiveMotionTokens.kt"
			}
			for _, kind := range []string{"spatial", "effects"} {
				k, z := stiffness, damping
				if kind == "effects" {
					k = []float64{3800, 1600, 800}[i]
					z = 1
				}
				result = append(result, Reference{ID: scheme + "-" + speed + "-" + kind, Label: "MD3 " + scheme + " " + speed + " " + kind, Kind: "spring", Stiffness: k, Damping: z, Source: source})
			}
		}
	}
	return result
}
func ReferencePreset(id string) (Reference, error) {
	if id == "md3-standard" {
		id = "md3"
	}
	for _, ref := range ReferencePresets() {
		if ref.ID == id {
			return ref, nil
		}
	}
	return Reference{}, fmt.Errorf("unknown motion reference %q", id)
}
func (r Reference) Validate() error {
	switch r.Kind {
	case "bezier":
		return r.Curve.Validate()
	case "emphasized":
		return nil
	case "spring":
		for _, v := range []float64{r.Stiffness, r.Damping, r.Velocity} {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return fmt.Errorf("spring parameters must be finite")
			}
		}
		if r.Stiffness <= 0 || r.Stiffness > 1e6 || r.Damping < 0 || r.Damping > 100 || math.Abs(r.Velocity) > 1000 {
			return fmt.Errorf("spring requires stiffness 0–1000000 (exclusive of zero), damping ratio 0–100, and velocity -1000–1000")
		}
		return nil
	default:
		return fmt.Errorf("unknown reference kind")
	}
}
func (r Reference) At(ms, duration float64) float64 {
	if ms <= 0 {
		return 0
	}
	switch r.Kind {
	case "spring":
		t, w, z := ms/1000, math.Sqrt(r.Stiffness), r.Damping
		if z < 1 {
			wd := w * math.Sqrt(1-z*z)
			return 1 + math.Exp(-z*w*t)*(-math.Cos(wd*t)+(r.Velocity-z*w)/wd*math.Sin(wd*t))
		}
		if z == 1 {
			return 1 + math.Exp(-w*t)*(-1+(r.Velocity-w)*t)
		}
		root := math.Sqrt(z*z - 1)
		a, b := -w/(z+root), -w*(z+root)
		c := (r.Velocity + b) / (a - b)
		return 1 + c*math.Exp(a*t) + (-1-c)*math.Exp(b*t)
	case "emphasized":
		t := ms / duration
		if t >= 1 {
			return 1
		}
		// MDC's two cubic segments, inverted by their x coordinate.
		p := [8]float64{0, 0, .05, 0, .133333, .06, .166666, .4}
		if t > .166666 {
			p = [8]float64{.166666, .4, .208333, .82, .25, 1, 1, 1}
		}
		at := func(u float64, axis int) float64 {
			v := 1 - u
			return v*v*v*p[axis] + 3*v*v*u*p[2+axis] + 3*v*u*u*p[4+axis] + u*u*u*p[6+axis]
		}
		lo, hi := 0., 1.
		for i := 0; i < 40; i++ {
			mid := (lo + hi) / 2
			if at(mid, 0) < t {
				lo = mid
			} else {
				hi = mid
			}
		}
		return at((lo+hi)/2, 1)
	default:
		return r.Curve.At(ms / duration)
	}
}
