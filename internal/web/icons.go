package web

import (
	"embed"
	"encoding/json"
)

//go:embed icons.json
var iconFiles embed.FS

type iconAsset struct {
	Path      string `json:"path"`
	Transform string `json:"transform"`
	Source    string `json:"source"`
	ViewBox   string `json:"viewBox"`
}

var iconAssets = func() map[string]iconAsset {
	data, err := iconFiles.ReadFile("icons.json")
	if err != nil {
		panic(err)
	}
	var result map[string]iconAsset
	if err := json.Unmarshal(data, &result); err != nil {
		panic(err)
	}
	return result
}()

func iconPath(name string) string {
	asset, ok := iconAssets[name]
	if !ok {
		panic("unknown UI icon: " + name)
	}
	return asset.Path
}
func iconTransform(name string) string { return iconAssets[name].Transform }
