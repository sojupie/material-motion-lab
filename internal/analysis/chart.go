package analysis

import (
	"fmt"
	"html"
	"math"
	"os"
	"strings"
)

func referenceDetails(r Reference, duration float64) string {
	if r.Kind == "spring" {
		return fmt.Sprintf("Stiffness: %g  Damping ratio: %g  Velocity: %g/s", r.Stiffness, r.Damping, r.Velocity)
	}
	if r.Kind == "emphasized" {
		return fmt.Sprintf("Emphasized path  Duration: %g ms", duration)
	}
	return fmt.Sprintf("Bezier: %g, %g, %g, %g  Duration: %g ms", r.Curve[0], r.Curve[1], r.Curve[2], r.Curve[3], duration)
}

type ChartComparison struct {
	ID     string  `json:"id"`
	First  int     `json:"first"`
	Last   int     `json:"last"`
	Offset float64 `json:"offset"`
}
type ChartOptions struct {
	Axis       string           `json:"axis"`
	Units      string           `json:"units"`
	Start      int              `json:"start"`
	End        int              `json:"end"`
	Reference  *Reference       `json:"reference,omitempty"`
	Duration   float64          `json:"duration"`
	Window     *[2]float64      `json:"window,omitempty"`
	Scale      *[2]float64      `json:"scale,omitempty"`
	Statistics bool             `json:"statistics"`
	Markers    bool             `json:"markers"`
	Comparison *ChartComparison `json:"comparison,omitempty"`
}
type chartPoint struct {
	T, V          float64
	Valid, Manual bool
	Frame         int
}
type chartSeries struct {
	Name             string
	Points, Expected []chartPoint
	Report           *Measurement
	Samples, Weak    int
	Offset           float64
	Project          *Project
}
type chartData struct {
	Options             ChartOptions
	Min, Max, Low, High float64
	Unit, Title         string
	Series              []chartSeries
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func validateChart(p *Project, o ChartOptions) error {
	if o.Axis != "x" && o.Axis != "y" && o.Axis != "width" && o.Axis != "height" {
		return fmt.Errorf("invalid chart axis")
	}
	if o.Units != "px" && o.Units != "progress" {
		return fmt.Errorf("units must be px or progress")
	}
	if o.Start < 0 || o.End < o.Start || o.End >= len(p.Times) {
		return fmt.Errorf("chart range outside recording")
	}
	for _, bounds := range []*[2]float64{o.Window, o.Scale} {
		if bounds != nil && (!finite(bounds[0]) || !finite(bounds[1]) || bounds[1] <= bounds[0] || math.Abs(bounds[0]) > 1e9 || math.Abs(bounds[1]) > 1e9) {
			return fmt.Errorf("invalid chart bounds")
		}
	}
	if o.Reference != nil {
		if e := o.Reference.Validate(); e != nil {
			return e
		}
	}
	return nil
}
func (s Store) buildChart(p *Project, o ChartOptions) (chartData, error) {
	c := chartData{Options: o, Min: p.Times[max(0, min(o.Start, len(p.Times)-1))], Unit: "px"}
	if e := validateChart(p, o); e != nil {
		return c, e
	}
	c.Max = max(c.Min+1, p.Times[o.End])
	if o.Window != nil {
		c.Min = o.Window[0]
		c.Max = o.Window[1]
	}
	c.Title = map[string]string{"x": "Horizontal displacement", "y": "Vertical displacement", "width": "Width change", "height": "Height change"}[o.Axis]
	if o.Units == "progress" {
		c.Unit = "%"
	}
	projects := []*Project{p}
	ranges := [][2]int{{o.Start, o.End}}
	offsets := []float64{0}
	if q := o.Comparison; q != nil {
		if q.ID == p.ID || !finite(q.Offset) || math.Abs(q.Offset) > 86400000 {
			return c, fmt.Errorf("invalid comparison")
		}
		other, e := s.Load(q.ID)
		if e != nil {
			return c, e
		}
		otherOptions := o
		otherOptions.Start = q.First
		otherOptions.End = q.Last
		otherOptions.Comparison = nil
		if e = validateChart(other, otherOptions); e != nil {
			return c, e
		}
		projects = append(projects, other)
		ranges = append(ranges, [2]int{q.First, q.Last})
		offsets = append(offsets, q.Offset)
	}
	values := []float64{}
	for i, project := range projects {
		first, last := ranges[i][0], ranges[i][1]
		series := chartSeries{Name: project.Name, Offset: offsets[i], Project: project}
		var origin, target *float64
		for _, v := range project.Samples {
			if v.Valid {
				if v.Frame == first {
					origin = axisValue(v, o.Axis)
				}
				if v.Frame == last {
					target = axisValue(v, o.Axis)
				}
			}
		}
		if origin == nil {
			return c, fmt.Errorf("%s: first chart frame needs a valid %s measurement", project.Name, o.Axis)
		}
		distance := 0.
		if target != nil {
			distance = *target - *origin
		}
		if o.Units == "progress" && math.Abs(distance) < 1e-6 {
			return c, fmt.Errorf("progress requires different measured start and end positions")
		}
		factor := 1.
		if o.Units == "progress" {
			factor = 100 / distance
		}
		for _, row := range project.Samples {
			if row.Frame < first || row.Frame > last {
				continue
			}
			point := chartPoint{T: row.T + offsets[i], Frame: row.Frame, Manual: row.Manual, Valid: row.Valid && axisValue(row, o.Axis) != nil}
			if point.Valid {
				point.V = (*axisValue(row, o.Axis) - *origin) * factor
				series.Samples++
				if point.T >= c.Min && point.T <= c.Max {
					values = append(values, point.V)
				}
			} else {
				series.Weak++
			}
			series.Points = append(series.Points, point)
		}
		if o.Reference != nil {
			report, e := MeasureReference(project, o.Axis, first, last, *o.Reference, o.Duration, false)
			if e != nil {
				return c, e
			}
			series.Report = &report
			for _, point := range report.Points {
				v := chartPoint{T: point.T + project.Times[first] + offsets[i], V: point.Value * factor, Valid: true}
				series.Expected = append(series.Expected, v)
				if v.T >= c.Min && v.T <= c.Max {
					values = append(values, v.V)
				}
			}
		}
		c.Series = append(c.Series, series)
	}
	if len(values) == 0 {
		return c, fmt.Errorf("no valid measurements in visible chart interval")
	}
	c.Low, c.High = values[0], values[0]
	for _, v := range values {
		c.Low = min(c.Low, v)
		c.High = max(c.High, v)
	}
	pad := max(.1, (c.High-c.Low)*.1)
	if c.Unit == "%" {
		pad = max(1, pad)
	}
	c.Low -= pad
	c.High += pad
	if o.Scale != nil {
		c.Low = o.Scale[0]
		c.High = o.Scale[1]
	}
	return c, nil
}
func (c chartData) summary(i int) string {
	s := c.Series[i]
	label := fmt.Sprintf("%c", 'A'+i)
	if s.Report == nil {
		return fmt.Sprintf("%s: %d valid, %d weak", label, s.Samples, s.Weak)
	}
	factor := 1.
	if c.Unit == "%" {
		factor = 100 / math.Abs(s.Report.Displacement)
	}
	return fmt.Sprintf("%s: RMSE %.3f %s; max %.3f %s; %d valid, %d weak", label, s.Report.RMSE*factor, c.Unit, s.Report.MaxError*factor, c.Unit, s.Samples, s.Weak)
}
func (c chartData) svg() string {
	var b strings.Builder
	fmt.Fprintln(&b, `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="850" viewBox="0 0 1400 850"><rect width="1400" height="850" fill="#fcf9ff"/><style>text{font-family:Arial,sans-serif;fill:#292533;font-size:18px}.grid{stroke:#ded8e4}</style>`)
	label := func(x, y float64, t string) {
		fmt.Fprintf(&b, `<text x="%.2f" y="%.2f">%s</text>`, x, y, html.EscapeString(t))
	}
	label(75, 40, c.Title+" ("+c.Unit+")")
	for i, s := range c.Series {
		label(75, float64(75+i*27), fmt.Sprintf("%c: %s", 'A'+i, s.Name))
	}
	if c.Options.Reference != nil {
		r := c.Options.Reference
		name := r.Label
		if name == "" {
			name = "Custom " + r.Kind
		}
		label(75, 130, "Reference: "+name)
		label(75, 155, referenceDetails(*r, c.Options.Duration))
	}
	top, bottom, left, right := 180., 750., 90., 1370.
	x := func(t float64) float64 { return left + (t-c.Min)/(c.Max-c.Min)*(right-left) }
	y := func(v float64) float64 { return bottom - (v-c.Low)/(c.High-c.Low)*(bottom-top) }
	fmt.Fprintf(&b, `<defs><clipPath id="plot"><rect x="%.0f" y="%.0f" width="%.0f" height="%.0f"/></clipPath></defs>`, left, top, right-left, bottom-top)
	for i := 0; i <= 5; i++ {
		t := c.Min + (c.Max-c.Min)*float64(i)/5
		v := c.Low + (c.High-c.Low)*float64(i)/5
		fmt.Fprintf(&b, `<path d="M%.2f %.2fV%.2f M%.2f %.2fH%.2f" class="grid"/>`, x(t), top, bottom, left, y(v), right)
		label(x(t)-20, bottom+28, fmt.Sprintf("%.3f", t/1000))
		label(8, y(v)+5, fmt.Sprintf("%.1f", v))
	}
	colors := []string{"#675099", "#a65069"}
	for i, s := range c.Series {
		for n, points := range [][]chartPoint{s.Points, s.Expected} {
			var path strings.Builder
			pen := false
			for _, v := range points {
				if !v.Valid {
					pen = false
					continue
				}
				cmd := "M"
				if pen {
					cmd = "L"
				}
				fmt.Fprintf(&path, "%s%.3f %.3f", cmd, x(v.T), y(v.V))
				pen = true
			}
			dash := ""
			if n == 1 {
				dash = ` stroke-dasharray="4 5"`
			}
			fmt.Fprintf(&b, `<path d="%s" fill="none" stroke="%s" stroke-width="2.5" clip-path="url(#plot)"%s/>`, path.String(), colors[i], dash)
		}
		if c.Options.Markers {
			for j, frame := range []int{0, len(s.Points) - 1} {
				if frame < 0 {
					continue
				}
				v := s.Points[frame]
				if v.T < c.Min || v.T > c.Max {
					continue
				}
				fmt.Fprintf(&b, `<path d="M%.2f %.0fV%.0f" stroke="%s" stroke-dasharray="3 5"/>`, x(v.T), top, bottom, colors[i])
				word := "In"
				if j == 1 {
					word = "Out"
				}
				label(min(x(v.T)+4, right-55), top+20+float64(i*25), fmt.Sprintf("%c %s", 'A'+i, word))
			}
			for _, v := range s.Points {
				if v.Valid && v.Manual {
					fmt.Fprintf(&b, `<circle cx="%.2f" cy="%.2f" r="5" fill="%s" clip-path="url(#plot)"/>`, x(v.T), y(v.V), colors[i])
				} else if !v.Valid && v.T >= c.Min && v.T <= c.Max {
					fmt.Fprintf(&b, `<path d="M%.2f %.0fv8" stroke="#ba1a1a"/>`, x(v.T), bottom)
				}
			}
		}
		if c.Options.Statistics {
			label(75, float64(810+i*25), c.summary(i))
		}
	}
	label(600, 790, "Source time (s)")
	fmt.Fprint(&b, "</svg>")
	return b.String()
}
func (s Store) Chart(id string, o ChartOptions) (string, error) {
	p, e := s.Load(id)
	if e != nil {
		return "", e
	}
	c, e := s.buildChart(p, o)
	if e != nil {
		return "", e
	}
	dir, _ := s.Folder(id)
	f, e := os.CreateTemp(dir, "chart-*.svg")
	if e != nil {
		return "", e
	}
	_, e = f.WriteString(c.svg())
	closeErr := f.Close()
	if e != nil {
		return "", e
	}
	return f.Name(), closeErr
}
