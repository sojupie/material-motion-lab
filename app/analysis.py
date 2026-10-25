"""Video import and measurements shared by the HTTP API and CLI."""

from pathlib import Path
import csv
import json
import math
import shutil
import subprocess
import tempfile
import uuid

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = ROOT / "projects"
MAX_FRAMES = 6000


def command(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(result.stderr[-1500:] or "Video processing failed")
    return result.stdout


def inspect(path):
    data = json.loads(
        command(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_streams",
                "-show_frames",
                "-show_entries",
                "stream=width,height,codec_name:frame=best_effort_timestamp_time,pkt_duration_time",
                "-of",
                "json",
                str(path),
            ]
        )
    )
    if not data.get("streams") or not data.get("frames"):
        raise ValueError("No video frames found")
    frames = data["frames"]
    if len(frames) > MAX_FRAMES:
        raise ValueError(
            f"Video exceeds {MAX_FRAMES} frames. Trim it before importing."
        )
    try:
        timestamps = [float(f["best_effort_timestamp_time"]) for f in frames]
    except (KeyError, ValueError):
        raise ValueError("Video frames lack usable timestamps")
    if not all(math.isfinite(t) for t in timestamps) or any(
        b <= a for a, b in zip(timestamps, timestamps[1:])
    ):
        raise ValueError("Video timestamps must be finite and strictly increasing")
    start = timestamps[0]
    return {**data["streams"][0], "times": [(t - start) * 1000 for t in timestamps]}


def folder(project):
    try:
        if str(uuid.UUID(project)) != project:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid project ID")
    return PROJECTS / project


def save(data):
    dest = folder(data["id"]) / "project.json"
    tmp = dest.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, allow_nan=False))
    tmp.replace(dest)


def load(project):
    return json.loads((folder(project) / "project.json").read_text())


def import_video(path, name=None):
    path = Path(path)
    meta = inspect(path)
    project = str(uuid.uuid4())
    dest = folder(project)
    (dest / "frames").mkdir(parents=True)
    try:
        shutil.copyfile(path, dest / ("source" + path.suffix.lower()))
        command(
            [
                "ffmpeg",
                "-v",
                "error",
                "-i",
                str(path),
                "-map",
                "0:v:0",
                "-fps_mode",
                "passthrough",
                "-frames:v",
                str(MAX_FRAMES + 1),
                str(dest / "frames/%06d.png"),
            ]
        )
        frames = sorted((dest / "frames").glob("*.png"))
        if len(frames) != len(meta["times"]):
            raise ValueError("Decoded frames do not match the timestamp count")
        first = cv2.imread(str(frames[0]))
        h, w = first.shape[:2]
        data = {
            "schema": 1,
            "id": project,
            "name": name or path.name,
            "source": "source" + path.suffix.lower(),
            "width": w,
            "height": h,
            "times": meta["times"],
            "zeroFrame": 0,
            "selection": None,
            "anchors": [],
            "samples": [],
            "settings": {},
        }
        save(data)
        return data
    except Exception:
        shutil.rmtree(dest)
        raise


def image(project, frame):
    return cv2.imread(
        str(folder(project) / "frames" / f"{frame + 1:06d}.png"), cv2.IMREAD_GRAYSCALE
    )


def region(values, width, height):
    if len(values) != 4 or not all(math.isfinite(float(v)) for v in values):
        raise ValueError("Region needs four finite values: x,y,width,height")
    x, y, w, h = [int(round(v)) for v in values]
    if w < 4 or h < 4 or x < 0 or y < 0 or x + w > width or y + h > height:
        raise ValueError("Select a region at least 4 × 4 pixels inside the frame")
    return [x, y, w, h]


def track(
    project, selection, start=0, end=None, anchors=None, search=60, threshold=0.65
):
    data = load(project)
    end = len(data["times"]) - 1 if end is None else end
    if not 0 <= start <= end < len(data["times"]):
        raise ValueError("Invalid frame interval")
    if not 4 <= search <= 1000 or not 0 <= threshold <= 1:
        raise ValueError("Invalid tracking settings")
    selection = region(selection, data["width"], data["height"])
    anchors = anchors if anchors is not None else data["anchors"]
    fixed = {
        int(a["frame"]): region(a["region"], data["width"], data["height"])
        for a in anchors
        if start <= int(a["frame"]) <= end
    }
    fixed[start] = selection
    samples = []
    x, y, w, h = selection
    template = None
    for i in range(start, end + 1):
        gray = image(project, i)
        if gray is None:
            raise ValueError(f"Cannot decode frame {i}")
        manual = i in fixed
        if manual:
            x, y, w, h = fixed[i]
            template = gray[y : y + h, x : x + w].copy()
            if float(template.std()) < 2:
                raise ValueError(
                    f"Frame {i}: region is too uniform to track. Include an edge or texture."
                )
            score, valid = 1.0, True
        else:
            left, top = max(0, x - search), max(0, y - search)
            right, bottom = (
                min(gray.shape[1], x + w + search),
                min(gray.shape[0], y + h + search),
            )
            scores = cv2.matchTemplate(
                gray[top:bottom, left:right], template, cv2.TM_CCOEFF_NORMED
            )
            _, score, _, point = cv2.minMaxLoc(scores)
            valid = math.isfinite(score) and score >= threshold
            if valid:
                x, y = left + point[0], top + point[1]
        samples.append(
            {
                "frame": i,
                "t": data["times"][i],
                "x": x if valid else None,
                "y": y if valid else None,
                "width": w,
                "height": h,
                "score": float(score) if math.isfinite(score) else 0,
                "valid": valid,
                "manual": manual,
            }
        )
    data.update(
        selection=selection,
        anchors=[{"frame": i, "region": r} for i, r in sorted(fixed.items())],
        samples=samples,
        settings={"start": start, "end": end, "search": search, "threshold": threshold},
    )
    save(data)
    return data


