import type { Gray } from "./local-analysis";
import type { ProgressReporter } from "./processing-progress";

let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<
  number,
  { resolve: (r: PatchMatch) => void; reject: (e: Error) => void }
>();
export interface PatchMatch {
  x: number;
  y: number;
  score: number;
  dx: number;
  dy: number;
}
export function matchPatch(
  gray: Gray,
  template: Gray,
  rect: number[],
  progress: ProgressReporter = () => {},
): Promise<PatchMatch> {
  if (!worker) {
    progress("Loading tracking engine…");
    const workerURL = new URL(
      /* @vite-ignore */ "../opencv/worker.js",
      import.meta.url,
    );
    worker = new Worker(workerURL);
    worker.onmessage = ({
      data,
    }: MessageEvent<{ id: number; error?: string; result: PatchMatch }>) => {
      const p = pending.get(data.id);
      if (p) {
        pending.delete(data.id);
        if (data.error === undefined) {
          p.resolve(data.result);
        } else {
          p.reject(new Error(data.error));
        }
      }
    };
    worker.onerror = () => {
      for (const p of pending.values()) {
        p.reject(new Error("On-device patch tracker failed to load."));
      }
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, gray, template, rect });
  });
}
