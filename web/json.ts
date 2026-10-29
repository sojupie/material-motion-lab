export function parseJSON(text: string): unknown {
  return JSON.parse(text) as unknown;
}
export function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object.");
  }
  return value as Record<string, unknown>;
}
export async function responseError(
  response: Response,
  fallback: string,
): Promise<string> {
  const value: unknown = await response.json();
  if (
    typeof value === "object" &&
    value !== null &&
    "detail" in value &&
    typeof value.detail === "string"
  ) {
    return value.detail;
  }
  return fallback;
}
