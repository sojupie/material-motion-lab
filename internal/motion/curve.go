package motion

import (
	"fmt"
	"math"
)

type Curve [4]float64

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
