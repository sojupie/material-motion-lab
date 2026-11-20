# Material Motion Lab

Measure UI motion from video recordings in the browser. Track an object, edge,
or changing dimension, align two recordings, and compare measured displacement
against Material Design 3 easing curves and springs.

Hosted at [tokencatalog.dev/tools/motion-lab](https://tokencatalog.dev/tools/motion-lab/).
All decoding, tracking, and export run locally in browser workers (FFmpeg
WebAssembly and OpenCV.js), and projects autosave in IndexedDB—videos are never
uploaded.

## What it does

- **Projects & `.motion` files:** Each project holds up to two videos (A and B)
  sharing a playhead, time ruler, and playback interval. Changes autosave in
  IndexedDB; **Save** downloads a portable `.motion` ZIP containing media,
  measurements, corrections, alignment, and chart settings. A bundled carousel
  example is included.
- **Tracking:** Track 2D **Image patch**, 1D **Edge** (horizontal/vertical), or
  **Width / Height (opposing edges)** with subpixel estimation, manual frame
  corrections, and tracking-loss markers.
- **Alignment & playback:** Mark sync points on videos A and B to align them
  using source timestamps (including variable frame rates), with independent
  playback range, loop, and ⅛×–4× speed.
- **Displacement chart & references:** Plot horizontal, vertical, width, or
  height in pixels or normalized progress against MD3 easing curves, standard
  and expressive springs, or custom JSON references with duration fitting and
  RMS/max error. See [motion references](docs/references.md).
- **Exports:** Export annotated MP4/H.264 video (up to 1280px wide, custom
  speed/repeats/overlays), standalone chart SVG, CSV, or JSON.
- **Input limits:** MP4, MOV, WebM, MKV, AVI, and GIF up to 256 MB, 3840 × 2160,
  6,000 frames, and 200M decoded pixels per video.

## Build and run locally

Requires Go 1.26+ and Node 22.12+, with a sibling checkout of
[Token Catalog](https://github.com/sojupie/tokens) at `../tokens` for shared
Forge components.

### Browser app only (no native OpenCV/FFmpeg required)

```sh
npm ci
make build-static
python3 -m http.server 8091 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8091`. Deploy `dist/` to any static host (e.g.
`/tools/motion-lab/`); HTTPS is required outside localhost for workers and
offline caching. The static build generates gzip and Brotli sidecars and caches
the shell/fonts offline while downloading FFmpeg and OpenCV.js (~43 MB
uncompressed) on demand.

### Full build with optional native CLI

Requires FFmpeg, `ffprobe`, and OpenCV 4.13 dev files for GoCV 0.43.0 (e.g.
`opencv-devel` on Fedora, or an SDK under `.local/opencv/`):

```sh
npm ci
make build
./scripts/run.sh serve
```

## Native CLI

The optional CLI operates on local workspaces in `projects/` (pass
`--projects PATH` to override):

```sh
./scripts/run.sh inspect clip.mp4
./scripts/run.sh import clip.mp4
./scripts/run.sh frames PROJECT_ID --start 30 --end 90 --step 10
./scripts/run.sh track PROJECT_ID --method feature --region 100,200,30,40 --start 30 --end 90
./scripts/run.sh track PROJECT_ID --method edge-x --region 100,200,16,60 --start 30 --end 90
./scripts/run.sh track PROJECT_ID --method width --region 683,90,244,410 --start 120 --end 151
./scripts/run.sh correct PROJECT_ID --frame 55 --region 140,200,30,40
./scripts/run.sh zero PROJECT_ID --frame 40
./scripts/run.sh compare PROJECT_ID REFERENCE_ID --zero-frame 35
./scripts/run.sh measure PROJECT_ID --start 40 --end 90 --curve md3-standard --duration 300 --fit
./scripts/run.sh export PROJECT_ID --format project
./scripts/run.sh export PROJECT_ID --format csv
./scripts/run.sh export PROJECT_ID --format chart --start 120 --end 131 --axis width
./scripts/run.sh export PROJECT_ID --format video --export-options /tmp/export-options.json
```

`--export-options` accepts JSON matching the browser export dialog:

```json
{
  "first": 120, "last": 131, "speed": 0.25, "repeat": 1,
  "tracking": true, "plot": true, "statistics": true, "markers": true, "time": true,
  "chart": {
    "axis": "width", "units": "px", "start": 120, "end": 131,
    "reference": {"kind": "bezier", "curve": [0.2, 0, 0, 1]},
    "duration": 200, "statistics": true, "markers": true
  }
}
```

Optional `chart.window` (`[startMs, endMs]`), `chart.scale` (`[min, max]`), and
`chart.comparison` (`{id, first, last, offset}`) match the workspace view.

## Development

| Path | Responsibility |
| --- | --- |
| `cmd/ui-motion/` | Native CLI and local static server |
| `cmd/web-static/` | Static HTML shell exporter (`CGO_ENABLED=0`) |
| `internal/motion/` | Reference curves shared by static exporter and native CLI |
| `internal/analysis/` | Project files, FFmpeg import/export, and GoCV tracking |
| `internal/web/` | Templ shell and static export |
| `web/` | TypeScript workspace, timeline, graph, IndexedDB, and worker controllers |
| `public/` | Imported Token Catalog CSS, fonts, and Forge runtimes (`token-source.json`) |

- `make generate` — regenerate Go templ output after editing `internal/web/` templates.
- `npm run material` — refresh imported Forge assets from `../tokens` (or pass a custom source and theme path to `scripts/import-material.mjs`).
- `make test` — run Go and browser tests.
- `npm run lint` — run type-aware Oxlint and strict TypeScript checks (runs automatically before production builds).
