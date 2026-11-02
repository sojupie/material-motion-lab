package web

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sojupie/tokens/forge/components/ui"
)

func TestComponentAssetsFollowRenderedAPIAndClonedTemplates(t *testing.T) {
	plan, err := CollectComponentAssets(context.Background(), ui.Switch(ui.ChoiceProps{Label: "Added switch"}))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(plan.Modules, ",") != "common,switch" {
		t.Fatalf("dependency collection: %v", plan.Modules)
	}
	found := false
	for _, script := range plan.Scripts {
		found = found || script == "runtime/switches.js"
	}
	if !found {
		t.Fatal("missing switch behavior")
	}
	page, err := CollectComponentAssets(context.Background(), Page(nil))
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"card", "list", "dialog", "navigation", "loading", "toolbar"} {
		found := false
		for _, module := range page.Modules {
			found = found || name == module
		}
		if !found {
			t.Fatalf("missing page/template module %s", name)
		}
	}
}

func copyComponentAssets(t *testing.T, dir string) {
	t.Helper()
	for _, name := range []string{"token-source.json", "material.css"} {
		data, err := os.ReadFile(filepath.Join("../../public", name))
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(dir, name), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := os.ReadDir("../../public/material")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(dir, "material"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join("../../public/material", entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(dir, "material", entry.Name()), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestStaticExportRejectsMismatchedComponentAssets(t *testing.T) {
	dir := t.TempDir()
	copyComponentAssets(t, dir)
	if err := verifyComponentAssets(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "material", "buttons.js"), []byte("stale"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := verifyComponentAssets(dir); err == nil || !strings.Contains(err.Error(), "changed after import") {
		t.Fatalf("accepted mixed assets: %v", err)
	}
}
