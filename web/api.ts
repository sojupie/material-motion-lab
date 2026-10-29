import { localRequest } from "./local-client";

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`#${CSS.escape(id)}`);
  if (!element) {
    throw new Error(`Missing workspace element: ${id}`);
  }
  return element;
}
export function api<T>(path: string, options?: RequestInit): Promise<T> {
  return localRequest<T>(path, options);
}
export function post<T>(path: string, data: unknown) {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
