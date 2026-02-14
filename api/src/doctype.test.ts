import { describe, it, expect } from "vitest";
import { detectDocType, type IngestItem } from "./doctype.js";

describe("detectDocType", () => {
  it("should use explicit docType when provided", () => {
    const item: IngestItem = {
      text: "some content",
      source: "test.txt",
      docType: "slack",
    };
    expect(detectDocType(item)).toBe("slack");
  });

  it("should detect slack from metadata channel field", () => {
    const item: IngestItem = {
      text: "message content",
      source: "export.json",
      metadata: { channel: "general" },
    };
    expect(detectDocType(item)).toBe("slack");
  });

  it("should detect email from metadata from and subject fields", () => {
    const item: IngestItem = {
      text: "email content",
      source: "message.eml",
      metadata: { from: "user@example.com", subject: "Test" },
    };
    expect(detectDocType(item)).toBe("email");
  });

  it("should detect code from github.com source URL", () => {
    const item: IngestItem = {
      text: "function test() {}",
      source: "https://github.com/user/repo/file.ts",
    };
    expect(detectDocType(item)).toBe("code");
  });

  it("should detect slack from slack.com source URL", () => {
    const item: IngestItem = {
      text: "message",
      source: "https://slack.com/archives/C123/p456",
    };
    expect(detectDocType(item)).toBe("slack");
  });

  it("should detect email from RFC 2822 headers in content", () => {
    const item: IngestItem = {
      text: "From: sender@example.com\nSubject: Test\n\nBody",
      source: "message.txt",
    };
    expect(detectDocType(item)).toBe("email");
  });

  it("should detect slack from JSON messages structure", () => {
    const item: IngestItem = {
      text: '{"messages": [{"user": "U123", "text": "hello"}]}',
      source: "export.json",
    };
    expect(detectDocType(item)).toBe("slack");
  });

  it("should detect code from .py extension", () => {
    const item: IngestItem = {
      text: "def hello(): pass",
      source: "script.py",
    };
    expect(detectDocType(item)).toBe("code");
  });

  it("should detect code from .ts extension", () => {
    const item: IngestItem = {
      text: "const x = 1;",
      source: "module.ts",
    };
    expect(detectDocType(item)).toBe("code");
  });

  it("should detect pdf from .pdf extension", () => {
    const item: IngestItem = {
      text: "document content",
      source: "report.pdf",
    };
    expect(detectDocType(item)).toBe("pdf");
  });

  it("should detect image from .png extension", () => {
    const item: IngestItem = {
      text: "image data",
      source: "screenshot.png",
    };
    expect(detectDocType(item)).toBe("image");
  });

  it("should detect image from .jpg extension", () => {
    const item: IngestItem = {
      text: "photo data",
      source: "photo.jpg",
    };
    expect(detectDocType(item)).toBe("image");
  });

  it("should detect article from .md extension", () => {
    const item: IngestItem = {
      text: "# Article Title\n\nContent",
      source: "blog-post.md",
    };
    expect(detectDocType(item)).toBe("article");
  });

  it("should detect article from .html extension", () => {
    const item: IngestItem = {
      text: "<html><body>Article</body></html>",
      source: "page.html",
    };
    expect(detectDocType(item)).toBe("article");
  });

  it("should fallback to text for unknown types", () => {
    const item: IngestItem = {
      text: "generic content",
      source: "unknown.xyz",
    };
    expect(detectDocType(item)).toBe("text");
  });

  it("should detect meeting from content patterns", () => {
    const item: IngestItem = {
      text: "Meeting Date: 2024-01-15\nAttendees: Alice, Bob\nDuration: 1hr",
      source: "standup.txt",
    };
    expect(detectDocType(item)).toBe("meeting");
  });
});
