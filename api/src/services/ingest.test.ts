import { describe, it, expect, vi } from "vitest";
import { ingest } from "./ingest.js";
import type { IngestDeps, IngestRequest } from "./ingest.js";

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

    expect(upsertMock).toHaveBeenCalledWith("my-col", [
      {
        id: "doc-1:0",
        vector: [0.1, 0.2, 0.3],
        payload: {
          text: "hello world",
          source: "test.txt",
          chunkIndex: 0,
          lang: "en",
        },
      },
    ]);
  });

  it("generates UUID when item has no id", async () => {
    const upsertMock = vi.fn(async () => {});
    const deps = makeDeps({ upsert: upsertMock });
    const request: IngestRequest = {
      items: [{ text: "hello", source: "test.txt" }],
    };

    await ingest(request, deps);

    const points = upsertMock.mock.calls[0][1];
    // Should have a UUID-like format: <uuid>:0
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

    const points = upsertMock.mock.calls[0][1];
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

    const points = upsertMock.mock.calls[0][1];
    expect(points[0].payload).toEqual({
      text: "hello",
      source: "test.txt",
      chunkIndex: 0,
      repoId: "my-repo",
      path: "src/test.txt",
      lang: "ts",
      bytes: 100,
    });
  });
});
