// Recent views belong to this browser, independently of server file modification times.
export function recentProjectIDs(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) {
      return [];
    }
    return [
      ...new Set(value.filter((id): id is string => typeof id === "string")),
    ].slice(0, 12);
  } catch {
    return [];
  }
}
export function rememberProject(ids: string[], id: string): string[] {
  return [id, ...ids.filter((existing) => existing !== id)].slice(0, 12);
}
