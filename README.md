# Material Motion Lab

Measure UI motion from video. Open a recording, track an object or edge, and inspect its position beside the frames.

## Run

Requires Go 1.26+, Node 22.12+, FFmpeg, ffprobe and OpenCV 4.13 development files for GoCV 0.43.0. Keep the Token Catalog checkout beside this repository at `../tokens`; the Go module uses its shared Forge components through a local replacement.

```sh
npm ci
make build
./scripts/run.sh serve
```

`make build-static` builds the browser distribution without OpenCV or native video processing libraries. It uses a Go shell exporter with `CGO_ENABLED=0`; `make build` also builds the optional native CLI. The Token Catalog deployment builds and bundles this static distribution from this repository.

After building, you can also preview without Go using `python3 -m http.server 8091 --bind 127.0.0.1 --directory dist`.

Open http://127.0.0.1:8091. The `serve` command serves `dist/` as static files and rejects writes. The web app does not use the native processing API. For deployment, publish the contents of `dist/` at the tool URL, for example `/tools/motion/`, using any static web host. HTTPS is required outside localhost for workers and offline support.

Videos, extracted frames, measurements and workspace state autosave in the browser's IndexedDB database `motion-tracker`. Decoding and encoding use a bundled FFmpeg WebAssembly worker; patch matching uses bundled OpenCV.js and edge tracking runs in the processing worker. Videos are not sent to the host. The first load caches application and processing assets for offline use; processing assets total about 43 MB before HTTP compression. Static asset compression and caching should be enabled on the host.

The library shows recent projects and the example when no project is open. An open project keeps its name when its last video is removed and shows an Import video prompt. Close project in the Project menu saves the project and returns to the library.

Browser storage belongs to the origin and browser profile. Clearing site data, private browsing or browser storage eviction can remove local projects. **Save project file** downloads a portable `.motion` archive including its media and measurements. Keep that file for durable storage or transfer. The local library offers **Delete**; it removes the selected project and recordings not referenced by another local project. Downloaded files are not deleted. **Make a copy** creates an independent local project. Reopening the example reuses its local project.

Import accepts MP4, MOV, WebM, MKV, AVI and GIF through the browser FFmpeg build. Inputs are limited to 256 MB, 3840 × 2160 pixels, 6000 frames and 200 million decoded pixels per video; available memory or browser quota can impose lower limits. Cancel processing stops the worker. Annotated video exports are MP4/H.264, preserve source frame durations and have a maximum width of 1280 pixels.

Long operations show their current stage and a Cancel action. Decoding, frame storage, tracking and frame rendering show measured progress for that stage; engine loading and encoding use the same linear indicator in indeterminate mode. Chart updates, export previews and offline caching have their own loading indicators.

Existing native projects in `projects/` remain untouched and are not automatically made public or imported. Export each workspace with `./scripts/run.sh export WORKSPACE_ID --format project`; the command prints the resulting `.motion` path. Open that file in the browser app.

