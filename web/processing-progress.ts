export type ProgressReporter = (
  label: string,
  current?: number,
  total?: number,
) => void;
export interface ProcessingProgress {
  label: string;
  current?: number;
  total?: number;
}

export function progressPercent(p: ProcessingProgress): number | null {
  if (
    !Number.isFinite(p.current) ||
    !Number.isFinite(p.total) ||
    p.total! <= 0
  ) {
    return null;
  }
  return Math.round(Math.max(0, Math.min(1, p.current! / p.total!)) * 100);
}
