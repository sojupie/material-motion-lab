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

## Workspace

Open a recording and choose a **Second video** to compare it. Both videos use one playhead and one time ruler. Play and frame stepping operate on the workspace; frame stepping follows the selected video’s timestamps.

Click a viewer title or a clip to select its video. The inspector shows that video’s tracking settings. Viewer magnification sits above each image. Timeline zoom changes the visible time span in both the tracks and displacement graph. The horizontal scrollbar appears when zoomed in and pans that span. **Fit clips** restores the full span; **Fit range** frames the selected tracking range.

Drag the time ruler to scrub between recorded frames. The selected video defines the frame grid within its clip; outside it, the playhead snaps to the other video’s frames. Zoom in to see individual frame ticks. Drag a clip to change its offset. Drag its **In** and **Out** handles to choose a tracking range. The same boundaries appear in the displacement graph. Range handles and clips also support left/right arrow keys when focused. Space plays or pauses, and the arrow keys step frames outside text fields and other controls.

Playback has its own range, separate from tracking. Seek to a frame and press **Set start** or **Set end** beside **Playback range**, or drag the handles on the **Play** row. **Full clips** clears the playback range. Playback resumes from the playhead inside the range and starts at the range beginning when outside it. **Loop** repeats that interval; **Speed** runs from ⅛× to 4×. Both videos follow the same playback clock. Frame stepping and scrubbing remain available outside the playback range.

## Track motion

1. Select a video and choose its range with the timeline handles or inspector fields.
2. Press **Go to start** in the inspector.
3. Choose a tracking method and press **Draw tracking region**. Draw around a distinct detail for **Image patch**, or draw a narrow strip across a straight boundary for either edge method.
4. Press **Track selected range**.
5. To correct a result, go to the bad frame, draw the correct region and press **Set tracking position at playhead**. This adds a correction and recalculates tracking.

Correction diamonds and tracking-loss marks appear on the clip. The inspector has previous/next actions for each. Changing a tracking method, search setting or region marks the measurements as needing an update. Selecting a smaller range can analyze existing measurements without retracking.

Image patches track position in two dimensions. Edge tracking follows one axis through a fixed strip; keep corners and other boundaries outside that strip. Both methods estimate subpixel positions. Similarity is the patch correlation score. Edge strength is a ratio to the last manual anchor. Neither score is a probability of correctness. Weak matches leave gaps.

Existing recordings retain their saved measurements. Rerun tracking to replace older whole-pixel results with subpixel estimates. JSON, CSV and annotated video exports are under **Export** in the inspector.

## Align videos

Select video A and scrub to the event you want to align. Press **Mark sync point** under **Alignment** in the inspector. Repeat for B, then press **Align sync points**. Video B moves so the two markers coincide. Clip dragging, the offset field and frame-nudge actions provide manual adjustment.

Alignment, sync markers, tracking ranges, playback range, loop and speed save in `workspace.json` beside the primary recording’s `project.json`. The playback range uses workspace time; moving a clip leaves that interval in place. If the workspace becomes shorter, the interval is clamped to its bounds. Moving clips does not change either recording’s stored time zero or tracking measurements. Existing comparisons supply the initial alignment when no workspace has been saved. `GET` and `PUT /api/projects/{id}/workspace` read and save this state.

Playback uses the original timestamps, including different frame rates and irregular frame intervals. A viewer holds its boundary frame outside the clip and labels it accordingly.

## Inspect displacement

The graph below the tracks shares their visible time span and playhead. Hover a sample to see its frame, time, displacement and tracking score. Click a sample to move the playhead and inspect both videos. Click a trace to select its recording. Dragging the graph does not scrub or change the interval.

Select horizontal or vertical displacement and recording pixels or progress. **Fit motion** fits visible samples and reference curves. The vertical zoom buttons narrow or widen the current axis range. Enable **Pan plot** and drag the chart to move both axes; horizontal movement also pans the shared timeline. Turn it off to select samples again. Drag the vertical axis to pan vertically, or focus it and use Up/Down. Home restores Fit motion. **Fit end position** centers a close view on the selected recording’s final measured position. The displayed axis range uses the selected units. Choose a **Reference curve** beside the chart settings to show its duration and fitting controls. Displacement starts from the first position in each selected tracking range.

An MD3 standard or linear reference runs from the range’s first measured position to its last. Set a duration or fit it to either recording. Fitting changes duration only. RMS error and maximum error compare valid samples with the curve. Both endpoint frames need valid measurements and different positions.

Video measurements remain limited by captured frames, compression and the selected detail. Subpixel estimates do not recover missing frames. These trackers measure translation rather than scale, opacity or text deformation.

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
| `web/` | Workspace state, shared timeline, video viewers, tracking inspector and displacement graph |
| `public/` | Token Catalog CSS, fonts and unmodified interaction runtimes |

Go renders the control markup. Dynamic list entries clone templates rendered by those same components. TypeScript handles analysis interactions rather than rebuilding component anatomy. Vite builds the browser assets; it does not serve the application shell.

Refresh Material assets from Token Catalog with:

```sh
node scripts/import-material.mjs ../tokens
make build
```

`make test` checks workspace persistence and recording preservation, alignment and source-frame mapping, known fractional motion, both edge axes, correction and tracking loss, curve fitting, variable frame timing, linked-time mapping, exports, HTTP validation, server-rendered controls, token references and shared runtime integrity. Generate templ code after editing templates with `make generate`.
