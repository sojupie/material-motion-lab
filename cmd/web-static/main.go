package main

import (
	"context"
	"encoding/json"
	"flag"
	"github.com/sojupie/ui-motion/internal/web"
	"log"
	"os"
)

func main() {
	out := flag.String("out", "dist", "static output directory")
	manifest := flag.String("component-manifest", "", "write build-time Forge dependencies instead of the static page")
	flag.Parse()
	if *manifest != "" {
		plan, err := web.CollectComponentAssets(context.Background(), web.Page(nil))
		if err != nil {
			log.Fatal(err)
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
