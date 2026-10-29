import type { Project,Workspace } from "./types";

export interface StoredVideo {
  id: string;
  project: Project;
  source: Blob;
  extension: string;
}
let database: Promise<IDBDatabase> | undefined;
export function db() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("motion-tracker", 1);
    request.onupgradeneeded = () => {
      for (const name of ["projects", "videos", "frames"]) {
        request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      database = undefined;
      reject(request.error ?? new Error("Browser storage operation failed."));
    };
  }));
}
export async function read<T>(store: string, key: IDBValidKey): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => {
      const value: unknown = r.result;
      if (value === undefined) {
        reject(new Error("This local project is no longer available."));
      } else {
        resolve(value as T);
      }
    };
    r.onerror = () => {
      reject(r.error ?? new Error("Browser storage operation failed."));
    };
  });
}
export async function all<T>(store: string): Promise<T[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => {
      resolve(r.result as T[]);
    };
    r.onerror = () => {
      reject(r.error ?? new Error("Browser storage operation failed."));
    };
  });
}
export async function write(store: string, key: IDBValidKey, value: unknown) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction(store, "readwrite");
    t.objectStore(store).put(value, key);
    t.oncomplete = () => {
      resolve();
    };
    t.onerror = () => {
      reject(t.error ?? new Error("Browser storage operation failed."));
    };
    t.onabort = () => {
      reject(t.error ?? new Error("Local storage write was aborted."));
    };
  });
}
export async function saveVideo(video: StoredVideo, frames: Blob[]) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction(["videos", "frames"], "readwrite");
    t.objectStore("videos").put(video, video.id);
    frames.forEach((b, i) => {
      t.objectStore("frames").put(b, [video.id, i]);
    });
    t.oncomplete = () => {
      resolve();
    };
    t.onabort = () => {
      reject(t.error ?? new Error("Not enough browser storage."));
    };
    t.onerror = () => {
      reject(t.error ?? new Error("Browser storage operation failed."));
    };
  });
}
// Project mutation and media reference checks share one transaction across tabs.
async function changeProject(id: string, replacement: Workspace | null) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction(["projects", "videos", "frames"], "readwrite");
    const store = t.objectStore("projects");
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = request.result as Workspace[];
      const previous = entries.find((p) => p.id === id);
      const remaining = entries.filter((p) => p.id !== id);
      if (replacement) {
        store.put(replacement, id);
        remaining.push(replacement);
      } else {
        store.delete(id);
      }
      for (const track of previous?.tracks ?? []) {
        if (remaining.some((p) => p.tracks.some((v) => v.id === track.id))) {
          continue;
        }
        t.objectStore("videos").delete(track.id);
        const cursor = t
          .objectStore("frames")
          .openKeyCursor(
            IDBKeyRange.bound(
              [track.id, 0],
              [track.id, Number.MAX_SAFE_INTEGER],
            ),
          );
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (row) {
            t.objectStore("frames").delete(row.primaryKey);
            row.continue();
          }
        };
      }
    };
    t.oncomplete = () => {
      resolve();
    };
    t.onabort = () => {
      reject(t.error ?? new Error("Browser storage operation failed."));
    };
    t.onerror = () => {
      reject(t.error ?? new Error("Browser storage operation failed."));
    };
  });
}
export function removeProject(id: string) {
  return changeProject(id, null);
}
export function updateProject(project: Workspace) {
  return changeProject(project.id, project);
}
