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
		return fmt.Errorf("usage: ui-motion <serve|inspect|import|track|correct|frames|zero|compare|measure|export> [arguments]")
	}
	command := args[0]
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	start := flags.Int("start", 0, "first frame")
	end := flags.Int("end", -1, "last frame")
	method := flags.String("method", "feature", "feature, edge-x or edge-y")
	curve := flags.String("curve", "md3-standard", "md3-standard or linear")
	duration := flags.Float64("duration", 300, "reference duration in ms")
	fit := flags.Bool("fit", false, "fit reference duration")
	search := flags.Int("search", 60, "search distance in pixels")
	region := flags.String("region", "", "x,y,width,height")
	frame := flags.Int("frame", 0, "frame")
	step := flags.Int("step", 1, "frame step")
	zero := flags.Int("zero-frame", 0, "comparison zero frame")
	format := flags.String("format", "json", "json, csv or video")
	axis := flags.String("axis", "x", "x or y")
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
	if command == "serve" {
		if *port < 1 || *port > 65535 {
			return fmt.Errorf("invalid port")
		}
		s := &web.Server{Store: store, Dist: filepath.Join(abs, "dist")}
		addr := fmt.Sprintf("127.0.0.1:%d", *port)
		log.Printf("UI Motion: http://%s", addr)
		return http.ListenAndServe(addr, s.Handler())
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
		c := analysis.Curve{.2, 0, 0, 1}
		if *curve == "linear" {
			c = analysis.Curve{0, 0, 1, 1}
		} else if *curve != "md3-standard" {
			return fmt.Errorf("curve must be md3-standard or linear")
		}
		last := *end
		if last < 0 {
			p, err := store.Load(id)
			if err != nil {
				return err
			}
			last = len(p.Times) - 1
		}
		result, e = store.Measure(id, *axis, *start, last, c, *duration, *fit)
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
		case "csv":
			result, e = store.CSV(id)
		case "video":
			result, e = store.Video(id, *axis)
		case "json":
			_, e = store.Load(id)
			if e == nil {
				var folder string
				folder, e = store.Folder(id)
				result = filepath.Join(folder, "project.json")
			}
		default:
			e = fmt.Errorf("format must be json, csv or video")
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
