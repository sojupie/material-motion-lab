import { required } from "./errors";
import { measure } from "./local-analysis";
import { ffmpeg } from "./local-media";
import type { StoredVideo } from "./local-store";
import { read } from "./local-store";
import type { ProgressReporter } from "./processing-progress";
import { frameDuration } from "./timing";
import type { Axis,MotionReference,Project } from "./types";
import { sampleValue } from "./types";

export interface Chart {
  axis: Axis;
  units: string;
  start: number;
  end: number;
  reference?: MotionReference;
  duration: number;
  window?: [number, number];
  scale?: [number, number];
  statistics?: boolean;
  markers?: boolean;
  comparison?: { id: string; first: number; last: number; offset: number };
}
export interface ExportOptions {
  first: number;
  last: number;
  speed: number;
  repeat: number;
  tracking: boolean;
  plot: boolean;
  statistics: boolean;
  markers: boolean;
  time: boolean;
  chart: Chart;
}
const escape = (s: string) =>
  s.replaceAll(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export async function chartSVG(
  p: Project,
  o: Chart,
  width = 960,
  height = 360,
) {
  if (
    !["x", "y", "width", "height"].includes(o.axis) ||
    !["px", "progress"].includes(o.units)
  ) {
    throw new Error("Invalid chart options.");
  }
  const series = [
    {
      p,
      start: o.start,
      end: o.end,
      offset: 0,
      color: "#67508f",
      label: "Video A",
    },
  ];
  if (o.comparison) {
    const other = await read<StoredVideo>("videos", o.comparison.id);
    series.push({
      p: other.project,
      start: o.comparison.first,
      end: o.comparison.last,
      offset: o.comparison.offset,
      color: "#855366",
      label: "Video B",
    });
  }
  const lines: {
    points: { t: number; v: number; frame?: number }[];
    color: string;
    dash: boolean;
    label: string;
  }[] = [];
  const stats: string[] = [];
  for (const s of series) {
    const rows = s.p.samples.filter(
      (row) =>
        row.frame >= s.start &&
        row.frame <= s.end &&
        row.valid &&
        sampleValue(row, o.axis) !== null,
    );
    const from =
      sampleValue(
        rows.find((row) => row.frame === s.start),
        o.axis,
      ) ?? 0;
    const to =
      sampleValue(
        rows.find((row) => row.frame === s.end),
        o.axis,
      ) ?? from;
    const distance = to - from;
    const factor = o.units === "progress" ? 100 / (distance || 1) : 1;
    lines.push({
      points: rows.map((row) => ({
        t: row.t + s.offset,
        frame: row.frame,
        v: (sampleValue(row, o.axis)! - from) * factor,
      })),
      color: s.color,
      dash: false,
      label: s.label,
    });
    if (o.reference) {
      try {
        const m = measure(s.p, {
          axis: o.axis,
          start: s.start,
          end: s.end,
          reference: o.reference,
          duration: o.duration,
        });
        lines.push({
          points: m.points.map((row) => ({
            t: row.t + required(s.p.times[s.start]) + s.offset,
            v: row.value * factor,
          })),
          color: s.color,
          dash: true,
          label: "Reference",
        });
        stats.push(
          `${s.label}: RMSE ${(m.rmse * Math.abs(factor)).toFixed(3)} ${o.units === "progress" ? "%" : "px"}; max ${(m.maxError * Math.abs(factor)).toFixed(3)}`,
        );
      } catch (error) {
        stats.push(String(error));
      }
    }
  }
  const values = lines.flatMap((l) => l.points);
  const t0 = required(o.window?.[0] ?? p.times[o.start]);
  const t1 = required(o.window?.[1] ?? p.times[o.end]);
  const min = o.scale?.[0] ?? Math.min(0, ...values.map((v) => v.v));
  const max = o.scale?.[1] ?? Math.max(1, ...values.map((v) => v.v));
  const left = 64;
  const top = 48;
  const w = width - 88;
  const h = height - 112;
  const x = (t: number) => left + ((t - t0) / (t1 - t0 || 1)) * w;
  const y = (v: number) => top + h - ((v - min) / (max - min || 1)) * h;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fdf7ff"/><style>text{font:12px sans-serif;fill:#29242e}</style><defs><clipPath id="plot"><rect x="${left}" y="${top}" width="${w}" height="${h}"/></clipPath></defs><text x="${left}" y="22">${escape(o.axis)} displacement (${o.units === "progress" ? "%" : "px"})</text>`;
  for (let i = 0; i <= 4; i++) {
    const xx = left + (i * w) / 4;
    const yy = top + (i * h) / 4;
    svg += `<path d="M${xx},${top}v${h}M${left},${yy}h${w}" stroke="#cac4d0"/><text x="${xx}" y="${top + h + 20}" text-anchor="middle">${((t0 + ((t1 - t0) * i) / 4) / 1000).toFixed(3)}</text><text x="${left - 8}" y="${yy + 4}" text-anchor="end">${(max - ((max - min) * i) / 4).toFixed(1)}</text>`;
  }
  for (const [i, line] of lines.entries()) {
    svg += `<path clip-path="url(#plot)" d="${line.points.map((v, j) => `${j && (v.frame === undefined || v.frame === required(line.points[j - 1]).frame! + 1) ? "L" : "M"}${x(v.t).toFixed(2)},${y(v.v).toFixed(2)}`).join(" ")}" fill="none" stroke="${line.color}" stroke-width="2"${line.dash ? ' stroke-dasharray="4 4"' : ""}/><text x="${left + i * 160}" y="${height - 35}">${escape(line.label)}</text>`;
  }
  if (o.markers !== undefined && o.markers) {
    for (const s of series) {
      for (const [frame, label] of [
        [s.start, "In"],
        [s.end, "Out"],
      ] as const) {
        const xx = x(required(s.p.times[frame]) + s.offset);
        svg += `<path d="M${xx},${top}v${h}" stroke="${s.color}" stroke-dasharray="3 3"/><text x="${xx + 3}" y="${top + 14}">${label}</text>`;
      }
    }
  }
  if (o.markers !== undefined && o.markers) {
    for (const seriesEntry of series) {
      for (const sample of seriesEntry.p.samples) {
        if (
          sample.frame < seriesEntry.start ||
          sample.frame > seriesEntry.end
        ) {
          continue;
        }
        const xx = x(sample.t + seriesEntry.offset);
        if (sample.manual) {
          svg += `<path d="M${xx},${top - 7}l4,4 -4,4 -4,-4z" fill="${seriesEntry.color}"/>`;
        }
        if (!sample.valid) {
          svg += `<path d="M${xx},${top + h}v5" stroke="#b3261e"/>`;
        }
      }
    }
  }
  if (o.statistics !== undefined && o.statistics) {
    svg += `<text x="${left}" y="${height - 12}">${escape(stats.join(" · "))}</text>`;
  }
  return new Blob([`${svg}</svg>`], { type: "image/svg+xml" });
}
function validateExport(p: Project, o: ExportOptions) {
  if (
    !Number.isInteger(o.first) ||
    !Number.isInteger(o.last) ||
    o.first < 0 ||
    o.last < o.first ||
    o.last >= p.times.length ||
    !Number.isFinite(o.speed) ||
    o.speed < 0.125 ||
    o.speed > 8 ||
    !Number.isInteger(o.repeat) ||
    o.repeat < 1 ||
    o.repeat > 10
  ) {
    throw new Error("Invalid export interval or playback settings.");
  }
}
async function annotatedFrame(
  p: Project,
  i: number,
  o: ExportOptions,
  plot?: ImageBitmap,
) {
  const frame = await createImageBitmap(await read<Blob>("frames", [p.id, i]));
  try {
    const scale = Math.min(1, 1280 / p.width);
    const w = Math.ceil((p.width * scale) / 2) * 2;
    const vh = Math.ceil((p.height * scale) / 2) * 2;
    const canvas = new OffscreenCanvas(
      w,
      vh + (plot ? Math.round((w * 360) / 960 / 2) * 2 : 0),
    );
    const c = canvas.getContext("2d")!;
    c.drawImage(frame, 0, 0, w, vh);
    const s = p.samples.find((s) => s.frame === i);
    if (o.tracking && s?.valid === true && s.x !== null && s.y !== null) {
      c.strokeStyle = "#00e676";
      c.lineWidth = 2;
      c.strokeRect(
        s.x * scale,
        s.y * scale,
        (s.measuredWidth ?? s.width) * scale,
        (s.measuredHeight ?? s.height) * scale,
      );
    }
    if (o.time) {
      c.fillStyle = "#000b";
      c.fillRect(0, 0, Math.min(w, 300), 30);
      c.fillStyle = "white";
      c.font = "16px sans-serif";
      c.fillText(
        `Frame ${i} · ${(required(p.times[i]) / 1000).toFixed(3)} s`,
        8,
        21,
      );
    }
    if (plot) {
      c.drawImage(plot, 0, vh, w, canvas.height - vh);
      const start = required(o.chart.window?.[0] ?? p.times[o.chart.start]);
      const end = required(o.chart.window?.[1] ?? p.times[o.chart.end]);
      const xx =
        ((64 + ((required(p.times[i]) - start) / (end - start || 1)) * 872) *
          w) /
        960;
      if (xx >= (64 * w) / 960 && xx <= (936 * w) / 960) {
        c.strokeStyle = "#29242e";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(xx, vh + (48 * w) / 960);
        c.lineTo(xx, vh + (296 * w) / 960);
        c.stroke();
      }
    }
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    frame.close();
  }
}
export async function renderExport(
  p: Project,
  o: ExportOptions,
  preview = false,
  progress: ProgressReporter = () => {},
): Promise<Blob> {
  progress(preview ? "Rendering export preview…" : "Preparing export…");
  validateExport(p, o);
  let plot: ImageBitmap | undefined;
  // SVG rasterization in worker OffscreenCanvas is not portable; render chart pixels from the same SVG via the page when supplied.
  if (o.plot) {
    const svg = await chartSVG(p, {
      ...o.chart,
      statistics: o.statistics,
      markers: o.markers,
    });
    plot = await svgBitmap(svg);
  }
  try {
    if (preview) {
      return await annotatedFrame(p, o.first, o, plot);
    }
    const f = await ffmpeg(progress);
    const rows: string[] = [];
    try {
      for (let i = o.first; i <= o.last; i++) {
        progress("Rendering video frames…", i - o.first, o.last - o.first + 1);
        const name = `export-${i}.png`;
        await f.writeFile(
          name,
          new Uint8Array(
            await (await annotatedFrame(p, i, o, plot)).arrayBuffer(),
          ),
        );
        const dt = frameDuration(p.times, i);
        rows.push(
          `file '${name}'\noption framerate 1000\nduration ${dt / 1000 / o.speed}\n`,
        );
      }
      const sequence = `${Array(o.repeat)
        .fill(rows.join(""))
        .join("")}file 'export-${o.last}.png'\noption framerate 1000\n`;
      await f.writeFile("sequence.txt", new TextEncoder().encode(sequence));
      progress("Encoding exported video…");
      const code = await f.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "sequence.txt",
        "-fps_mode",
        "vfr",
        "-enc_time_base",
        "1:1000",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "annotated.mp4",
      ]);
      if (code) {
        throw new Error("Video export failed.");
      }
      return new Blob(
        [Uint8Array.from((await f.readFile("annotated.mp4")) as Uint8Array)],
        { type: "video/mp4" },
      );
    } finally {
      for (const entry of await f.listDir("/")) {
        if (!entry.isDir) {
          await f.deleteFile(entry.name);
        }
      }
    }
  } finally {
    plot?.close();
  }
}
// Main-thread SVG decoding is requested by the processing worker; videos never leave the device.
let bitmapID = 0;
const bitmapReplies = new Map<number, (b: ImageBitmap) => void>();
export function receiveBitmap(id: number, bitmap: ImageBitmap) {
  bitmapReplies.get(id)?.(bitmap);
  bitmapReplies.delete(id);
}
function svgBitmap(blob: Blob) {
  const id = ++bitmapID;
  return new Promise<ImageBitmap>((resolve) => {
    bitmapReplies.set(id, resolve);
    postMessage({ bitmapRequest: id, blob });
  });
}
