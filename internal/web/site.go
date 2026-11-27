package web

import (
	"embed"
	"github.com/sojupie/tokens/forge/site"
)

//go:embed logo.svg logo-250x250.png logo-250x250.webp
var logoFiles embed.FS

func toolSiteConfig() site.Config {
	config := site.Default()
	config.Workspace = true
	config.ActiveTool = site.MotionLabURL
	return config
}
