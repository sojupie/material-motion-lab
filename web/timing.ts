export function nearest(times: number[], time: number) {
  let best = 0;
  for (let i = 1; i < times.length; i++)
    if (Math.abs(times[i] - time) < Math.abs(times[best] - time)) best = i;
  return best;
}
export function milliseconds(token: string) {
  const text = token.trim();
  if (!/^(?:\d*\.)?\d+(?:ms|s)$/.test(text))
    throw Error("Duration token must use ms or s.");
  return parseFloat(text) * (text.endsWith("ms") ? 1 : 1000);
}
export function sourceFrame(times: number[], offset: number, playhead: number) {
  return nearest(times, playhead - offset);
}
export function alignedOffset(aTime: number, aOffset: number, bTime: number) {
  return aTime + aOffset - bTime;
}
export function clampRange(
  first: number,
  last: number,
  count: number,
): [number, number] {
  const a = Math.max(0, Math.min(count - 1, Math.round(first)));
  return [a, Math.max(a, Math.min(count - 1, Math.round(last)))];
}
