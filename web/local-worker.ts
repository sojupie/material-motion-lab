import { required } from "./errors";
import { objectValue } from "./json";
import type { MeasureOptions,TrackOptions } from "./local-analysis";
import { measure,track,validateReference } from "./local-analysis";
import { grayFrame,importVideo } from "./local-media";
import { matchPatch } from "./local-opencv";
import {
exampleProject,
exportProject,
importProject,
validateWorkspace,
} from "./local-projects";
import type { Chart,ExportOptions } from "./local-render";
import { chartSVG,receiveBitmap,renderExport } from "./local-render";
import type { StoredVideo } from "./local-store";
import {
all,
read,
removeProject,
saveVideo,
updateProject,
write,
} from "./local-store";
import type { ProgressReporter } from "./processing-progress";
import type { MotionReference,Workspace } from "./types";
import type { BitmapReply,ProcessingRequest } from "./worker-messages";

let references: MotionReference[] | undefined;
async function route(
  path: string,
  method: string,
  body: unknown,
  progress: ProgressReporter,
): Promise<unknown> {
  // Command paths are a local RPC compatibility boundary, never HTTP requests.
  const parts = required(path.split("?")[0])
    .replace(/^\/api/, "")
    .split("/")
    .filter(Boolean);
  const [kind, id, action, format] = parts;
  if (kind === "references") {
    if (id === "validate") {
      return validateReference(body);
    }
    if (!references) {
      const response = await fetch(
        new URL(/* @vite-ignore */ "../references.json", import.meta.url),
      );
      if (!response.ok) {
        throw new Error("Reference presets unavailable.");
      }
      const values: unknown = await response.json();
      if (!Array.isArray(values)) {
        throw new TypeError("Reference presets must be a list.");
      }
      references = values.map((value: unknown) => validateReference(value));
    }
    return references;
  }
  if (kind === "import") {
    const file = objectValue(body).file;
    if (!(file instanceof File)) {
      throw new TypeError("Choose a video file.");
    }
    return (await importVideo(file, file.name, undefined, undefined, progress))
      .project;
  }
  if (kind === "import-project") {
    const file = objectValue(body).file;
    if (!(file instanceof Blob)) {
      throw new TypeError("Choose a project file.");
    }
    return importProject(file, progress);
  }
  if (kind === "examples") {
    return exampleProject(progress);
  }
  if (kind === "workspaces") {
    if (!(id !== undefined && id !== "")) {
      if (method === "GET") {
        return all<Workspace>("projects");
      }
      const w: Workspace = {
        id: crypto.randomUUID(),
        schema: 1,
        name:
          typeof objectValue(body).name === "string"
            ? String(objectValue(body).name)
            : "Untitled project",
        tracks: [],
      };
      validateWorkspace(w);
      await write("projects", w.id, w);
      return w;
    }
    if (action === "project-file") {
      return exportProject(id, progress);
    }
    if (action === "copy") {
      progress("Copying project…");
      const source = await read<Workspace>("projects", id);
      const result = structuredClone(source);
      result.id = crypto.randomUUID();
      result.name = `${source.name.slice(0, 190)} — copy`;
      for (const t of result.tracks) {
        const v = await read<StoredVideo>("videos", t.id);
        const next = crypto.randomUUID();
        const frames = [];
        for (let i = 0; i < v.project.times.length; i++) {
          progress("Copying video frames…", i, v.project.times.length);
          frames.push(await read<Blob>("frames", [v.id, i]));
        }
        await saveVideo(
          { ...v, id: next, project: { ...v.project, id: next } },
          frames,
        );
        t.id = next;
      }
      await write("projects", result.id, result);
      return result;
    }
    if (method === "DELETE") {
      await removeProject(id);
      return null;
    }
    if (method === "PUT") {
      const w = validateWorkspace({ ...objectValue(body), id });
      for (const t of w.tracks) {
        const v = await read<StoredVideo>("videos", t.id);
        if (t.last >= v.project.times.length) {
          throw new Error("Track interval outside video.");
        }
      }
      await read("projects", id);
      await updateProject(w);
      return w;
    }
    return read("projects", id);
  }
  if (kind === "projects") {
    if (!(id !== undefined && id !== "")) {
      return (await all<StoredVideo>("videos")).map((v) => ({
        id: v.id,
        name: v.project.name,
      }));
    }
    const v = await read<StoredVideo>("videos", id);
    const p = v.project;
    if (!(action !== undefined && action !== "")) {
      return p;
    }
    if (action === "measure") {
      return measure(p, body as MeasureOptions);
    }
    if (action === "track") {
      const project = await track(
        p,
        body as TrackOptions,
        (i) => grayFrame(id, i),
        (gray, template, rect) => matchPatch(gray, template, rect, progress),
        progress,
      );
      await write("videos", id, { ...v, project });
      return project;
    }
    if (action === "download") {
      if (format === "json") {
        return new Blob([JSON.stringify(p, null, 2)], {
          type: "application/json",
        });
      }
      if (format === "csv") {
        const columns = [
          "frame",
          "t",
          "x",
          "y",
          "width",
          "height",
          "score",
          "valid",
          "manual",
          "measuredWidth",
          "measuredHeight",
        ] as const;
        return new Blob(
          [
            `${columns.join(",")}\n${p.samples
              .map((s) => columns.map((c) => s[c] ?? "").join(","))
              .join("\n")}`,
          ],
          { type: "text/csv" },
        );
      }
    }
    if (action === "export") {
      if (format === "chart") {
        return chartSVG(p, objectValue(body).chart as Chart);
      }
      return renderExport(
        p,
        body as ExportOptions,
        format === "preview",
        progress,
      );
    }
  }
  throw new Error("Unsupported local operation.");
}
let queue = Promise.resolve();
globalThis.onmessage = (
  event: MessageEvent<ProcessingRequest | BitmapReply>,
) => {
  const m = event.data;
  if ("bitmapReply" in m) {
    receiveBitmap(m.bitmapReply, m.bitmap);
    return;
  }
  const previous = queue;
  queue = (async () => {
    try {
      await previous;
    } catch {}
    try {
      let last = 0;
      let label = "";
      const progress: ProgressReporter = (next, current, total) => {
        const now = performance.now();
        if (next === label && now - last < 100 && current !== total) {
          return;
        }
        last = now;
        label = next;
        postMessage({ id: m.id, progress: { label, current, total } });
      };
      const result = await route(m.path, m.method, m.body, progress);
      postMessage({ id: m.id, result });
    } catch (error) {
      postMessage({
        id: m.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};