OpenCV is a native dependency. On Fedora, install `opencv-devel`; on other platforms, follow the [GoCV installation instructions](https://gocv.io/getting-started/). This workstation also has an optional SDK under `.local/opencv/`. The build and run scripts use it when system development files are unavailable.

## Workspace

The empty viewer shows an example project and recent projects. A project contains up to two videos and keeps its identity when either video is replaced or removed. **Import video** fills A, then B; when both slots are occupied, it asks which video to replace. Both videos use one playhead and time ruler. Frame stepping follows the selected video's timestamps.

The **Project** menu provides **New project** and **Open project…** during editing. Switching projects waits for the automatic local save. Downloading a project file is a separate action. On desktop, a floating toolbar above the tools panel contains Project, Import and Export. Save is in the Project menu. The Export menu offers video, chart, CSV and JSON outputs. On narrow screens, Project opens a bottom-toolbar menu containing Import, New, Open and Save.

The bundled carousel example includes width measurements, a playback interval and an MD3 reference comparison. Opening it reuses its editable local project; use Make a copy for an independent analysis. Recent projects includes existing analyses and new projects; viewing one moves it to the top of the list on this device.

Click a viewer title or a clip to select its video. Use the **Tracking**, **Alignment** and **Chart** accordion sections in the desktop
tools panel for tracking, clip timing, measurements and references. Sections
expand independently. On narrow screens, the bottom toolbar opens anchored menus
for those controls. Viewer magnification stays in each viewer header. Timeline zoom changes the visible time span in both the tracks and displacement graph. The horizontal scrollbar appears when zoomed in and pans that span. **Fit clips** restores the full span; **Fit range** frames the selected tracking range.

Drag the time ruler to scrub between recorded frames. The selected video defines the frame grid within its clip; outside it, the playhead snaps to the other video’s frames. Zoom in to see individual frame ticks. Drag a clip to change its offset. Drag its **In** and **Out** handles to choose a tracking range. The same boundaries appear in the displacement graph. Range handles and clips also support left/right arrow keys when focused. Space plays or pauses, and the arrow keys step frames outside text fields and other controls.

Playback has its own range, separate from tracking. Seek to a frame and open the playback interval menu and choose **Set start at playhead** or **Set end at playhead**, or drag the playback handles along the time ruler. **Full clips** clears the playback range. Playback resumes from the playhead inside the range and starts at the range beginning when outside it. **Loop** repeats that interval; **Speed** runs from ⅛× to 4×. Both videos follow the same playback clock. Frame stepping and scrubbing remain available outside the playback range.

The empty video panel starts with a larger share of the workspace. Its divider
resizes it, and its saved size is separate from the loaded-video viewer split.

The desktop tools panel is permanent and has a resizable divider. The divider
above the transport adjusts the space between viewers and chart; the timeline
has no resize control. Focus a divider and use arrow keys to resize, Enter to
collapse, or Home to reset its size. **Expand viewer** and **Expand chart** enlarge
their region; **Restore layout** returns to the normal view. Pane sizes save in
browser storage. Narrow screens use the bottom toolbar and anchored menus for
project, tracking, alignment, chart and export commands, without a tools side sheet.
The shared site navigation uses a separate modal drawer at narrow widths.

**Export** opens a separate dialog with format, interval and annotation settings. Its preview renders the first export frame with the same settings as the output video. Export settings remain available when the dialog reopens.

## Project files

**Save** downloads a `.motion` project file. It is a ZIP archive containing the
original video files, measured samples, corrections, tracking ranges, alignment,
playback settings and the current chart settings and view. **Open project…** in the Project menu restores it with a new project identity. Existing videos are
not overwritten. Both videos are included when comparing them.

Workspace changes save automatically in this browser. This is separate from
downloading a portable project file; use Save to keep or move the whole analysis.
Export produces annotated video, charts or measurement data rather than a project.

## Track motion

1. Select a video and choose its range with the timeline handles or inspector fields.
2. Press **Go to start** in the inspector.
3. Choose a tracking method and press **Draw tracking region**. Draw around a distinct detail for **Image patch**, or draw a narrow strip across a straight boundary for either edge method.
4. Press **Track range**.
5. To correct a result, go to the bad frame, draw the correct region and press **Correct position here**. This adds a correction and recalculates tracking.

Correction diamonds and tracking-loss marks appear on the clip. The inspector has previous/next actions for each. Changing a tracking method, search setting or region marks the measurements as needing an update. Selecting a smaller range can analyze existing measurements without retracking.

Image patches track position in two dimensions. Edge tracking follows one axis through a fixed strip; keep corners and other boundaries outside that strip. Both methods estimate subpixel positions. Similarity is the patch correlation score. Edge strength is a ratio to the last manual anchor. Neither score is a probability of correctness. Weak matches leave gaps.

Existing recordings retain their saved measurements. Rerun tracking to replace older whole-pixel results with subpixel estimates. Use **Export** for JSON, CSV, chart SVG or annotated video.

## Align videos

Select video A and scrub to the event you want to align. Press **Mark sync point** under **Alignment** in the inspector. Repeat for B, then press **Align sync points**. Video B moves so the two markers coincide. Clip dragging, the offset field and frame-nudge actions provide manual adjustment.

Alignment, sync markers, tracking ranges, playback range, loop, speed, reference duration mode and chart settings autosave with the browser project. Moving clips does not change their source timestamps or measurements.

Playback uses the original timestamps, including different frame rates and irregular frame intervals. A viewer holds its boundary frame outside the clip and labels it accordingly.

## Inspect displacement

The graph below the tracks shares their visible time span and playhead. Hover a sample to see its frame, time, displacement and tracking score. Click a sample to move the playhead and inspect both videos. Click a trace to select its recording. Dragging the graph does not scrub or change the interval.

Select horizontal or vertical displacement and recording pixels or progress. **Fit motion** fits visible samples and reference curves. The vertical zoom buttons narrow or widen the current axis range. Enable **Pan plot** and drag the chart to move both axes; horizontal movement also pans the shared timeline. Turn it off to select samples again. Drag the vertical axis to pan vertically, or focus it and use Up/Down. Home restores Fit motion. **Fit end position** centers a close view on the selected recording’s final measured position. The displayed axis range uses the selected units. Choose a **Reference curve** beside the chart settings to show its duration and fitting controls. Displacement starts from the first position in each selected tracking range.

Choose from MD3 standard, emphasized and legacy easing curves, linear easing, and all standard and expressive spatial/effects springs. Custom Béziers and springs expose their parameters; **Save reference** and **Load reference** reuse them as JSON. Springs use physical time and preserve overshoot. Easing curves accept a duration and duration fitting. [Reference definitions and measurement details](docs/references.md).

References start at the first measured position and aim at the last position in each tracking range. For spring comparisons, choose a final frame after settling. RMS error and maximum error compare valid samples with the reference. Both boundary frames need valid measurements and different positions.

Video measurements remain limited by captured frames, compression and the selected detail. Subpixel estimates do not recover missing frames. These trackers measure translation rather than scale, opacity or text deformation.

## CLI

The optional native CLI uses the Go analysis package and the `projects/` directory. It requires the native dependencies listed above; deployed browser users do not need them.

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

`frames` returns local image paths and timestamps for agent inspection. `measure` returns the reference points, fitted duration, RMS error, maximum error and sample counts as JSON. Omit `--fit` to assess a fixed duration. `--projects PATH` selects a separate project directory for tests or batch work. `serve --port PORT` changes the local server port.

## Code

| Location | Responsibility |
| --- | --- |
| `cmd/ui-motion/` | Native CLI and local static server |
| `cmd/web-static/` | Static shell exporter without native processing dependencies |
| `internal/motion/` | Reference curves shared by the exporter and native analysis |
| `internal/analysis/` | Project files, FFmpeg import/export and GoCV tracking |
| `internal/web/` | Templ shell, static export and native compatibility handlers |
| `../tokens/forge/components/ui/` | Shared templ controls and navigation anatomy |
| `web/main.ts`, `web/workspace.ts` | Startup, controller composition and workspace presentation |
| `web/startup.ts`, `web/initial-layout.ts` | Early navigation and saved panel sizing shared with the live layout controller |
| `web/projects-controller.ts` | Active project, autosave queue, recent projects, import and portable project files |
| `web/transport-controller.ts`, `web/timeline*.ts` | Playback, seeking, alignment and timeline interaction/rendering |
| `web/operations-controller.ts`, `web/exports-controller.ts` | Busy state, cancellation, progress and export dialog |
| `web/graph.ts`, `web/graph-renderer.ts`, `web/reference-controls.ts` | Measurements, plot rendering and reference settings |
| `web/local-*.ts`, `web/worker-messages.ts` | Browser processing, IndexedDB storage and typed worker messages |
| `public/` | Token Catalog CSS, fonts and unmodified interaction runtimes |

Go renders the control markup. Dynamic list entries clone templates rendered by those same components. TypeScript handles analysis interactions rather than rebuilding component anatomy. Vite builds the browser assets; it does not serve the application shell.

Refresh Material assets from Token Catalog with:

```sh
node scripts/import-material.mjs ../tokens
make build
```

`make test` checks workspace persistence and recording preservation, alignment and source-frame mapping, known fractional motion, both edge axes, correction and tracking loss, curve fitting, variable frame timing, linked-time mapping, exports, static route restrictions, rendered controls, token references and shared runtime integrity. Generate templ code after editing templates with `make generate`.

`npm run lint` runs Oxlint with type-aware checking and all correctness, suspicious, pedantic, performance, style and nursery categories enabled. Explicit `any` and unsafe assignments, calls, arguments, property access and returns are errors. TypeScript also checks unchecked array access, unused declarations, returns and switch fallthrough. The production build runs lint before compilation.

The configuration excludes the restriction category, whose blanket bans include async functions, named exports and optional chaining. Explicit style exceptions retain the app's DOM helpers, nullable project state, sequential media processing and inferred signatures. Files are limited to 650 nonblank, noncomment lines. Controller lifecycle tests load complete modules with browser and processing boundaries supplied by the test; they do not extract functions from source text.

New project saves the open project before creating and activating an empty workspace. Default names are unique among local projects. Removing a video's last track leaves its project open; Close project returns to the library. New project and Close project keep the current project open if its save fails.

## Size tracking and exports

Choose **Width (opposing edges)** or **Height (opposing edges)** to measure a changing size. Draw a box with each opposing boundary near its corresponding side. The tracker follows the two edges independently through the central 60% of the box to avoid rounded corners. Use a strip that stays across straight edges throughout the motion. Width and height are available as chart measurements and reference comparisons.

JSON and CSV store measured sizes separately from the tracking box dimensions (`measuredWidth` and `measuredHeight`). Weak matches have no measured value. Correct a size measurement by drawing the box around both edges at the affected frame and using **Correct position here**.

The Export dialog has its own first and last frame. **Tracking range**, **Playback range** and **Full video** fill those fields. Changing the export interval does not change the tracking range used for normalization and reference comparison. Exports start with the tracking range selected.

Choose speed and a finite number of repetitions. Switch the tracking outlines, displacement chart, reference curve, results, corrections, tracking loss and frame labels independently. **Include second video** uses the existing workspace alignment. **Use current chart window and scale** keeps the current plot bounds; otherwise the export fits the tracking range. Choose **Chart SVG** in the format menu to save a standalone chart with the same settings. Reference parameters and errors are printed when enabled. Export timing follows source timestamps, including variable frame intervals.

```sh
./scripts/run.sh track PROJECT_ID --method width --region 683,90,244,410 --start 120 --end 151
./scripts/run.sh export PROJECT_ID --format video --start 120 --end 151 --speed 0.25 --repeat 2 --axis width
./scripts/run.sh export PROJECT_ID --format chart --start 120 --end 131 --axis width
./scripts/run.sh export PROJECT_ID --format video --export-options /tmp/export-options.json
```

The native CLI accepts the following JSON with `--export-options`. The static website exposes no processing API:

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

Optional `chart.window` is a pair of source timestamps in milliseconds; `chart.scale` is a pair of axis values. `chart.comparison` takes `id`, `first`, `last` and `offset` (second video's workspace offset minus the primary video's offset, in milliseconds). Omit `reference` for measured traces alone. Spring references use the same stiffness, damping and velocity fields as the browser UI and native CLI.

UI changes follow the [workspace design guidelines](docs/design-guidelines.md).

## Static startup and offline files

`make build` creates the static shell with first-paint CSS copied from the compiled component and app styles. Its token dependencies retain their captured values and theme contexts. An inline script restores the shared navigation and saved panel dimensions before deferred controls run. The complete stylesheet remains in `assets/main.css`; a preload starts its download immediately. Workspace controls wait for that sheet before becoming interactive.

Component scripts appear in HTML as ordered `defer` scripts, so their downloads overlap. Reference presets load directly alongside the IndexedDB project list; browsing the library does not start the processing worker. The shared select template renders its initial label and selection without JavaScript.

Offline installation caches the shell, fonts and control scripts. Example videos, FFmpeg and OpenCV download on demand and enter the cache after successful requests. Processing offline requires those engines to have been downloaded previously. Project and video persistence remains in IndexedDB.

The output includes gzip and Brotli sidecars. The local static server (`make serve`) negotiates them through `Accept-Encoding`; a static CDN can provide its own compression. No upload or processing endpoints are required. The former Python preview server does not negotiate these files.
