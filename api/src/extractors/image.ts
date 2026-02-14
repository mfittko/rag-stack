import type { IngestItem } from "../doctype.js";

export interface ImageMetadata {
  mimeType?: string;
  dimensions?: { width: number; height: number };
  [key: string]: unknown;
}

export function extractImage(item: IngestItem): ImageMetadata {
  const result: ImageMetadata = {};

  // Image metadata is caller-provided via item.metadata
  // The API receives text description, not binary image data
  if (item.metadata) {
    if (item.metadata.mimeType) {
      result.mimeType = String(item.metadata.mimeType);
    }
    if (item.metadata.width && item.metadata.height) {
      result.dimensions = {
        width: Number(item.metadata.width),
        height: Number(item.metadata.height),
      };
    }
  }

  return result;
}
