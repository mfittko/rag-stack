import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ingest } from "./ingest.js";
import type { IngestDeps, IngestRequest } from "./ingest.js";

// Mock the redis module
vi.mock("../redis.js", () => {
  const mockEnqueue = vi.fn(async () => {});
  const mockIsEnabled = vi.fn(() => false);
  return {
    enqueueEnrichment: mockEnqueue,
    isEnrichmentEnabled: mockIsEnabled,
    __mockEnqueue: mockEnqueue,
    __mockIsEnabled: mockIsEnabled,
  };
});

function makeDeps(overrides?: Partial<IngestDeps>): IngestDeps {
  return {
    embed: overrides?.embed ?? vi.fn(async (texts: string[]) =>
      texts.map(() => [0.1, 0.2, 0.3])
    ),
    ensureCollection: overrides?.ensureCollection ?? vi.fn(async () => {}),
    upsert: overrides?.upsert ?? vi.fn(async () => {}),
    collectionName: overrides?.collectionName ?? vi.fn((name?: string) => name || "docs"),
  };
}

describe("ingest service", () => {
  it("ensures the collection exists before upserting", async () => {
    const deps = makeDeps();
    const request: IngestRequest = {
      collection: "test-col",
      items: [{ text: "hello", source: "test.txt" }],
    };

    await ingest(request, deps);

    expect(deps.ensureCollection).toHaveBeenCalledWith("test-col");
  });

  it("uses default collection when none specified", async () => {
    const deps = makeDeps();
    const request: IngestRequest = {
      items: [{ text: "hello", source: "test.txt" }],
    };

    await ingest(request, deps);

    expect(deps.collectionName).toHaveBeenCalledWith(undefined);
  });

  it("chunks text and embeds each chunk", async () => {
    const embedMock = vi.fn(async (texts: string[]) =>
      texts.map(() => [0.1, 0.2, 0.3])
    );
    const deps = makeDeps({ embed: embedMock });
    const request: IngestRequest = {
      items: [{ text: "hello world", source: "test.txt" }],
    };

    await ingest(request, deps);

    // "hello world" is short, so it should be a single chunk
    expect(embedMock).toHaveBeenCalledWith(["hello world"]);
  });

  it("upserts points with correct structure", async () => {
    const upsertMock = vi.fn(async () => {});
    const deps = makeDeps({ upsert: upsertMock });
    const request: IngestRequest = {
      collection: "my-col",
      items: [
        {
          id: "doc-1",
          text: "hello world",
          source: "test.txt",
          metadata: { lang: "en" },
        },
      ],
    };

    await ingest(request, deps);

    const points = (upsertMock.mock.calls[0] as any)[1];
    expect(points).toBeDefined();
    expect(points[0].id).toBe("doc-1:0");
    expect(points[0].vector).toEqual([0.1, 0.2, 0.3]);
    // Check core fields are present
    expect(points[0].payload.text).toBe("hello world");
    expect(points[0].payload.source).toBe("test.txt");
    expect(points[0].payload.chunkIndex).toBe(0);
    expect(points[0].payload.lang).toBe("en");
    // Check new enrichment fields are present
    expect(points[0].payload.docType).toBeDefined();
    expect(points[0].payload.enrichmentStatus).toBeDefined();
    expect(points[0].payload.ingestedAt).toBeDefined();
    expect(points[0].payload.tier1Meta).toBeDefined();
  });

  it("generates UUID when item has no id", async () => {
    const upsertMock = vi.fn(async () => {});
    const deps = makeDeps({ upsert: upsertMock });
    const request: IngestRequest = {
      items: [{ text: "hello", source: "test.txt" }],
    };

    await ingest(request, deps);

    const points = (upsertMock.mock.calls[0] as any)[1];
    // Should have a UUID-like format: <uuid>:0
    expect(points).toBeDefined();
    expect(points[0].id).toMatch(/^.+:0$/);
    expect(points[0].id.length).toBeGreaterThan(3);
  });

  it("returns the count of upserted points", async () => {
    const deps = makeDeps();
    const request: IngestRequest = {
      items: [
        { text: "item one", source: "a.txt" },
        { text: "item two", source: "b.txt" },
      ],
    };

    const result = await ingest(request, deps);

    expect(result).toEqual({ ok: true, upserted: 2 });
  });

  it("handles multiple items with multiple chunks each", async () => {
    const embedMock = vi.fn(async (texts: string[]) =>
      texts.map(() => [0.1, 0.2, 0.3])
    );
    const upsertMock = vi.fn(async () => {});
    const deps = makeDeps({ embed: embedMock, upsert: upsertMock });

    // Create text long enough to produce 2 chunks
    const longText = Array.from({ length: 30 }, (_, i) =>
      `Line ${i}: ${"x".repeat(80)}`
    ).join("\n");

    const request: IngestRequest = {
      items: [
        { id: "doc-a", text: longText, source: "a.txt" },
        { id: "doc-b", text: "short", source: "b.txt" },
      ],
    };

    const result = await ingest(request, deps);

    // doc-a should produce multiple chunks, doc-b should produce 1
    expect(result.upserted).toBeGreaterThan(2);

    const points = (upsertMock.mock.calls[0] as any)[1];
    expect(points).toBeDefined();
    // Verify chunk indices are sequential per document
    const docAPoints = points.filter((p: { id: string }) => p.id.startsWith("doc-a:"));
    for (let i = 0; i < docAPoints.length; i++) {
      expect(docAPoints[i].id).toBe(`doc-a:${i}`);
    }
  });

  it("spreads item metadata into point payload", async () => {
    const upsertMock = vi.fn(async () => {});
    const deps = makeDeps({ upsert: upsertMock });
    const request: IngestRequest = {
      items: [
        {
          id: "doc-1",
          text: "hello",
          source: "test.txt",
          metadata: { repoId: "my-repo", path: "src/test.txt", lang: "ts", bytes: 100 },
        },
      ],
    };

    await ingest(request, deps);

    const points = (upsertMock.mock.calls[0] as any)[1];
    expect(points).toBeDefined();
    // Check metadata is spread into payload
    expect(points[0].payload.repoId).toBe("my-repo");
    expect(points[0].payload.path).toBe("src/test.txt");
    expect(points[0].payload.lang).toBe("ts");
    expect(points[0].payload.bytes).toBe(100);
    expect(points[0].payload.text).toBe("hello");
    expect(points[0].payload.source).toBe("test.txt");
    expect(points[0].payload.chunkIndex).toBe(0);
    // New enrichment fields should also be present
    expect(points[0].payload.docType).toBeDefined();
    expect(points[0].payload.enrichmentStatus).toBeDefined();
    expect(points[0].payload.ingestedAt).toBeDefined();
    expect(points[0].payload.tier1Meta).toBeDefined();
  });

  it("enqueues enrichment tasks when enrichment is enabled", async () => {
    // Setup mocks
    const redis = await import("../redis.js");
    const mockEnqueue = (redis as any).__mockEnqueue;
    const mockIsEnabled = (redis as any).__mockIsEnabled;
    
    // Reset and configure mocks
    mockEnqueue.mockClear();
    mockIsEnabled.mockReturnValue(true);

    const upsertMock = vi.fn(async () => {});
    const deps = makeDeps({ upsert: upsertMock });
    const request: IngestRequest = {
      items: [
        { id: "doc-1", text: "hello world", source: "test.ts", docType: "code" },
        { id: "doc-2", text: "short", source: "note.txt", docType: "text" },
      ],
    };

    const result = await ingest(request, deps);

    // Verify enrichment response structure
    expect(result.enrichment).toBeDefined();
    expect(result.enrichment?.enqueued).toBe(2);
    expect(result.enrichment?.docTypes).toEqual({ code: 1, text: 1 });

    // Verify tasks were enqueued
    expect(mockEnqueue).toHaveBeenCalledTimes(2);

    // Verify enrichmentStatus in payload
    const points = (upsertMock.mock.calls[0] as any)[1];
    expect(points[0].payload.enrichmentStatus).toBe("pending");
    expect(points[1].payload.enrichmentStatus).toBe("pending");

    // Clean up
    mockIsEnabled.mockReturnValue(false);
  });

  it("skips enrichment when disabled", async () => {
    const redis = await import("../redis.js");
    const mockEnqueue = (redis as any).__mockEnqueue;
    const mockIsEnabled = (redis as any).__mockIsEnabled;
    
    mockEnqueue.mockClear();
    mockIsEnabled.mockReturnValue(false);

    const deps = makeDeps();
    const request: IngestRequest = {
      items: [{ text: "hello", source: "test.txt" }],
    };

    const result = await ingest(request, deps);

    // No enrichment response when disabled
    expect(result.enrichment).toBeUndefined();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
