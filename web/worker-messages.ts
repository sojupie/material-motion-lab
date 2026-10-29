import type { ProcessingProgress } from "./processing-progress";

export interface ProcessingRequest {
  id: number;
  path: string;
  method: string;
  body: unknown;
}
export interface BitmapReply {
  bitmapReply: number;
  bitmap: ImageBitmap;
}
export type ProcessingReply =
  | { id: number; progress: ProcessingProgress }
  | { bitmapRequest: number; blob: Blob }
  | { id: number; result: unknown; error?: never }
  | { id: number; error: string; result?: never };
