package web

import (
	"bytes"
	"context"
	"regexp"
	"strings"
	"testing"
)

func TestIconAssetsHaveMaterialProvenance(t *testing.T) {
	for name, asset := range iconAssets {
		if asset.Path == "" || asset.ViewBox != "0 -960 960 960" || !strings.HasPrefix(asset.Source, "https://raw.githubusercontent.com/google/material-design-icons/") {
			t.Errorf("%s: invalid icon asset or provenance", name)
		}
		if asset.Transform != "" && name != "compress_horizontal" {
			t.Errorf("unexpected rotation: %s", name)
		}
	}
}

func TestControlIconMeanings(t *testing.T) {
	var page bytes.Buffer
	if err := Page(nil).Render(context.Background(), &page); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(page.String(), "@icon(") {
		t.Fatal("template call rendered as text")
	}
	if count := strings.Count(page.String(), `data-icon="expand_more"`); count != 3 {
		t.Fatalf("disclosure icons: got %d, want 3", count)
	}
	actual := map[string]string{}
	for _, m := range regexp.MustCompile(`(?s)<button\b[^>]*id="([^"]+)"[^>]*>(.*?)</button>`).FindAllStringSubmatch(page.String(), -1) {
		icon := regexp.MustCompile(`data-icon="([^"]+)"`).FindStringSubmatch(m[2])
		if icon != nil {
			actual[m[1]] = icon[1]
		}
	}
	expected := map[string]string{
		"units-px": "check", "units-progress": "check",
		"save-project": "save", "mobile-save": "save", "tracking-start": "text_select_jump_to_beginning", "tracking-end": "text_select_jump_to_end",
		"empty-add":         "video_library",
		"empty-project-add": "video_library",
		"open-example":      "play_arrow",
		"open-recording":    "video_library", "open-export": "video_frame_save",
		"project-menu-button": "folder_open", "mobile-add": "folder_open", "mobile-tracking": "ink_selection", "mobile-alignment": "align_horizontal_center", "mobile-chart": "show_chart", "mobile-export": "video_frame_save",
		"playback-interval": "linear_scale", "playback-start": "line_start", "playback-end": "line_end", "playback-reset": "fit_page_width", "previous-frame": "skip_previous", "play": "play_arrow", "next-frame": "skip_next",
		"timeline-out": "zoom_out", "timeline-in": "zoom_in", "timeline-fit": "fit_page_width", "timeline-range": "compress_horizontal",
		"maximize-viewer": "expand_content", "maximize-chart": "expand_content", "graph-pan": "pan_tool",
		"mark-sync": "add_diamond", "goto-sync": "jump_to_element", "align-sync": "align_horizontal_center", "nudge-earlier": "arrow_back", "nudge-later": "arrow_forward",
		"graph-fit": "fit_page", "graph-fit-end": "center_focus_strong", "graph-zoom-in": "zoom_in", "graph-zoom-out": "zoom_out",
		"reference-save": "download", "reference-load": "upload_file",
	}
	for _, prefix := range []string{"a-", "b-"} {
		for suffix, icon := range map[string]string{"remove": "close", "start-here": "line_start", "end-here": "line_end", "goto-start": "text_select_jump_to_beginning", "goto-end": "text_select_jump_to_end", "draw": "ink_selection", "correct": "edit", "anchor-prev": "navigate_before", "anchor-next": "navigate_next", "weak-prev": "navigate_before", "weak-next": "navigate_next"} {
			expected[prefix+suffix] = icon
		}
	}
	for id, want := range expected {
		if actual[id] != want {
			t.Errorf("%s: got %q, want %q", id, actual[id], want)
		}
	}
	for id := range actual {
		if _, ok := expected[id]; !ok {
			t.Errorf("icon-bearing button absent from review: %s", id)
		}
	}
}

func TestUnknownIconDoesNotFallBack(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("unknown icon must fail instead of displaying an unrelated symbol")
		}
	}()
	iconPath("missing-icon")
}
