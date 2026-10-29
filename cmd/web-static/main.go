package main

import (
	"flag"
	"github.com/sojupie/ui-motion/internal/web"
	"log"
)

func main() {
	out := flag.String("out", "dist", "static output directory")
	flag.Parse()
	if err := web.ExportStatic(*out); err != nil {
		log.Fatal(err)
	}
}
