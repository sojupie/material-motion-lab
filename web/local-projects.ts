import { strFromU8,strToU8,unzipSync,zipSync } from "fflate";
import { required } from "./errors";
import { parseJSON } from "./json";
import { region } from "./local-analysis";
import { importVideo } from "./local-media";
import type { StoredVideo } from "./local-store";
import { all,read,removeProject,updateProject,write } from "./local-store";
import type { ProgressReporter } from "./processing-progress";
import type { Project,Workspace } from "./types";

export function validateProject(value: unknown): Project {
  const p = value as
    | (Omit<Project, "settings"> & {
        settings: Project["settings"] | null | undefined;
      })
    | null
    | undefined;
  if (
    !p ||
    typeof p.name !== "string" ||
    !p.settings ||
    typeof p.settings !== "object" ||
    Array.isArray(p.settings) ||
    p.name.length > 512 ||
    !Number.isInteger(p.width) ||
    !Number.isInteger(p.height) ||
    p.width < 4 ||
    p.height < 4 ||
    Math.max(p.width, p.height) > 3840 ||
    Math.min(p.width, p.height) > 2160 ||
    !Array.isArray(p.times) ||
    p.times.length === 0 ||
    p.times.length > 6000 ||
    p.times.some(
      (t, i) =>
        !Number.isFinite(t) || t < 0 || (i > 0 && t < required(p.times[i - 1])),
    ) ||
    !Array.isArray(p.samples) ||
    p.samples.length > p.times.length ||
    !Array.isArray(p.anchors) ||
    p.anchors.length > p.times.length
  ) {
    throw new Error("Invalid project measurements.");
  }
  if (p.selection) {
    region(p.selection, p.width, p.height);
  }
  for (const a of p.anchors) {
    if (
      !Number.isInteger(a.frame) ||
      a.frame < 0 ||
      a.frame >= p.times.length
    ) {
      throw new Error("Invalid correction frame.");
    }
    region(a.region, p.width, p.height);
  }
  for (const s of p.samples) {
    if (
      !Number.isInteger(s.frame) ||
      s.frame < 0 ||
      s.frame >= p.times.length ||
      !Number.isFinite(s.t) ||
      Math.abs(s.t - required(p.times[s.frame])) > 1 ||
      [s.x, s.y, s.measuredWidth, s.measuredHeight].some(
        (v) => v !== null && v !== undefined && !Number.isFinite(v),
      ) ||
      ![s.width, s.height, s.score].every((value) => Number.isFinite(value))
    ) {
      throw new Error("Invalid tracking sample.");
    }
  }
  return p as Project;
}
export function validateWorkspace(value: unknown): Workspace {
  const w = value as
    | (Omit<Workspace, "schema" | "playback"> & {
        schema: number;
        playback?: { speed: number; loop: boolean; range: number[] | null };
      })
    | null
    | undefined;
  if (
    w?.schema !== 1 ||
    typeof w.name !== "string" ||
    w.name.length > 200 ||
    !Array.isArray(w.tracks) ||
    w.tracks.length > 2 ||
    new Set(w.tracks.map((t) => t.id)).size !== w.tracks.length
  ) {
    throw new Error("Invalid project workspace.");
  }
  for (const t of w.tracks) {
    if (
      typeof t.id !== "string" ||
      !Number.isFinite(t.offset) ||
      t.offset < 0 ||
      t.offset > 86_400_000 ||
      !Number.isInteger(t.first) ||
      !Number.isInteger(t.last) ||
      t.first < 0 ||
      t.last < t.first ||
      (t.sync !== null && (!Number.isInteger(t.sync) || t.sync < 0))
    ) {
      throw new Error("Invalid workspace track.");
    }
  }
  if (
    w.playback &&
    (!Number.isFinite(w.playback.speed) ||
      w.playback.speed < 0.125 ||
      w.playback.speed > 8 ||
      typeof w.playback.loop !== "boolean" ||
      (w.playback.range !== null &&
        (!Array.isArray(w.playback.range) ||
          w.playback.range.length !== 2 ||
          w.playback.range.some((t) => !Number.isFinite(t)) ||
          required(w.playback.range[1]) < required(w.playback.range[0]))))
  ) {
    throw new Error("Invalid playback settings.");
  }
  if (JSON.stringify(w).length > 65_536) {
    throw new Error("Project settings are too large.");
  }
  return w as Workspace;
}
export async function exportProject(
  id: string,
  progress: ProgressReporter = () => {},
) {
  progress("Preparing project file…");
  const workspace = await read<Workspace>("projects", id);
  const videos = [];
  const files: Record<string, Uint8Array> = {};
  for (const [i, t] of workspace.tracks.entries()) {
    const v = await read<StoredVideo>("videos", t.id);
    const source = `media/${i}${v.extension}`;
    files[source] = new Uint8Array(await v.source.arrayBuffer());
    videos.push({ ...v.project, schema: 1, source });
  }
  files["project.json"] = strToU8(
    JSON.stringify({ format: "motion-tracker", schema: 1, workspace, videos }),
  );
  return new Blob([Uint8Array.from(zipSync(files, { level: 0 }))], {
    type: "application/zip",
  });
}
export async function importProject(
  blob: Blob,
  progress: ProgressReporter = () => {},
) {
  progress("Reading project file…");
  if (blob.size > 512 * 1024 * 1024) {
    throw new Error("Project exceeds 512 MB.");
  }
  let total = 0;
  let count = 0;
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
    filter: (info) => {
      total += info.originalSize;
      count++;
      if (
        total > 512 * 1024 * 1024 ||
        info.originalSize > 256 * 1024 * 1024 ||
        count > 3 ||
        !/^(project\.json|media\/[01]\.(mp4|mov|webm|mkv|avi|gif))$/.test(
          info.name,
        )
      ) {
        throw new Error("Invalid or oversized project archive.");
      }
      return true;
    },
  });
  if (
    !files["project.json"] ||
    files["project.json"].length > 8 * 1024 * 1024
  ) {
    throw new Error("Missing or oversized project manifest.");
  }
  const data = parseJSON(strFromU8(files["project.json"])) as {
    format: string;
    schema: number;
    workspace: Workspace;
    videos: (Project & { source: string })[];
  };
  if (
    data.format !== "motion-tracker" ||
    data.schema !== 1 ||
    !Array.isArray(data.videos) ||
    data.videos.length > 2
  ) {
    throw new Error("Unsupported project format.");
  }
  const w = validateWorkspace(data.workspace);
  const mapping = new Map<string, string>();
  const created: string[] = [];
  try {
    for (const p of data.videos) {
      validateProject(p);
      const { source } = p;
      if (typeof source !== "string" || !files[source] || mapping.has(p.id)) {
        throw new Error("Missing or duplicate project video.");
      }
      const id = crypto.randomUUID();
      await importVideo(
        new Blob([Uint8Array.from(files[source])]),
        source,
        id,
        p,
        progress,
      );
      mapping.set(p.id, id);
      created.push(id);
    }
    for (const t of w.tracks) {
      const id = mapping.get(t.id);
      if (!(id !== undefined && id !== "")) {
        throw new Error("Missing workspace video.");
      }
      const v = await read<StoredVideo>("videos", id);
      if (
        t.last >= v.project.times.length ||
        (t.sync !== null && t.sync >= v.project.times.length)
      ) {
        throw new Error("Track range outside video.");
      }
      t.id = id;
    }
    const result = { ...w, id: crypto.randomUUID() };
    await write("projects", result.id, result);
    return result;
  } catch (error) {
    if (created.length > 0) {
      const id = crypto.randomUUID();
      await write("projects", id, {
        id,
        name: "Incomplete import",
        schema: 1,
        tracks: created.map((id) => ({
          id,
          offset: 0,
          first: 0,
          last: 0,
          sync: null,
        })),
      });
      await removeProject(id);
    }
    throw error;
  }
}
export async function exampleProject(progress: ProgressReporter = () => {}) {
  progress("Opening example project…");
  const existing = (await all<Workspace>("projects")).find(
    (p) => p.id === "example-carousel",
  );
  // Reuse edits while the bundled video is still present. Removing or replacing
  // That video must not turn Open example into opening an empty/custom project.
  if (
    existing?.tracks.some((track) => track.id === "example-video") === true &&
    (await read<StoredVideo>("videos", "example-video").catch(() => null))
  ) {
    return existing;
  }
  progress("Loading example video…");
  const base = new URL(/* @vite-ignore */ "../example/", import.meta.url);
  const raw = await fetch(new URL("project.json", base));
  if (!raw.ok) {
    throw new Error("Example is unavailable.");
  }
  const template = validateProject((await raw.json()) as Project);
  const response = await fetch(new URL("carousel.mp4", base));
  if (!response.ok) {
    throw new Error("Example video is unavailable.");
  }
  const v = await importVideo(
    await response.blob(),
    "Carousel press — example.mp4",
    "example-video",
    template,
    progress,
  );
  const first = template.settings.start ?? 0;
  const last = template.settings.end ?? v.project.times.length - 1;
  const w: Workspace = {
    id: "example-carousel",
    schema: 1,
    name: "Carousel press",
    tracks: [{ id: v.id, offset: 0, sync: null, first, last }],
    playback: {
      range: [
        required(v.project.times[first]),
        required(v.project.times[last]),
      ],
      speed: 0.5,
      loop: true,
    },
  };
  await updateProject(w);
  return w;
}
