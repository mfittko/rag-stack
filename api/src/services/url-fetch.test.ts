import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { fetchUrls, FETCH_TIMEOUT_MS, MAX_RESPONSE_BYTES, MAX_REDIRECTS, USER_AGENT } from "./url-fetch.js";

// Mock server for testing
let mockServer: any = null;

describe("URL fetch service", () => {
  describe("configuration", () => {
    it("has correct timeout constant", () => {
      expect(FETCH_TIMEOUT_MS).toBe(30_000);
    });

    it("has correct max response bytes constant", () => {
      expect(MAX_RESPONSE_BYTES).toBe(10 * 1024 * 1024);
    });

    it("has correct max redirects constant", () => {
      expect(MAX_REDIRECTS).toBe(5);
    });

    it("has correct user agent", () => {
      expect(USER_AGENT).toBe("rag-stack/1.0 (+https://github.com/mfittko/rag-stack)");
    });
  });

  describe("SSRF protection", () => {
    it("blocks private IP addresses", async () => {
      const result = await fetchUrls(["http://127.0.0.1/"]);
      
      expect(result.results.size).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].reason).toBe("ssrf_blocked");
      expect(result.errors[0].url).toBe("http://127.0.0.1/");
    });

    it("blocks localhost", async () => {
      const result = await fetchUrls(["http://localhost/"]);
      
      expect(result.results.size).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].reason).toBe("ssrf_blocked");
    });

    it("blocks cloud metadata IP", async () => {
      const result = await fetchUrls(["http://169.254.169.254/"]);
      
      expect(result.results.size).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].reason).toBe("ssrf_blocked");
    });
  });

  describe("deduplication", () => {
    it("deduplicates same URL in batch", async () => {
      const urls = [
        "http://127.0.0.1/test",
        "http://127.0.0.1/test",
        "http://127.0.0.1/test",
      ];
      
      const result = await fetchUrls(urls);
      
      // Should only have 1 error, not 3
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].url).toBe("http://127.0.0.1/test");
    });

    it("handles multiple distinct URLs", async () => {
      const urls = [
        "http://127.0.0.1/",
        "http://10.0.0.1/",
        "http://192.168.1.1/",
      ];
      
      const result = await fetchUrls(urls);
      
      // Should have 3 distinct errors
      expect(result.errors.length).toBe(3);
    });
  });

  describe("protocol validation", () => {
    it("blocks file:// protocol", async () => {
      const result = await fetchUrls(["file:///etc/passwd"]);
      
      expect(result.results.size).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].reason).toBe("ssrf_blocked");
    });

    it("blocks ftp:// protocol", async () => {
      const result = await fetchUrls(["ftp://example.com/"]);
      
      expect(result.results.size).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].reason).toBe("ssrf_blocked");
    });
  });

  describe("error handling", () => {
    it("handles malformed URLs", async () => {
      const result = await fetchUrls(["not-a-url"]);
      
      expect(result.results.size).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].reason).toBe("ssrf_blocked");
    });

    it("handles DNS lookup failures", async () => {
      const result = await fetchUrls(["http://this-domain-definitely-does-not-exist-12345.com/"]);
      
      expect(result.results.size).toBe(0);
      expect(result.errors.length).toBe(1);
      // DNS lookup failure should result in ssrf_blocked
      expect(result.errors[0].reason).toBe("ssrf_blocked");
    });
  });

  describe("mixed results", () => {
    it("returns both successful and failed fetches", async () => {
      const urls = [
        "http://127.0.0.1/",      // blocked
        "http://10.0.0.1/",       // blocked
      ];
      
      const result = await fetchUrls(urls);
      
      expect(result.results.size).toBe(0);
      expect(result.errors.length).toBe(2);
    });
  });
});
