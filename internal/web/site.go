package web

import "github.com/sojupie/tokens/forge/site"

func toolSiteConfig() site.Config {
	config := site.Default()
	config.Workspace = true
	config.ActiveTool = site.MotionLabURL
	return config
}
