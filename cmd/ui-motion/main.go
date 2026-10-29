package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"github.com/sojupie/ui-motion/internal/analysis"
	"github.com/sojupie/ui-motion/internal/web"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func main() {
	if e := run(os.Args[1:]); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: ui-motion <serve|web-static|inspect|import|track|correct|frames|zero|compare|measure|export> [arguments]")
	}
	command := args[0]
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	start := flags.Int("start", 0, "first frame")
	end := flags.Int("end", -1, "last frame")
	method := flags.String("method", "feature", "feature, edge-x, edge-y, width or height")
	curve := flags.String("curve", "md3-standard", "reference preset ID, bezier, or spring; see docs/references.md")
	bezier := flags.String("bezier", "0.2,0,0,1", "custom cubic-bezier x1,y1,x2,y2")
	stiffness := flags.Float64("stiffness", 380, "unit-mass spring stiffness")
	damping := flags.Float64("damping", .8, "spring damping ratio")
	velocity := flags.Float64("velocity", 0, "initial velocity in travel distances/second")
	duration := flags.Float64("duration", 300, "reference duration in ms")
	fit := flags.Bool("fit", false, "fit reference duration")
	search := flags.Int("search", 60, "search distance in pixels")
	region := flags.String("region", "", "x,y,width,height")
	frame := flags.Int("frame", 0, "frame")
	step := flags.Int("step", 1, "frame step")
	zero := flags.Int("zero-frame", 0, "comparison zero frame")
	format := flags.String("format", "json", "json, csv, chart, video or project")
	axis := flags.String("axis", "x", "x, y, width or height")
	exportOptions := flags.String("export-options", "", "JSON file containing video/chart options (same payload as POST export)")
	speed := flags.Float64("speed", 1, "video export speed")
	repeat := flags.Int("repeat", 1, "video export repetitions")
	port := flags.Int("port", 8091, "local server port")
	root := flags.String("root", ".", "application directory")
	projects := flags.String("projects", "", "saved projects directory")
	// Accept the existing CLI order: positional arguments followed by flags.
	var options, positionals []string
	for i := 1; i < len(args); i++ {
		if strings.HasPrefix(args[i], "--") {
			options = append(options, args[i])
			if !strings.Contains(args[i], "=") && args[i] != "--fit" && i+1 < len(args) {
				i++
				options = append(options, args[i])
			}
		} else {
			positionals = append(positionals, args[i])
		}
	}
	if e := flags.Parse(options); e != nil {
		return e
	}
	abs, e := filepath.Abs(*root)
	if e != nil {
		return e
	}
	dir := *projects
	if dir == "" {
		dir = filepath.Join(abs, "projects")
	}
	store := analysis.Store{Dir: dir}
	need := func(n int) error {
		if len(positionals) != n {
			return fmt.Errorf("%s requires %d positional arguments", command, n)
		}
		return nil
	}
	roi := func() ([]float64, error) {
		parts := strings.Split(*region, ",")
		values := []float64{}
		for _, v := range parts {
			f, e := strconv.ParseFloat(v, 64)
			if e != nil {
				return nil, e
			}
			values = append(values, f)
		}
		if len(values) != 4 {
			return nil, fmt.Errorf("region needs x,y,width,height")
		}
		return values, nil
	}
	var result any
	if command == "web-static" {
		return web.ExportStatic(filepath.Join(abs, "dist"))
	}
	if command == "serve" {
		if *port < 1 || *port > 65535 {
			return fmt.Errorf("invalid port")
		}
		s := web.StaticHandler(filepath.Join(abs, "dist"))
		addr := fmt.Sprintf("127.0.0.1:%d", *port)
		log.Printf("Material Motion Lab: http://%s", addr)
		return http.ListenAndServe(addr, s)
	}
	if command == "compare" {
		if e = need(2); e != nil {
			return e
		}
	} else if e = need(1); e != nil {
		return e
	}
	id := positionals[0]
	switch command {
	case "inspect":
		result, e = analysis.Inspect(id)
	case "import":
		result, e = store.Import(id, "")
	case "track":
		var values []float64
		values, e = roi()
		if e == nil {
			var last *int
			if *end >= 0 {
				last = end
			}
			result, e = store.TrackMethod(id, values, *start, last, nil, *search, .65, *method)
		}
	case "measure":
		var ref analysis.Reference
		switch *curve {
		case "spring":
			ref = analysis.Reference{Kind: "spring", Stiffness: *stiffness, Damping: *damping, Velocity: *velocity}
		case "bezier":
			ref.Kind = "bezier"
			parts := strings.Split(*bezier, ",")
			if len(parts) != 4 {
				return fmt.Errorf("bezier needs x1,y1,x2,y2")
			}
			for i, part := range parts {
				v, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
				if err != nil {
					return err
				}
				ref.Curve[i] = v
			}
		default:
			var err error
			ref, err = analysis.ReferencePreset(*curve)
			if err != nil {
				return err
			}
		}
		last := *end
		if last < 0 {
			p, err := store.Load(id)
			if err != nil {
				return err
			}
			last = len(p.Times) - 1
		}
		result, e = store.MeasureReference(id, *axis, *start, last, ref, *duration, *fit)
	case "correct":
		var values []float64
		values, e = roi()
		if e == nil {
			result, e = store.Correct(id, *frame, values)
		}
	case "zero":
		result, e = store.Zero(id, *frame)
	case "compare":
		result, e = store.Compare(id, positionals[1], *zero)
	case "frames":
		var p *analysis.Project
		p, e = store.Load(id)
		if e == nil {
			if *step < 1 {
				return fmt.Errorf("step must be positive")
			}
			last := len(p.Times) - 1
			if *end >= 0 {
				last = min(last, *end)
			}
			frames := []map[string]any{}
			for i := max(0, *start); i <= last; i += *step {
				path, err := store.Frame(id, i)
				if err != nil {
					return err
				}
				frames = append(frames, map[string]any{"frame": i, "t": p.Times[i], "file": path})
			}
			result = frames
		}
	case "export":
		switch *format {
		case "project":
			result, e = store.ExportProject(id)
		case "csv":
			result, e = store.CSV(id)
		case "video", "chart":
			p, err := store.Load(id)
			if err != nil {
				return err
			}
			o := analysis.DefaultVideoOptions(p, *axis)
			o.First = *start
			if *end >= 0 {
				o.Last = *end
			}
			o.Speed = *speed
			o.Repeat = *repeat
			o.Chart.Start = o.First
			o.Chart.End = o.Last
			if *exportOptions != "" {
				f, err := os.Open(*exportOptions)
				if err != nil {
					return err
				}
				defer f.Close()
				decoder := json.NewDecoder(f)
				decoder.DisallowUnknownFields()
				if err = decoder.Decode(&o); err != nil {
					return err
				}
			}
			if *format == "chart" {
				result, e = store.Chart(id, o.Chart)
			} else {
				result, e = store.VideoWithOptions(id, o)
			}
		case "json":
			_, e = store.Load(id)
			if e == nil {
				var folder string
				folder, e = store.Folder(id)
				result = filepath.Join(folder, "project.json")
			}
		default:
			e = fmt.Errorf("format must be json, csv, chart, video or project")
		}
	default:
		e = fmt.Errorf("unknown command: %s", command)
	}
	if e != nil {
		return e
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}
