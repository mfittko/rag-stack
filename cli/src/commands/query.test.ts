import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import path from "node:path";
import { cmdQuery, resolveTemporalShorthand, parseFilterField } from "./query.js";

describe("query command", () => {
  let fetchMock: typeof globalThis.fetch;
  
  beforeEach(() => {
    fetchMock = globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = fetchMock;
  });

  it("should query the API with correct parameters", async () => {
    const mockResults = {
      results: [
        { text: "sample text", score: 0.95, source: "test.md" },
      ],
    };

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe("http://localhost:8080/query");
      expect(init?.method).toBe("POST");
      
      const body = JSON.parse(init?.body as string);
      expect(body.collection).toBe("docs");
      expect(body.query).toBe("test query");
      expect(body.topK).toBe(8);
      expect(body.minScore).toBe(0.4);
      
      return new Response(JSON.stringify(mockResults), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({
      q: "test query",
      api: "http://localhost:8080",
      collection: "docs",
    });

  });

  it("should handle query with filters", async () => {
    const mockResults = { results: [] };

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.filter).toBeDefined();
      expect(body.filter.repoId).toBe("my-repo");
      expect(body.filter.path).toBe("src/");
      expect(body.filter.lang).toBe("ts");
      
      return new Response(JSON.stringify(mockResults), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({
      q: "test",
      repoId: "my-repo",
      pathPrefix: "src/",
      lang: "ts",
    });

  });

  it("should send DSL filter when --since is provided", async () => {
    let sentFilter: Record<string, unknown> | undefined;

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      sentFilter = body.filter;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "test", since: "2025-01-01T00:00:00Z" });

    expect(sentFilter).toBeDefined();
    expect((sentFilter as { conditions: unknown[] }).conditions).toHaveLength(1);
    const cond = (sentFilter as { conditions: Array<Record<string, unknown>> }).conditions[0];
    expect(cond.field).toBe("ingestedAt");
    expect(cond.op).toBe("gte");
    expect(cond.value).toBe("2025-01-01T00:00:00Z");
    expect(cond.alias).toBe("d");
  });

  it("should send DSL filter with both --since and --until", async () => {
    let sentFilter: Record<string, unknown> | undefined;

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      sentFilter = body.filter;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "test", since: "2025-01-01T00:00:00Z", until: "2025-12-31T23:59:59Z" });

    expect((sentFilter as { conditions: unknown[] }).conditions).toHaveLength(2);
  });

  it("should send DSL filter from --filterField", async () => {
    let sentFilter: Record<string, unknown> | undefined;

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      sentFilter = body.filter;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "test", filterField: ["docType:eq:code"] });

    expect(sentFilter).toBeDefined();
    const cond = (sentFilter as { conditions: Array<Record<string, unknown>> }).conditions[0];
    expect(cond.field).toBe("docType");
    expect(cond.op).toBe("eq");
    expect(cond.value).toBe("code");
  });

  it("should use filterCombine to set combine key", async () => {
    let sentFilter: Record<string, unknown> | undefined;

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      sentFilter = body.filter;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "test", filterField: ["docType:eq:code", "lang:eq:ts"], filterCombine: "or" });

    expect((sentFilter as { combine: string }).combine).toBe("or");
  });

  it("should pass custom minScore", async () => {
    const mockResults = { results: [] };

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.minScore).toBe(0.8);

      return new Response(JSON.stringify(mockResults), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "test", minScore: "0.8" });

  });

  it("should query multiple collections when --collections is provided", async () => {
    const calls: string[] = [];

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      calls.push(body.collection);

      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "invoice", collections: "docs,downloads-pdf" });
    expect(calls).toEqual(["docs", "downloads-pdf"]);
  });

  it("should deduplicate merged results by payload checksum when --unique is set", async () => {
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);

      if (body.collection === "docs") {
        return new Response(JSON.stringify({
          results: [
            { text: "doc copy", score: 0.91, source: "docs/a.pdf", payload: { payloadChecksum: "same-checksum" } },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        results: [
          { text: "pdf copy", score: 0.89, source: "downloads/a.pdf", payload: { payloadChecksum: "same-checksum" } },
          { text: "unique", score: 0.88, source: "downloads/b.pdf", payload: { payloadChecksum: "unique-checksum" } },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await cmdQuery({ q: "invoice", collections: "docs,downloads-pdf", unique: true, topK: "10" });

    const output = infoSpy.mock.calls.map((args) => String(args[0] ?? ""));
    const sourceLines = output.filter((line) => line.startsWith("source:"));
    expect(sourceLines).toContain("source: docs/a.pdf");
    expect(sourceLines).toContain("source: downloads/b.pdf");
    expect(sourceLines).not.toContain("source: downloads/a.pdf");
    expect(output).toContain("Deduplicated 1 result(s) by payload checksum.");
  });

  it("should keep duplicates when --unique is not set", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        results: [
          { text: "copy1", score: 0.9, source: "one.pdf", payload: { payloadChecksum: "same-checksum" } },
          { text: "copy2", score: 0.89, source: "two.pdf", payload: { payloadChecksum: "same-checksum" } },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await cmdQuery({ q: "invoice", topK: "10" });

    const output = infoSpy.mock.calls.map((args) => String(args[0] ?? ""));
    const sourceLines = output.filter((line) => line.startsWith("source:"));
    expect(sourceLines).toContain("source: one.pdf");
    expect(sourceLines).toContain("source: two.pdf");
    expect(output).not.toContain("Deduplicated 1 result(s) by payload checksum.");
  });

  it("should use auto minScore 0.3 for single-term query", async () => {
    const mockResults = { results: [] };

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.minScore).toBe(0.3);

      return new Response(JSON.stringify(mockResults), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "INV89909018" });
  });

  it("should use auto minScore 0.6 for five-term query", async () => {
    const mockResults = { results: [] };

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.minScore).toBe(0.6);

      return new Response(JSON.stringify(mockResults), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "Github invoice INV89909018 copilot pro" });
  });

  it("should accept positional query text", async () => {
    const mockResults = { results: [] };

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.query).toBe("invoice INV89909018");

      return new Response(JSON.stringify(mockResults), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ positionalQuery: "invoice INV89909018" });
  });

  it("should prefer --q over positional query text", async () => {
    const mockResults = { results: [] };

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.query).toBe("from-flag");

      return new Response(JSON.stringify(mockResults), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "from-flag", positionalQuery: "from-positional" });
  });

  it("should exit with error when query is missing", async () => {
    const exitSpy = process.exit;
    let exitCode = 0;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("exit");
    }) as never;

    try {
      await cmdQuery({});
    } catch (e) {
      // Expected to throw
    }

    expect(exitCode).toBe(2);
    process.exit = exitSpy;
  });

  it("should handle API errors", async () => {
    globalThis.fetch = async () => {
      return new Response("Internal Server Error", { status: 500 });
    };

    await expect(cmdQuery({ q: "test" })).rejects.toThrow("Query failed: 500");

  });

  it("should download first match text when --full is used", async () => {
    const mockResults = {
      results: [
        { text: "full text content", score: 0.95, source: "invoice-123.pdf" },
      ],
    };

    globalThis.fetch = async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/query")) {
        return new Response(JSON.stringify(mockResults), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (value.endsWith("/query/fulltext-first")) {
        return new Response("full document text", {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": 'attachment; filename="invoice-123.txt"',
            "x-raged-source": "invoice-123.pdf",
          },
        });
      }

      return new Response("not found", { status: 404 });
    };

    const originalHome = process.env.HOME;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "raged-cli-test-"));
    await fs.mkdir(path.join(tempHome, "Downloads"), { recursive: true });
    process.env.HOME = tempHome;

    await cmdQuery({
      q: "packt invoice",
      full: true,
    });

    const downloadedPath = path.join(tempHome, "Downloads", "invoice-123.txt");
    const downloadedText = await fs.readFile(downloadedPath, "utf8");
    expect(downloadedText).toBe("full document text");

    process.env.HOME = originalHome;
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it("should use tmp file for --open on non-URL sources", async () => {
    const queryResults = {
      results: [
        { text: "content", score: 0.95, source: "INV89909018.pdf" },
      ],
    };

    const downloadData = Buffer.from("pdf-bytes");

    globalThis.fetch = async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/query")) {
        return new Response(JSON.stringify(queryResults), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (value.endsWith("/query/download-first")) {
        return new Response(downloadData, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": 'attachment; filename="INV89909018.pdf"',
            "x-raged-source": "INV89909018.pdf",
          },
        });
      }

      return new Response("not found", { status: 404 });
    };

    const originalHome = process.env.HOME;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "raged-cli-test-"));
    await fs.mkdir(path.join(tempHome, "Downloads"), { recursive: true });
    process.env.HOME = tempHome;

    await cmdQuery(
      {
        q: "INV89909018",
        open: true,
      },
      {
        openTargetFn: () => {},
      }
    );

    const downloads = await fs.readdir(path.join(tempHome, "Downloads"));
    expect(downloads).toEqual([]);

    const openTempPath = path.join(os.tmpdir(), "raged-open", "INV89909018.pdf");
    const written = await fs.readFile(openTempPath);
    expect(Buffer.compare(written, downloadData)).toBe(0);

    process.env.HOME = originalHome;
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(path.join(os.tmpdir(), "raged-open"), { recursive: true, force: true });
  });

  it("should print full text to stdout when --full --stdout is used", async () => {
    const mockResults = {
      results: [
        { text: "chunk text", score: 0.95, source: "invoice-123.pdf" },
      ],
    };

    globalThis.fetch = async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/query")) {
        return new Response(JSON.stringify(mockResults), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (value.endsWith("/query/fulltext-first")) {
        return new Response("full document text", {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": 'attachment; filename="invoice-123.txt"',
            "x-raged-source": "invoice-123.pdf",
          },
        });
      }

      return new Response("not found", { status: 404 });
    };

    const originalHome = process.env.HOME;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "raged-cli-test-"));
    await fs.mkdir(path.join(tempHome, "Downloads"), { recursive: true });
    process.env.HOME = tempHome;

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await cmdQuery({
      q: "packt invoice",
      full: true,
      stdout: true,
    });

    expect(writeSpy).toHaveBeenCalled();
    const written = writeSpy.mock.calls.map((call) => String(call[0] ?? "")).join("");
    expect(written).toContain("full document text");

    const downloads = await fs.readdir(path.join(tempHome, "Downloads"));
    expect(downloads).toEqual([]);

    process.env.HOME = originalHome;
    writeSpy.mockRestore();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it("should validate --minScore range and fall back to auto", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.minScore).toBe(0.3);

      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "invoice", minScore: "1.5" });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("should query all discovered collections when --allCollections is set", async () => {
    const seenQueries: string[] = [];

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);

      if (requestUrl.endsWith("/collections")) {
        return new Response(
          JSON.stringify({ collections: [{ collection: "downloads-pdf" }, { collection: "docs" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (requestUrl.endsWith("/query")) {
        const body = JSON.parse(init?.body as string);
        seenQueries.push(body.collection);
        return new Response(JSON.stringify({ results: [{ text: body.collection, source: `${body.collection}.md`, score: 0.8 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    };

    await cmdQuery({ q: "invoice", allCollections: true });
    expect(seenQueries).toEqual(["docs", "downloads-pdf"]);
  });

  it("should fall back to docs when --allCollections discovery fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seenQueries: string[] = [];

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);

      if (requestUrl.endsWith("/collections")) {
        return new Response("boom", { status: 500 });
      }

      if (requestUrl.endsWith("/query")) {
        const body = JSON.parse(init?.body as string);
        seenQueries.push(body.collection);
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    };

    await cmdQuery({ q: "invoice", allCollections: true });
    expect(seenQueries).toEqual(["docs"]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("should print requested summary level and keyword fallbacks", async () => {
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          results: [
            {
              text: "snippet",
              score: 0.9,
              source: "one.md",
              payload: {
                docSummaryLong: "Long summary",
                tier3Meta: { key_entities: ["alpha", "beta"] },
              },
            },
            {
              text: "snippet2",
              score: 0.85,
              source: "two.md",
              payload: {
                tier2Meta: { keywords: [{ text: "tier2-a" }, "tier2-b"] },
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    await cmdQuery({ q: "invoice", summary: "long", keywords: true, topK: "2" });

    const output = infoSpy.mock.calls.map((args) => String(args[0] ?? ""));
    expect(output).toContain("summary: Long summary");
    expect(output).toContain("keywords: alpha, beta");
    expect(output).toContain("keywords: tier2-a, tier2-b");
  });

  it("should create a unique temp file name for repeated --open downloads", async () => {
    const queryResults = {
      results: [{ text: "content", score: 0.95, source: "dup.pdf" }],
    };

    globalThis.fetch = async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/query")) {
        return new Response(JSON.stringify(queryResults), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (value.endsWith("/query/download-first")) {
        return new Response(Buffer.from("bytes"), {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": 'attachment; filename="dup.pdf"',
            "x-raged-source": "dup.pdf",
          },
        });
      }

      return new Response("not found", { status: 404 });
    };

    const openDir = path.join(os.tmpdir(), "raged-open");
    await fs.rm(openDir, { recursive: true, force: true });

    await cmdQuery({ q: "dup", open: true }, { openTargetFn: () => {} });
    await cmdQuery({ q: "dup", open: true }, { openTargetFn: () => {} });

    const files = await fs.readdir(openDir);
    expect(files).toContain("dup.pdf");
    expect(files).toContain("dup (1).pdf");

    await fs.rm(openDir, { recursive: true, force: true });
  });

  it("should send strategy in request body when --strategy is provided", async () => {
    let sentBody: Record<string, unknown> = {};

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ results: [], routing: { strategy: "graph", method: "explicit", confidence: 1.0, durationMs: 5 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "auth", strategy: "graph" });

    expect(sentBody.strategy).toBe("graph");
  });

  it("should send strategy to /query/fulltext-first when --full and --strategy are used", async () => {
    let fulltextBody: Record<string, unknown> | undefined;

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      const body = init?.body ? JSON.parse(init.body as string) : undefined;

      if (requestUrl.endsWith("/query")) {
        return new Response(JSON.stringify({
          results: [{ text: "chunk text", score: 0.95, source: "invoice-123.pdf" }],
          routing: { strategy: "graph", method: "explicit", confidence: 1.0, durationMs: 5 },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (requestUrl.endsWith("/query/fulltext-first")) {
        fulltextBody = body as Record<string, unknown>;
        return new Response("full document text", {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": 'attachment; filename="invoice-123.txt"',
            "x-raged-source": "invoice-123.pdf",
          },
        });
      }

      return new Response("not found", { status: 404 });
    };

    const originalHome = process.env.HOME;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "raged-cli-test-"));
    await fs.mkdir(path.join(tempHome, "Downloads"), { recursive: true });
    process.env.HOME = tempHome;

    await cmdQuery({ q: "packt invoice", full: true, strategy: "graph" });

    expect(fulltextBody?.strategy).toBe("graph");

    process.env.HOME = originalHome;
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it("should send strategy to /query/download-first when --open and --strategy are used", async () => {
    let downloadBody: Record<string, unknown> | undefined;

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      const body = init?.body ? JSON.parse(init.body as string) : undefined;

      if (requestUrl.endsWith("/query")) {
        return new Response(JSON.stringify({
          results: [{ text: "content", score: 0.95, source: "INV89909018.pdf" }],
          routing: { strategy: "graph", method: "explicit", confidence: 1.0, durationMs: 5 },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (requestUrl.endsWith("/query/download-first")) {
        downloadBody = body as Record<string, unknown>;
        return new Response(Buffer.from("pdf-bytes"), {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": 'attachment; filename="INV89909018.pdf"',
            "x-raged-source": "INV89909018.pdf",
          },
        });
      }

      return new Response("not found", { status: 404 });
    };

    const openDir = path.join(os.tmpdir(), "raged-open");
    await fs.rm(openDir, { recursive: true, force: true });

    await cmdQuery(
      { q: "INV89909018", open: true, strategy: "graph" },
      { openTargetFn: () => {} },
    );

    expect(downloadBody?.strategy).toBe("graph");

    await fs.rm(openDir, { recursive: true, force: true });
  });

  it("should omit strategy from request body when --strategy is not provided", async () => {
    let sentBody: Record<string, unknown> = {};

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ results: [], routing: { strategy: "semantic", method: "default", confidence: 0.5, durationMs: 2 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "auth" });

    expect(sentBody.strategy).toBeUndefined();
  });

  it("should omit strategy from request body when --strategy is 'auto'", async () => {
    let sentBody: Record<string, unknown> = {};

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ results: [], routing: { strategy: "semantic", method: "default", confidence: 0.5, durationMs: 2 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await cmdQuery({ q: "auth", strategy: "auto" });

    expect(sentBody.strategy).toBeUndefined();
  });

  it("should exit with error for invalid --strategy value", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = process.exit;
    let exitCode = 0;
    process.exit = ((code: number) => { exitCode = code; throw new Error("exit"); }) as never;

    try {
      await cmdQuery({ q: "auth", strategy: "invalid-strategy" });
    } catch {
      // expected
    }

    expect(exitCode).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid --strategy"));
    process.exit = exitSpy;
  });

  it("should NOT show routing line for semantic strategy without --verbose", async () => {
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        results: [{ id: "a:0", text: "some text", score: 0.85, source: "a.md" }],
        routing: { strategy: "semantic", method: "rule", confidence: 0.9, durationMs: 8 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    await cmdQuery({ q: "auth" });

    const output = infoSpy.mock.calls.map((args) => String(args[0] ?? ""));
    expect(output.some(line => line.startsWith("routing:"))).toBe(false);
  });

  it("should show routing line for semantic strategy with --verbose", async () => {
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        results: [{ id: "a:0", text: "some text", score: 0.85, source: "a.md" }],
        routing: { strategy: "semantic", method: "rule", confidence: 0.9, durationMs: 8 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    await cmdQuery({ q: "auth", verbose: true });

    const output = infoSpy.mock.calls.map((args) => String(args[0] ?? ""));
    expect(output).toContain("routing: semantic  (rule, 8ms)");
  });

  it("should show routing line and filter match for metadata strategy", async () => {
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        results: [{ id: "a:0", score: 1.0, source: "a.ts" }],
        routing: { strategy: "metadata", method: "rule", confidence: 1.0, durationMs: 3 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    await cmdQuery({ q: "files", lang: "ts" });

    const output = infoSpy.mock.calls.map((args) => String(args[0] ?? ""));
    expect(output).toContain("routing: metadata  (rule, 3ms)");
    expect(output).toContain("filter match: lang=ts");
  });

  it("should show routing line and graph documents section for graph strategy", async () => {
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        results: [{ id: "a:0", text: "auth handler code", score: 0.82, source: "auth.ts" }],
        routing: { strategy: "graph", method: "explicit", confidence: 1.0, durationMs: 11 },
        graph: {
          entities: [{ name: "AuthService", type: "class", depth: 0, isSeed: true }],
          relationships: [],
          paths: [],
          documents: [
            { documentId: "d1", source: "auth.ts", entityName: "AuthService", mentionCount: 3 },
            { documentId: "d2", source: "auth.test.ts", entityName: "AuthService", mentionCount: 1 },
          ],
          meta: { entityCount: 1, capped: false, timedOut: false, warnings: [] },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    await cmdQuery({ q: "auth flow", strategy: "graph" });

    const output = infoSpy.mock.calls.map((args) => String(args[0] ?? ""));
    expect(output).toContain("routing: graph  (explicit, 11ms)");
    expect(output).toContain("--- graph documents (2) ---");
    expect(output).toContain("[G1]  auth.ts");
    expect(output).toContain("[G2]  auth.test.ts");
  });

  it("should suppress graph documents section when graph.documents is empty", async () => {
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        results: [{ id: "a:0", text: "some text", score: 0.75, source: "a.ts" }],
        routing: { strategy: "graph", method: "rule", confidence: 0.9, durationMs: 7 },
        graph: {
          entities: [],
          relationships: [],
          paths: [],
          documents: [],
          meta: { entityCount: 0, capped: false, timedOut: false, warnings: [] },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    await cmdQuery({ q: "auth", strategy: "graph" });

    const output = infoSpy.mock.calls.map((args) => String(args[0] ?? ""));
    expect(output.some(line => line.startsWith("--- graph documents"))).toBe(false);
  });
});

describe("resolveTemporalShorthand", () => {
  it("resolves 'today' to start of today", () => {
    const result = resolveTemporalShorthand("today");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expect(result).toBe(today.toISOString());
  });

  it("resolves 'yesterday' to start of yesterday", () => {
    const result = resolveTemporalShorthand("yesterday");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    expect(result).toBe(yesterday.toISOString());
  });

  it("resolves '7d' to approximately 7 days ago", () => {
    const before = Date.now();
    const result = resolveTemporalShorthand("7d");
    const after = Date.now();
    const parsed = new Date(result).getTime();
    const expectedApprox = before - 7 * 24 * 60 * 60 * 1000;
    expect(parsed).toBeGreaterThanOrEqual(expectedApprox - 1000);
    expect(parsed).toBeLessThanOrEqual(after - 6 * 24 * 60 * 60 * 1000);
  });

  it("resolves '30d' to approximately 30 days ago", () => {
    const result = resolveTemporalShorthand("30d");
    const parsed = new Date(result).getTime();
    const approx = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(parsed - approx)).toBeLessThan(5000);
  });

  it("resolves '1y' to approximately 1 year ago", () => {
    const result = resolveTemporalShorthand("1y");
    const parsed = new Date(result).getTime();
    const approx = new Date();
    approx.setFullYear(approx.getFullYear() - 1);
    expect(Math.abs(parsed - approx.getTime())).toBeLessThan(5000);
  });

  it("passes through ISO 8601 datetime unchanged", () => {
    const iso = "2025-01-15T12:00:00Z";
    expect(resolveTemporalShorthand(iso)).toBe(iso);
  });

  it("passes through ISO 8601 date unchanged", () => {
    const iso = "2025-06-01";
    expect(resolveTemporalShorthand(iso)).toBe(iso);
  });

  it("throws on unrecognized value containing 'Unrecognized'", () => {
    expect(() => resolveTemporalShorthand("badvalue")).toThrow("Unrecognized");
  });

  it("throws on empty string", () => {
    expect(() => resolveTemporalShorthand("")).toThrow();
  });
});

describe("parseFilterField", () => {
  it("parses field:op:value", () => {
    const cond = parseFilterField("docType:eq:code");
    expect(cond).toEqual({ field: "docType", op: "eq", value: "code" });
  });

  it("parses field:op for isNull", () => {
    const cond = parseFilterField("enrichmentStatus:isNull");
    expect(cond).toEqual({ field: "enrichmentStatus", op: "isNull" });
  });

  it("parses field:op for isNotNull", () => {
    const cond = parseFilterField("lang:isNotNull");
    expect(cond).toEqual({ field: "lang", op: "isNotNull" });
  });

  it("value may contain colons", () => {
    const cond = parseFilterField("path:eq:src/lib:utils.ts");
    expect(cond.field).toBe("path");
    expect(cond.op).toBe("eq");
    expect(cond.value).toBe("src/lib:utils.ts");
  });

  it("parses in operator with comma-separated values", () => {
    const cond = parseFilterField("lang:in:ts,js,py");
    expect(cond).toEqual({ field: "lang", op: "in", values: ["ts", "js", "py"] });
  });

  it("parses notIn operator with comma-separated values", () => {
    const cond = parseFilterField("docType:notIn:image,pdf");
    expect(cond).toEqual({ field: "docType", op: "notIn", values: ["image", "pdf"] });
  });

  it("parses between operator with low,high", () => {
    const cond = parseFilterField("createdAt:between:2025-01-01,2025-12-31");
    expect(cond).toEqual({ field: "createdAt", op: "between", range: { low: "2025-01-01", high: "2025-12-31" } });
  });

  it("parses notBetween operator with low,high", () => {
    const cond = parseFilterField("chunkIndex:notBetween:5,10");
    expect(cond).toEqual({ field: "chunkIndex", op: "notBetween", range: { low: "5", high: "10" } });
  });

  it("throws when format is missing a colon", () => {
    expect(() => parseFilterField("nodots")).toThrow("Invalid --filterField");
  });

  it("throws when op requires value but none given", () => {
    expect(() => parseFilterField("docType:eq")).toThrow("requires a value");
  });
});
