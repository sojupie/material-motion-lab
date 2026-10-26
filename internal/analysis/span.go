package analysis

import (
	"fmt"
	"gocv.io/x/gocv"
	"math"
	"path/filepath"
)

// Track opposing straight boundaries through the central 60% of a box.
// Width/height are independent edge measurements, not a scaled patch estimate.
func (s Store) trackSpan(p *Project, selection Region, start, last int, fixed map[int]Region, search int, threshold float64, method string) (*Project, error) {
	folder, _ := s.Folder(p.ID)
	horizontal := method == "width"
	r := selection
	positions := [2]float64{}
	strengths := [2]float64{}
	signs := [2]float64{}
	samples := []Sample{}
	for i := start; i <= last; i++ {
		gray := gocv.IMRead(filepath.Join(folder, "frames", fmt.Sprintf("%06d.png", i+1)), gocv.IMReadGrayScale)
		if gray.Empty() {
			gray.Close()
			return nil, fmt.Errorf("cannot decode frame %d", i)
		}
		anchor, manual := fixed[i]
		if manual {
			r = anchor
		}
		strip := r
		limit := p.Height
		if horizontal {
			strip[1] += r[3] / 5
			strip[3] = max(4, r[3]*3/5)
			limit = p.Width
		} else {
			strip[0] += r[2] / 5
			strip[2] = max(4, r[2]*3/5)
		}
		valid := true
		score := 1.
		for edge := 0; edge < 2; edge++ {
			expected := positions[edge]
			radius := search
			if manual {
				if horizontal {
					expected = float64(r[0] + edge*r[2])
				} else {
					expected = float64(r[1] + edge*r[3])
				}
				radius = min(search, 8)
			}
			lo, hi := max(0, int(math.Floor(expected))-radius-1), min(limit, int(math.Ceil(expected))+radius+2)
			polarity := signs[edge]
			if manual {
				polarity = 0
			}
			peak, strength, sign := edgePeak(edgeProfile(gray, strip, horizontal, lo, hi), polarity, expected-float64(lo))
			ratio := 1.
			if !manual {
				ratio = strength / strengths[edge]
			}
			if strength < 2 || ratio < threshold {
				valid = false
			}
			if manual {
				strengths[edge] = strength
				signs[edge] = sign
			}
			score = min(score, ratio)
			if strength >= 2 && ratio >= threshold {
				positions[edge] = float64(lo) + peak
			}
		}
		gray.Close()
		if positions[1] <= positions[0] {
			valid = false
		}
		if manual && !valid {
			return nil, fmt.Errorf("frame %d: select a box with two distinct opposing straight edges", i)
		}
		row := Sample{Frame: i, T: p.Times[i], Width: r[2], Height: r[3], Score: score, Valid: valid, Manual: manual}
		if valid {
			span := positions[1] - positions[0]
			x, y := float64(r[0]), float64(r[1])
			if horizontal {
				x = positions[0]
				row.MeasuredWidth = &span
			} else {
				y = positions[0]
				row.MeasuredHeight = &span
			}
			row.X = &x
			row.Y = &y
		}
		samples = append(samples, row)
	}
	return s.finishTrack(p, selection, start, last, fixed, samples, search, threshold, method)
}
