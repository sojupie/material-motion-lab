package web

import "github.com/sojupie/tokens/forge/site"

func toolSiteConfig() site.Config {
	config := site.Default()
	config.Workspace = true
	config.ActiveTool = config.Tools[0].URL
	return config
}
