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

// Playback uses the continuous clock; display and user seeks use recorded frames.
export function playbackPosition(
  start: number,
  elapsed: number,
  speed: number,
  range: [number, number],
  loop: boolean,
  endHold: number,
) {
  const [first, last] = range,
    duration = last - first;
  if (duration <= 0) return { time: first, done: true };
  const position = start - first + Math.max(0, elapsed) * speed;
  if (!loop)
    return {
      time: Math.min(last, first + position),
      done: position >= duration,
    };
  const cycle = duration + endHold;
  return { time: first + Math.min(duration, position % cycle), done: false };
}
export function snapTime(times: number[], offset: number, time: number) {
  return times[sourceFrame(times, offset, time)] + offset;
}

export function workspaceFrame(
  tracks: { times: number[]; offset: number }[],
  selected: number,
  time: number,
  range?: [number, number],
) {
  const candidates = tracks.map((track) =>
    track.times
      .map((t) => t + track.offset)
      .filter((t) => !range || (t >= range[0] && t <= range[1])),
  );
  const preferred = candidates[selected] || [];
  const times =
    preferred.length && time >= preferred[0] && time <= preferred.at(-1)!
      ? preferred
      : candidates.flat().sort((a, b) => a - b);
  return times.length ? times[nearest(times, time)] : time;
}
