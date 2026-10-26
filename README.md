# UI Motion

Measure UI motion from video. Open a recording, track an object or edge, and inspect its position beside the frames.

## Run

Requires Go 1.26+, Node 22.12+, FFmpeg, ffprobe and OpenCV 4.13 development files for GoCV 0.43.0. Keep the Token Catalog checkout beside this repository at `../tokens`; the Go module uses its shared Forge components through a local replacement.

```sh
npm ci
make build
./scripts/run.sh serve
```

Open http://127.0.0.1:8091. The Go executable serves the templ interface, API and static assets. Videos and measurements stay in `projects/`, which Git ignores. Python is no longer required.

OpenCV is a native dependency. On Fedora, install `opencv-devel`; on other platforms, follow the [GoCV installation instructions](https://gocv.io/getting-started/). This workstation also has an optional SDK under `.local/opencv/`. The build and run scripts use it when system development files are unavailable.

## Analyze a video

1. Open a video.
2. Find the first frame to track. Draw around a distinct edge or textured detail.
3. Set the last frame and press **Track from this frame**.
4. Click the graph or step through frames to check the tracked region.
5. Draw a corrected region and press **Correct position here** when tracking follows the wrong detail.

Set time zero at the event you want to compare. Choose another recording and set its zero frame to align the events. Reopen saved recordings from the sidebar or menu button.

JSON, CSV and annotated video exports become available after tracking. The video places the tracked frame beside its position graph. Existing schema-1 projects from the Python version remain readable without conversion.

Tracking follows a fixed image patch. It measures position, not changes in shape, scale or opacity. Weak matches leave gaps. Timing precision depends on the source video's captured frames.

## CLI

The CLI and HTTP API call the same Go analysis package.

```sh
./scripts/run.sh inspect clip.mp4
./scripts/run.sh import clip.mp4
# Use the returned project ID below.
./scripts/run.sh frames PROJECT_ID --start 30 --end 90 --step 10
./scripts/run.sh track PROJECT_ID --region 100,200,30,40 --start 30 --end 90
./scripts/run.sh correct PROJECT_ID --frame 55 --region 140,200,30,40
./scripts/run.sh zero PROJECT_ID --frame 40
./scripts/run.sh compare PROJECT_ID REFERENCE_ID --zero-frame 35
./scripts/run.sh export PROJECT_ID --format csv
./scripts/run.sh export PROJECT_ID --format video
```

`frames` returns local image paths and timestamps for agent inspection. `--projects PATH` selects a separate project directory for tests or batch work. `serve --port PORT` changes the local server port.

## Code

| Location | Responsibility |
| --- | --- |
| `cmd/ui-motion/` | CLI and server entry point |
| `internal/analysis/` | Project files, FFmpeg import/export and GoCV tracking |
| `internal/web/` | HTTP routes and templ page composition |
| `../tokens/forge/components/ui/` | Shared templ controls and navigation anatomy |
| `web/` | Playback, region selection, graph and control state synchronization |
| `public/` | Token Catalog CSS, fonts and unmodified interaction runtimes |

Go renders the control markup. Dynamic list entries clone templates rendered by those same components. TypeScript handles analysis interactions rather than rebuilding component anatomy. Vite builds the browser assets; it does not serve the application shell.

Refresh Material assets from Token Catalog with:

```sh
node scripts/import-material.mjs ../tokens
make build
```

`make test` checks variable frame timing, tracking loss and correction, exports, HTTP validation, server-rendered controls, token references and shared runtime integrity. Generate templ code after editing templates with `make generate`.
