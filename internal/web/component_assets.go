package web

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"path"

	"github.com/a-h/templ"
	"github.com/sojupie/tokens/forge/components"
	"github.com/sojupie/tokens/forge/components/ui"
)

// ComponentManifest describes dependencies of the actual page, including templates
// cloned later by the browser. Assets come from the same Go module as the markup.
type ComponentManifest struct {
	Modules []string          `json:"modules"`
	Scripts []string          `json:"scripts"`
	Files   map[string]string `json:"files"`
}

func CollectComponentAssets(ctx context.Context, component templ.Component) (ComponentManifest, error) {
	used := ui.Assets{}
	if err := component.Render(ui.WithAssets(ctx, used), io.Discard); err != nil {
		return ComponentManifest{}, err
	}
	var order []string
	data, err := components.Files.ReadFile("static/bundles/modules.json")
	if err != nil {
		return ComponentManifest{}, err
	}
	if err = json.Unmarshal(data, &order); err != nil {
		return ComponentManifest{}, err
	}
	var modules map[string]struct {
		Scripts []string `json:"scripts"`
	}
	data, err = components.Files.ReadFile("modules.json")
	if err != nil {
		return ComponentManifest{}, err
	}
	if err = json.Unmarshal(data, &modules); err != nil {
		return ComponentManifest{}, err
	}
	plan := ComponentManifest{Files: map[string]string{}}
	addFile := func(name string) error {
		data, e := components.Files.ReadFile(name)
		if e != nil {
			return e
		}
		plan.Files[name] = fmt.Sprintf("%x", sha256.Sum256(data))
		return nil
	}
	for _, name := range []string{"modules.json", "static/bundles/modules.json", "static/buttons.css", "static/components.css"} {
		if err = addFile(name); err != nil {
			return plan, err
		}
	}
	scripts := []string{"runtime/utils.js", "motion.cjs", "buttons.js"}
	for _, name := range order {
		if !used[name] {
			continue
		}
		delete(used, name)
		plan.Modules = append(plan.Modules, name)
		if err = addFile("static/bundles/" + name + ".css"); err != nil {
			return plan, err
		}
		scripts = append(scripts, modules[name].Scripts...)
		if name == "loading" {
			if err = addFile("static/loading-shapes.json"); err != nil {
				return plan, err
			}
		}
	}
	if len(used) > 0 {
		return plan, fmt.Errorf("unknown component requirements: %v", used)
	}
	seen := map[string]bool{}
	locals := map[string]string{}
	for _, script := range scripts {
		if seen[script] {
			continue
		}
		seen[script] = true
		local := ComponentScriptName(script)
		if previous := locals[local]; previous != "" {
			return plan, fmt.Errorf("script filename collision: %s and %s", previous, script)
		}
		locals[local] = script
		plan.Scripts = append(plan.Scripts, script)
		if err = addFile("static/" + script); err != nil {
			return plan, err
		}
	}
	return plan, nil
}

func ComponentScriptName(script string) string {
	if script == "motion.cjs" {
		return "motion.js"
	}
	return path.Base(script)
}

type componentPlanKey struct{}

// Page uses two passes so head assets are known before any body bytes are sent.
func Page(entries []Entry, version ...string) templ.Component {
	return templ.ComponentFunc(func(ctx context.Context, w io.Writer) error {
		plan, err := CollectComponentAssets(ctx, page(entries, version...))
		if err != nil {
			return err
		}
		var out bytes.Buffer
		if err = page(entries, version...).Render(context.WithValue(ctx, componentPlanKey{}, plan), &out); err != nil {
			return err
		}
		_, err = out.WriteTo(w)
		return err
	})
}

func pageComponentPlan(ctx context.Context) ComponentManifest {
	plan, _ := ctx.Value(componentPlanKey{}).(ComponentManifest)
	return plan
}
