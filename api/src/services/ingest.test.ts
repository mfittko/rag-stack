import { describe, it, expect, vi, beforeEach } from "vitest";
import { ingest } from "./ingest.js";
import type { IngestRequest } from "./ingest.js";

// Mock the db module to avoid Postgres connection in tests
vi.mock("../db.js", () => ({
  query: vi.fn(async () => ({ rows: [] })),
  getPool: vi.fn(() => ({
    connect: vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [{ id: "test-doc-id" }] })),
      release: vi.fn(),
    })),
  })),
  runMigrations: vi.fn(),
  closePool: vi.fn(),
}));

// Mock ollama module
vi.mock("../ollama.js", () => ({
  embed: vi.fn(async (texts: string[]) =>
    texts.map(() => Array(768).fill(0.1))
  ),
}));

// Mock url-fetch and url-extract modules
vi.mock("./url-fetch.js", () => ({
  fetchUrls: vi.fn(async () => ({ results: new Map(), errors: [] })),
}));

vi.mock("./url-extract.js", () => ({
  extractContentAsync: vi.fn(async () => ({ text: "", strategy: "passthrough" })),
}));

describe("ingest service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ingests text items successfully", async () => {
    const request: IngestRequest = {
      collection: "test-col",
      items: [{ text: "hello world", source: "test.txt" }],
    };

    const result = await ingest(request, "test-col");

    expect(result.ok).toBe(true);
    expect(result.upserted).toBeGreaterThan(0);
  });

  it("uses default collection when none specified", async () => {
    const request: IngestRequest = {
      items: [{ text: "hello", source: "test.txt" }],
    };

    const result = await ingest(request);

    expect(result.ok).toBe(true);
  });

  it("returns the count of upserted chunks", async () => {
    const request: IngestRequest = {
      items: [
        { text: "item one", source: "a.txt" },
        { text: "item two", source: "b.txt" },
      ],
    };

    const result = await ingest(request);

    expect(result.ok).toBe(true);
    expect(result.upserted).toBe(2); // 2 items = 2 chunks
  });

  it("handles items with metadata", async () => {
    const request: IngestRequest = {
      items: [
        {
          text: "hello world",
          source: "test.txt",
          metadata: { lang: "en", author: "test" },
        },
      ],
    };

    const result = await ingest(request);

    expect(result.ok).toBe(true);
  });

  it("auto-derives source from URL when missing", async () => {
    const request: IngestRequest = {
      items: [
        {
          text: "hello",
          url: "https://example.com/path?query=1",
        },
      ],
    };

    const result = await ingest(request);

    expect(result.ok).toBe(true);
  });

  it("reports errors for items with missing text", async () => {
    const request: IngestRequest = {
      items: [
        { source: "test.txt" } as any, // Missing text
      ],
    };

    const result = await ingest(request);

    expect(result.ok).toBe(true);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("reports errors for items with missing source", async () => {
    const request: IngestRequest = {
      items: [
        { text: "hello" } as any, // Missing source
      ],
    };

    const result = await ingest(request);

    expect(result.ok).toBe(true);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});
