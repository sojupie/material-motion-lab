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

## Track motion

1. Open a video and find the first frame to track.
2. Open **Tracking** and choose a method. Draw around a distinct detail for **Image patch**, or draw a narrow strip across a straight boundary for **Vertical edge (X)** or **Horizontal edge (Y)**.
3. Set the first and last frames, then press **Track interval**.
4. Step through frames or click the position graph to inspect the results. **Jump to** lists the interval boundaries, alignment and manual corrections. The weak-match buttons find frames where tracking was lost.
5. Draw a corrected region on a bad frame and press **Correct here**. This adds a manual anchor and reruns the interval with those corrections.

Image patches track position in two dimensions. Edge tracking follows one axis through a fixed strip; keep corners and other boundaries outside that strip. Both methods estimate subpixel positions. Similarity is the patch correlation score. Edge strength is a ratio to the last manual anchor. Neither score is a probability of correctness. Weak matches leave gaps.

Existing recordings retain their saved measurements. Rerun tracking to replace older whole-pixel results with subpixel estimates. JSON, CSV and annotated video exports are available under **Export** for each video.

## Compare videos

Choose a **Second video** to show both recordings and their tracking controls. Each video can be tracked and corrected directly in this workspace.

Turn off **Linked playback**, scrub each video to the event you want to compare, then press **Align current frames**. Those frames become time zero. Linked playback and graph inspection then use the original frame timestamps, including different frame rates and irregular frame intervals. Frames outside a recording hold at its boundary and are labeled accordingly. Alignment is saved with the comparison.

The graph shows displacement from alignment in recording pixels, or progress toward the selected last frame. Drag across the graph to zoom; its vertical scale follows the visible samples. **Zoom to intervals** shows the tracking ranges. **Full recording** resets the zoom.

Choose an MD3 standard or linear reference curve to compare timing. The reference starts at the alignment frame and ends at the measured position of the selected last frame. Set a duration or fit it to either recording. Fitting changes duration only. RMS error and maximum error describe the difference from the curve across valid samples. Both endpoint frames need valid measurements and different positions.

Video measurements remain limited by captured frames, compression and the selected detail. Subpixel estimates do not recover frames missing from a recording. Use a straight edge or a stable detail to measure translation; these trackers do not measure scale, opacity or text deformation.

## CLI

The CLI and HTTP API call the same Go analysis package.

```sh
./scripts/run.sh inspect clip.mp4
./scripts/run.sh import clip.mp4
# Use the returned project ID below.
./scripts/run.sh frames PROJECT_ID --start 30 --end 90 --step 10
./scripts/run.sh track PROJECT_ID --method feature --region 100,200,30,40 --start 30 --end 90
./scripts/run.sh track PROJECT_ID --method edge-x --region 100,200,16,60 --start 30 --end 90
./scripts/run.sh correct PROJECT_ID --frame 55 --region 140,200,30,40
./scripts/run.sh zero PROJECT_ID --frame 40
./scripts/run.sh compare PROJECT_ID REFERENCE_ID --zero-frame 35
./scripts/run.sh measure PROJECT_ID --start 40 --end 90 --curve md3-standard --duration 300 --fit
./scripts/run.sh export PROJECT_ID --format csv
./scripts/run.sh export PROJECT_ID --format video
```

`frames` returns local image paths and timestamps for agent inspection. `measure` returns the reference points, fitted duration, RMS error, maximum error and sample counts as JSON. Omit `--fit` to assess a fixed duration. The same operation is available at `POST /api/projects/{id}/measure` with `axis`, `start`, `end`, `curve` (four cubic-bezier coordinates), `duration` and `fit`. `--projects PATH` selects a separate project directory for tests or batch work. `serve --port PORT` changes the local server port.

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

`make test` checks known fractional motion, both edge axes, correction and tracking loss, curve fitting, variable frame timing, linked-time mapping, exports, HTTP validation, server-rendered controls, token references and shared runtime integrity. Generate templ code after editing templates with `make generate`.
