import { FFmpeg } from "@ffmpeg/ffmpeg";
import { required } from "./errors";
import { parseJSON } from "./json";
import type { StoredVideo } from "./local-store";
import { read,saveVideo } from "./local-store";
import type { ProgressReporter } from "./processing-progress";
import type { Project } from "./types";

const base = new URL(/* @vite-ignore */ "../", import.meta.url);
let engine: FFmpeg | undefined;
export async function ffmpeg(progress: ProgressReporter = () => {}) {
  if (!engine) {
    progress("Loading video engine…");
    const f = new FFmpeg();
    try {
      await f.load({
        classWorkerURL: new URL("ffmpeg/worker.js", base).href,
        coreURL: new URL("ffmpeg/ffmpeg-core.js", base).href,
        wasmURL: new URL("ffmpeg/ffmpeg-core.wasm", base).href,
      });
      engine = f;
    } catch (error) {
      f.terminate();
      throw new Error(
        `Could not load the on-device video engine: ${String(error)}`,
        { cause: error },
      );
    }
  }
  return engine;
}
export async function importVideo(
  file: Blob,
  name: string,
  id: string = crypto.randomUUID(),
  template?: Project,
  progress: ProgressReporter = () => {},
): Promise<StoredVideo> {
  if (file.size > 256 * 1024 * 1024) {
    throw new Error("Video exceeds 256 MB.");
  }
  const ext = /\.(mp4|mov|webm|mkv|avi|gif)$/i.exec(name)?.[0].toLowerCase();
  if (!(ext !== undefined && ext !== "")) {
    throw new Error("Choose an MP4, MOV, WebM, MKV, AVI or GIF video.");
  }
  const f = await ffmpeg(progress);
  const input = `input${ext}`;
  const times: number[] = [];
  let width: number;
  let height: number;
  const frames: Blob[] = [];
  try {
    progress("Reading video metadata…");
    await f.writeFile(input, new Uint8Array(await file.arrayBuffer()));
    // Inspect dimensions before decoding images, then bound total decoded pixels.
    await f.ffprobe([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      input,
      "-o",
      "probe.json",
    ]);
    const probe = parseJSON(
      new TextDecoder().decode((await f.readFile("probe.json")) as Uint8Array),
    ) as { streams?: { width: number; height: number }[] };
    width = probe.streams?.[0]?.width ?? 0;
    height = probe.streams?.[0]?.height ?? 0;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 4 ||
      height < 4 ||
      Math.max(width, height) > 3840 ||
      Math.min(width, height) > 2160
    ) {
      throw new Error("Video dimensions exceed 3840 × 2160 pixels.");
    }
    const maxFrames = Math.min(
      6000,
      Math.floor(200_000_000 / (width * height)),
    );
    await f.ffprobe([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_frames",
      "-show_entries",
      "frame=best_effort_timestamp_time",
      "-of",
      "json",
      input,
      "-o",
      "times.json",
    ]);
    const timestamps = parseJSON(
      new TextDecoder().decode((await f.readFile("times.json")) as Uint8Array),
    ) as { frames?: { best_effort_timestamp_time: string }[] };
    for (const frame of timestamps.frames ?? []) {
      times.push(Number(frame.best_effort_timestamp_time) * 1000);
    }
    if (times.length === 0) {
      throw new Error("Could not read video frame timestamps.");
    }
    if (times.length > maxFrames) {
      throw new Error(
        "Video is too long for on-device processing. Use a shorter recording.",
      );
    }
    if (
      times.some(
        (t, i) => !Number.isFinite(t) || (i > 0 && t < required(times[i - 1])),
      )
    ) {
      throw new Error("Video timestamps are invalid.");
    }
    progress("Decoding video…");
    const decoding = ({ time }: { time: number }) => {
      progress("Decoding video…", time / 1000, times.at(-1)! || 1);
    };
    f.on("progress", decoding);
    let code: number;
    try {
      code = await f.exec([
        "-i",
        input,
        "-map",
        "0:v:0",
        "-fps_mode",
        "passthrough",
        "-frames:v",
        String(maxFrames + 1),
        "frame-%06d.png",
      ]);
    } finally {
      f.off("progress", decoding);
    }
    if (code !== 0) {
      throw new Error(
        "Could not decode this video. Try an MP4 or WebM export.",
      );
    }
    const zero = required(times[0]);
    times.forEach((t, i) => {
      times[i] = t - zero;
    });
    for (let i = 0; i < times.length; i++) {
      progress("Storing video frames…", i, times.length);
      const bytes = (await f.readFile(
        `frame-${String(i + 1).padStart(6, "0")}.png`,
      )) as Uint8Array;
      frames.push(new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
      await f.deleteFile(`frame-${String(i + 1).padStart(6, "0")}.png`);
    }
    const project: Project = template
      ? { ...template, id, name: template.name }
      : {
          id,
          name,
          width,
          height,
          times,
          zeroFrame: 0,
          selection: null,
          anchors: [],
          samples: [],
          settings: {},
        };
    if (
      template &&
      (template.width !== width ||
        template.height !== height ||
        template.times.length !== times.length ||
        template.times.some((t, i) => Math.abs(t - required(times[i])) > 1))
    ) {
      throw new Error("Project timestamps do not match its video.");
    }
    const result = { id, project, source: file, extension: ext };
    progress("Saving video in this browser…");
    await saveVideo(result, frames);
    return result;
  } finally {
    for (const entry of await f.listDir("/")) {
      if (!entry.isDir) {
        await f.deleteFile(entry.name);
      }
    }
  }
}
export async function grayFrame(id: string, i: number) {
  const blob = await read<Blob>("frames", [id, i]);
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const data = new Uint8Array(bitmap.width * bitmap.height);
    for (let j = 0; j < data.length; j++) {
      data[j] = Math.round(
        0.299 * required(rgba[j * 4]) +
          0.587 * required(rgba[j * 4 + 1]) +
          0.114 * required(rgba[j * 4 + 2]),
      );
    }
    return { data, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
