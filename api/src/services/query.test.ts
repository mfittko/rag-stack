import { describe, it, expect, vi } from "vitest";
import { query } from "./query.js";
import type { QueryDeps, QueryRequest } from "./query.js";

function makeDeps(overrides?: Partial<QueryDeps>): QueryDeps {
  return {
    embed: overrides?.embed ?? vi.fn(async (texts: string[]) =>
      texts.map(() => [0.1, 0.2, 0.3])
    ),
    ensureCollection: overrides?.ensureCollection ?? vi.fn(async () => {}),
    search: overrides?.search ?? vi.fn(async () => []),
    collectionName: overrides?.collectionName ?? vi.fn((name?: string) => name || "docs"),
  };
}

describe("query service", () => {
  it("ensures the collection exists before searching", async () => {
    const deps = makeDeps();
    const request: QueryRequest = {
      collection: "test-col",
      query: "hello",
    };

    await query(request, deps);

    expect(deps.ensureCollection).toHaveBeenCalledWith("test-col");
  });

  it("uses default collection when none specified", async () => {
    const deps = makeDeps();
    const request: QueryRequest = {
      query: "hello",
    };

    await query(request, deps);

    expect(deps.collectionName).toHaveBeenCalledWith(undefined);
  });

  it("embeds the query text", async () => {
    const embedMock = vi.fn(async (texts: string[]) =>
      texts.map(() => [0.1, 0.2, 0.3])
    );
    const deps = makeDeps({ embed: embedMock });
    const request: QueryRequest = {
      query: "what is this?",
    };

    await query(request, deps);

    expect(embedMock).toHaveBeenCalledWith(["what is this?"]);
  });

  it("uses default topK of 8 when not specified", async () => {
    const searchMock = vi.fn(async () => []);
    const deps = makeDeps({ search: searchMock });
    const request: QueryRequest = {
      query: "hello",
    };

    await query(request, deps);

    // searchMock called with (collection, vector, limit, filter)
    expect(searchMock.mock.calls[0][2]).toBe(8);
  });

  it("uses custom topK when specified", async () => {
    const searchMock = vi.fn(async () => []);
    const deps = makeDeps({ search: searchMock });
    const request: QueryRequest = {
      query: "hello",
      topK: 5,
    };

    await query(request, deps);

    expect(searchMock.mock.calls[0][2]).toBe(5);
  });

  it("passes filter to search", async () => {
    const searchMock = vi.fn(async () => []);
    const deps = makeDeps({ search: searchMock });
    const filter = { lang: "en" };
    const request: QueryRequest = {
      query: "hello",
      filter,
    };

    await query(request, deps);

    expect(searchMock.mock.calls[0][3]).toBe(filter);
  });

  it("returns results with correct structure", async () => {
    const searchMock = vi.fn(async () => [
      {
        id: "doc-1:0",
        score: 0.95,
        payload: { text: "hello world", source: "test.txt", chunkIndex: 0 },
      },
      {
        id: "doc-2:0",
        score: 0.85,
        payload: { text: "hello there", source: "other.txt", chunkIndex: 0 },
      },
    ]);
    const deps = makeDeps({ search: searchMock });
    const request: QueryRequest = {
      query: "hello",
    };

    const result = await query(request, deps);

    expect(result).toEqual({
      ok: true,
      results: [
        {
          id: "doc-1:0",
          score: 0.95,
          source: "test.txt",
          text: "hello world",
          payload: { text: "hello world", source: "test.txt", chunkIndex: 0 },
        },
        {
          id: "doc-2:0",
          score: 0.85,
          source: "other.txt",
          text: "hello there",
          payload: { text: "hello there", source: "other.txt", chunkIndex: 0 },
        },
      ],
    });
  });

  it("returns empty results when search finds nothing", async () => {
    const deps = makeDeps({ search: vi.fn(async () => []) });
    const request: QueryRequest = {
      query: "nonexistent",
    };

    const result = await query(request, deps);

    expect(result).toEqual({
      ok: true,
      results: [],
    });
  });

  it("handles search results without source or text in payload", async () => {
    const searchMock = vi.fn(async () => [
      {
        id: "doc-1:0",
        score: 0.95,
        payload: { someOtherField: "value" },
      },
    ]);
    const deps = makeDeps({ search: searchMock });
    const request: QueryRequest = {
      query: "hello",
    };

    const result = await query(request, deps);

    expect(result.results[0]).toEqual({
      id: "doc-1:0",
      score: 0.95,
      source: undefined,
      text: undefined,
      payload: { someOtherField: "value" },
    });
  });
});
