export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export async function reportFailure(
  task: Promise<unknown>,
  report: (message: string) => void,
): Promise<void> {
  try {
    await task;
  } catch (error: unknown) {
    report(errorMessage(error));
  }
}
export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) {
    throw new Error("The project contains missing or incomplete data.");
  }
  return value;
}