def export_csv(project):
    data = load(project)
    dest = folder(project) / "measurements.csv"
    with dest.open("w", newline="") as f:
        out = csv.DictWriter(
            f,
            fieldnames=[
                "frame",
                "t",
                "x",
                "y",
                "width",
                "height",
                "score",
                "valid",
                "manual",
            ],
        )
        out.writeheader()
        out.writerows(data["samples"])
    return dest


def plot_panel(data, current, axis, height):
    panel = np.full((height, 440, 3), (32, 29, 29), dtype=np.uint8)
    color = (235, 200, 184)

    def text(value, x, y, scale=0.46):
        cv2.putText(
            panel,
            value,
            (x, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            scale,
            (235, 235, 235),
            1,
            cv2.LINE_AA,
        )

    text("Horizontal position" if axis == "x" else "Vertical position", 20, 28, 0.6)
    text("Displacement (recording px)", 20, 52)
    values = [s[axis] for s in data["samples"] if s["valid"]]
    zero = data["times"][data["zeroFrame"]]
    origin = next(
        (s[axis] for s in reversed(data["samples"]) if s["valid"] and s["t"] <= zero),
        values[0],
    )
    low, high = min(0, min(values) - origin) - 2, max(0, max(values) - origin) + 2
    duration = max(1, data["times"][-1])
    left, right, top, bottom = 65, 415, 85, height - 60

    def point(t, value):
        return (
            round(left + t / duration * (right - left)),
            round(bottom - (value - origin - low) / (high - low) * (bottom - top)),
        )

    for n in range(5):
        t = duration * n / 4
        x = point(t, origin)[0]
        cv2.line(panel, (x, top), (x, bottom), (75, 70, 70), 1)
        text(str(round(t - zero)), x - 14, bottom + 22, 0.36)
        v = low + (high - low) * n / 4
        y = point(0, origin + v)[1]
        cv2.line(panel, (left, y), (right, y), (75, 70, 70), 1)
        text(f"{v:.0f}", 12, y + 4, 0.4)
    previous = None
    for sample in data["samples"]:
        if not sample["valid"]:
            previous = None
            continue
        p = point(sample["t"], sample[axis])
        if previous is not None:
            cv2.line(panel, previous, p, color, 2, cv2.LINE_AA)
        previous = p
    x = point(data["times"][current], origin)[0]
    cv2.line(panel, (x, top), (x, bottom), (130, 230, 150), 1)
    text("Time from selected zero (ms)", 100, height - 12)
    return panel


def export_video(project, axis="x"):
    if axis not in {"x", "y"}:
        raise ValueError("Axis must be x or y")
    data = load(project)
    if not data["samples"]:
        raise ValueError("Track a region before exporting")
    dest = folder(project)
    rows = {s["frame"]: s for s in data["samples"]}
    with tempfile.TemporaryDirectory(dir=dest) as temp:
        work = Path(temp)
        concat = []
        for i, t in enumerate(data["times"]):
            frame = cv2.imread(str(dest / "frames" / f"{i + 1:06d}.png"))
            row = rows.get(i)
            if row and row["valid"]:
                x, y, w, h = [int(row[k]) for k in ["x", "y", "width", "height"]]
                cv2.rectangle(frame, (x, y), (x + w, y + h), (70, 220, 100), 2)
            text = f"Frame {i}   {t - data['times'][data['zeroFrame']]:+.1f} ms"
            if row and not row["valid"]:
                text += "   TRACK LOST"
            height = max(320, frame.shape[0] + 46)
            padded = np.full((height, frame.shape[1], 3), 24, dtype=np.uint8)
            padded[46 : 46 + frame.shape[0]] = frame
            cv2.putText(
                padded,
                text,
                (12, 28),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (235, 235, 235),
                1,
                cv2.LINE_AA,
            )
            frame = np.hstack([padded, plot_panel(data, i, axis, height)])
            file = work / f"{i:06d}.png"
            cv2.imwrite(str(file), frame)
            duration = (
                (data["times"][i + 1] - t) / 1000
                if i + 1 < len(data["times"])
                else ((t - data["times"][i - 1]) / 1000 if i else 1 / 30)
            )
            concat += [
                f"file '{file.name}'",
                "option framerate 1000",
                f"duration {duration:.9f}",
            ]
        concat += [f"file '{len(data['times']) - 1:06d}.png'", "option framerate 1000"]
        (work / "frames.txt").write_text("\n".join(concat) + "\n")
        command(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(work / "frames.txt"),
                "-fps_mode",
                "vfr",
                "-enc_time_base",
                "1:1000",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-movflags",
                "+faststart",
                str(dest / "annotated.mp4"),
            ]
        )
    return dest / "annotated.mp4"


def set_zero(project, frame):
    data = load(project)
    if not 0 <= frame < len(data["times"]):
        raise ValueError("Frame outside recording")
    data["zeroFrame"] = frame
    save(data)
    return data


def compare(project, reference=None, zero=0):
    data = load(project)
    if reference:
        ref = load(reference)
        if not 0 <= zero < len(ref["times"]):
            raise ValueError("Comparison frame outside recording")
        data["comparison"] = {"id": reference, "zeroFrame": zero}
    else:
        data["comparison"] = None
    save(data)
    return data
