# UI Motion

Measure UI motion from video. Open a recording, track an object or edge, and inspect its position beside the frames.

## Run

Requires Python 3.11+, Node 22.12+, FFmpeg and ffprobe.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock
.venv/bin/pip install --no-deps -e .
npm ci
npm run build
.venv/bin/ui-motion serve
```

Open http://127.0.0.1:8091. The server runs locally. Videos and results are stored in `projects/`, which Git ignores.

For frontend development, run `npm run dev` alongside the Python server.

## Track a recording

1. Open a video.
2. Find the frame where tracking should start. Draw around a distinct edge or textured detail.
3. Set the last frame and press **Track from this frame**.
4. Click the graph or step through the frames to check the tracked rectangle.
5. To fix a mistake, draw the correct region on that frame and press **Correct position here**.

Use **Set time zero here** to mark the event you want to compare. Choose another tracked recording and set its zero frame to align the events. The recordings keep their original timing.

JSON, CSV and annotated video exports are available after tracking. The video places the tracked frame beside its position graph. Reopen a recording from the sidebar to continue working.

Tracking measures horizontal and vertical translation of a fixed image patch. It does not measure resizing, corner morphing or opacity. A weak match leaves a gap. A strong match can still follow the wrong object; inspect the rectangle and correct it where needed. Coordinates use recording pixels. Timing precision is limited by the source recording's frames.

## CLI

The CLI uses the same import, tracking and export functions as the interface.

```sh
.venv/bin/ui-motion inspect clip.mp4
.venv/bin/ui-motion import clip.mp4
# Use the returned project ID in subsequent commands.
.venv/bin/ui-motion frames PROJECT_ID --start 30 --end 90 --step 10
.venv/bin/ui-motion track PROJECT_ID --region 100,200,30,40 --start 30 --end 90
.venv/bin/ui-motion correct PROJECT_ID --frame 55 --region 140,200,30,40
.venv/bin/ui-motion zero PROJECT_ID --frame 40
.venv/bin/ui-motion compare PROJECT_ID REFERENCE_ID --zero-frame 35
.venv/bin/ui-motion export PROJECT_ID --format csv
.venv/bin/ui-motion export PROJECT_ID --format video
```

`frames` returns local image paths and timestamps. An agent can view those images, select a region, run tracking and inspect the annotated export. No browser interaction is required.

## Code

- `app/analysis.py`: video import, tracking, saved measurements and exports.
- `app/server.py`: local HTTP API and built frontend.
- `app/cli.py`: command-line entry point.
- `web/`: TypeScript interface and styles.
- `public/tokens.css`: token subset imported from Token Catalog.

There is no dependency on a running catalog. To refresh its tokens and font:

```sh
node scripts/import-tokens.mjs /path/to/tokens
npm run build
```

The import script preserves generated values and records the source hash in `public/token-source.json`. Font licensing is in `public/OFL.txt`.

## Check

```sh
.venv/bin/python -m unittest discover -s tests -v
npm run build
```

The test uses a video with known positions and variable frame timestamps. It checks tracking, lost matches, manual corrections, saved measurements, CLI output and annotated export timing.
