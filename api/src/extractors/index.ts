import type { DocType, IngestItem } from "../doctype.js";
import { extractCode } from "./code.js";
import { extractEmail } from "./email.js";
import { extractSlack } from "./slack.js";
import { extractMeeting } from "./meeting.js";
import { extractArticle } from "./article.js";
import { extractPdf } from "./pdf.js";
import { extractImage } from "./image.js";

export function extractTier1(
  item: IngestItem,
  docType: DocType,
): Record<string, unknown> {
  switch (docType) {
    case "code":
      return extractCode(item);
    case "email":
      return extractEmail(item);
    case "slack":
      return extractSlack(item);
    case "image":
      return extractImage(item);
    case "meeting":
      return extractMeeting(item);
    case "article":
      return extractArticle(item);
    case "pdf":
      return extractPdf(item);
    case "text":
    default:
      return {};
  }
}

export * from "./code.js";
export * from "./email.js";
export * from "./slack.js";
export * from "./meeting.js";
export * from "./article.js";
export * from "./pdf.js";
export * from "./image.js";
