import { parseJSON } from "./json";
import { read } from "./local-store";
import type { ProcessingProgress } from "./processing-progress";
import type { ProcessingReply } from "./worker-messages";

const progressListeners = new Set<
  (progress: ProcessingProgress, path: string) => void
>();
export function onProcessingProgress(
  listener: (progress: ProcessingProgress, path: string) => void,
) {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}
let worker: Worker | undefined;
let id = 0;
const pending = new Map<
  number,
  { path: string; resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
export function localRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL("local-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onerror = () => {
      for (const p of pending.values()) {
        p.reject(
          new Error(
            "On-device processing stopped. Reload the app and reopen your local project.",
          ),
        );
      }
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
    worker.onmessage = async (e: MessageEvent<ProcessingReply>) => {
      const m = e.data;
      if ("progress" in m) {
        const request = pending.get(m.id);
        if (request) {
          for (const listener of progressListeners) {
            listener(m.progress, request.path);
          }
        }
        return;
      }
      if ("bitmapRequest" in m) {
        try {
          const url = URL.createObjectURL(m.blob);
          try {
            const image = new Image();
            await new Promise<void>((resolve, reject) => {
              image.onload = () => {
                resolve();
              };
              image.onerror = () => {
                reject(new Error("Chart rasterization failed."));
              };
              image.src = url;
            });
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            canvas.getContext("2d")!.drawImage(image, 0, 0);
            const bitmap = await createImageBitmap(canvas);
            worker!.postMessage({ bitmapReply: m.bitmapRequest, bitmap }, [
              bitmap,
            ]);
          } finally {
            URL.revokeObjectURL(url);
          }
        } catch {
          worker?.terminate();
          worker = undefined;
          for (const p of pending.values()) {
            p.reject(new Error("Chart rendering failed."));
          }
          pending.clear();
        }
        return;
      }
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        if (typeof m.error === "string") {
          p.reject(new Error(m.error));
        } else {
          p.resolve(m.result);
        }
      }
    };
  }
  const requestID = ++id;
  const body =
    typeof options?.body === "string"
      ? parseJSON(options.body)
      : options?.body instanceof FormData
        ? Object.fromEntries(options.body.entries())
        : options?.body;
  return new Promise((resolve, reject) => {
    pending.set(requestID, {
      path,
      resolve: (value) => {
        resolve(value as T);
      },
      reject,
    });
    worker!.postMessage({
      id: requestID,
      path,
      method: options?.method ?? "GET",
      body,
    });
  });
}
export async function localFetch(path: string, options?: RequestInit) {
  try {
    const result = await localRequest<unknown>(path, options);
    return result instanceof Blob
      ? new Response(result)
      : Response.json(result);
  } catch (error) {
    return Response.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
export function localFrame(id: string, i: number) {
  return read<Blob>("frames", [id, i]);
}

export function cancelProcessing() {
  worker?.terminate();
  worker = undefined;
  for (const p of pending.values()) {
    p.reject(
      new Error("Processing cancelled. Completed local saves are kept."),
    );
  }
  pending.clear();
}
