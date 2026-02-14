import type { IngestItem } from "../doctype.js";

export interface PdfMetadata {
  title?: string;
  author?: string;
  pageCount?: number;
  createdDate?: string;
  [key: string]: unknown;
}

export function extractPdf(item: IngestItem): PdfMetadata {
  const result: PdfMetadata = {};

  // PDF metadata is caller-provided via item.metadata
  // The API receives text, not binary PDF
  if (item.metadata) {
    if (item.metadata.title) {
      result.title = String(item.metadata.title);
    }
    if (item.metadata.author) {
      result.author = String(item.metadata.author);
    }
    if (item.metadata.pageCount) {
      result.pageCount = Number(item.metadata.pageCount);
    }
    if (item.metadata.createdDate) {
      result.createdDate = String(item.metadata.createdDate);
    }
  }

  return result;
}
