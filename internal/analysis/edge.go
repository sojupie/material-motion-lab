package analysis

import (
	"fmt"
	"gocv.io/x/gocv"
	"math"
	"path/filepath"
)

// Average a straight strip across the edge. The selected strip must avoid
// corners, artwork and other boundaries; its orthogonal position stays fixed.
func edgeProfile(gray gocv.Mat, r Region, horizontal bool, lo, hi int) []float64 {
	profile := make([]float64, hi-lo)
	for i := lo; i < hi; i++ {
		var total float64
		if horizontal {
			for y := r[1]; y < r[1]+r[3]; y++ {
				total += float64(gray.GetUCharAt(y, i))
			}
			profile[i-lo] = total / float64(r[3])
		} else {
			for x := r[0]; x < r[0]+r[2]; x++ {
				total += float64(gray.GetUCharAt(i, x))
			}
			profile[i-lo] = total / float64(r[2])
		}
	}
	return profile
}
func edgePeak(profile []float64, polarity float64, expected float64) (position, strength, sign float64) {
	if len(profile) < 3 {
		return 0, 0, 0
	}
	gradient := make([]float64, len(profile))
	best := -1
	bestWeight := -1.0
	for i := 1; i+1 < len(profile); i++ {
		v := (profile[i+1] - profile[i-1]) / 2
		gradient[i] = v
		if polarity != 0 && v*polarity <= 0 {
			continue
		}
		weight := math.Abs(v)
		if expected >= 0 {
			weight /= 1 + .01*math.Abs(float64(i)-expected)
		}
		if weight > bestWeight {
			best = i
			bestWeight = weight
		}
	}
	if best < 0 {
		return 0, 0, 0
	}
	strength = math.Abs(gradient[best])
	sign = math.Copysign(1, gradient[best])
	offset := 0.0
	if best > 1 && best+2 < len(profile) {
		offset = parabola(math.Abs(gradient[best-1]), strength, math.Abs(gradient[best+1]))
	}
	return float64(best) + offset, strength, sign
}
func (s Store) trackEdge(p *Project, selection Region, start, last int, fixed map[int]Region, search int, threshold float64, method string) (*Project, error) {
	folder, _ := s.Folder(p.ID)
	horizontal := method == "edge-x"
	r := selection
	samples := []Sample{}
	position, strength, polarity := 0.0, 0.0, 0.0
	for i := start; i <= last; i++ {
		gray := gocv.IMRead(filepath.Join(folder, "frames", fmt.Sprintf("%06d.png", i+1)), gocv.IMReadGrayScale)
		if gray.Empty() {
			gray.Close()
			return nil, fmt.Errorf("cannot decode frame %d", i)
		}
		anchor, manual := fixed[i]
		limit := p.Height
		if horizontal {
			limit = p.Width
		}
		lo, hi := 0, 0
		expected := -1.0
		if manual {
			r = anchor
			if horizontal {
				lo, hi = r[0], r[0]+r[2]
			} else {
				lo, hi = r[1], r[1]+r[3]
			}
		} else {
			lo = max(0, int(math.Floor(position))-search-1)
			hi = min(limit, int(math.Ceil(position))+search+2)
			expected = position - float64(lo)
		}
		profile := edgeProfile(gray, r, horizontal, lo, hi)
		gray.Close()
		sign := polarity
		if manual {
			sign = 0
		}
		peak, current, newSign := edgePeak(profile, sign, expected)
		score := 1.0
		valid := current >= 2
		if manual {
			if !valid {
				return nil, fmt.Errorf("frame %d: no distinct edge; select a straight boundary with visible contrast", i)
			}
			position = float64(lo) + peak
			strength = current
			polarity = newSign
		} else {
			score = current / strength
			valid = valid && score >= threshold
			if valid {
				position = float64(lo) + peak
			}
		}
		row := Sample{Frame: i, T: p.Times[i], Width: r[2], Height: r[3], Score: score, Valid: valid, Manual: manual}
		if valid {
			x, y := position, float64(r[1])
			if !horizontal {
				x, y = float64(r[0]), position
			}
			row.X = &x
			row.Y = &y
		}
		samples = append(samples, row)
	}
	return s.finishTrack(p, selection, start, last, fixed, samples, search, threshold, method)
}
