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
