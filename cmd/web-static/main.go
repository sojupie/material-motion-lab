package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"path/filepath"

	"github.com/sojupie/tokens/forge/components"
	"github.com/sojupie/ui-motion/internal/web"
)

func main() {
	out := flag.String("out", "dist", "static output directory")
	manifest := flag.String("component-manifest", "", "write build-time Forge dependencies instead of the static page")
	assets := flag.String("component-assets", "", "export embedded Forge dependencies alongside the manifest")
	flag.Parse()
	if *manifest != "" {
		plan, err := web.CollectComponentAssets(context.Background(), web.Page(nil))
		if err != nil {
			log.Fatal(err)
		}
		if *assets != "" {
			for name := range plan.Files {
				data, err := components.Files.ReadFile(name)
				if err != nil {
					log.Fatal(err)
				}
				filename := filepath.Join(*assets, filepath.FromSlash(name))
				if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
					log.Fatal(err)
				}
				if err := os.WriteFile(filename, data, 0644); err != nil {
					log.Fatal(err)
				}
			}
		}
		data, err := json.MarshalIndent(plan, "", "  ")
		if err != nil {
			log.Fatal(err)
		}
		if err = os.WriteFile(*manifest, append(data, '\n'), 0644); err != nil {
			log.Fatal(err)
		}
		return
	}
	if err := web.ExportStatic(*out); err != nil {
		log.Fatal(err)
	}
}
