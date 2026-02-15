import { validateUrl, SsrfError } from "./ssrf.js";

export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_REDIRECTS = 5;
export const MAX_CONCURRENT_FETCHES = 5;
export const USER_AGENT = "rag-stack/1.0 (+https://github.com/mfittko/rag-stack)";

export interface FetchResult {
  url: string;            // Original URL
  resolvedUrl: string;    // Final URL after redirects
  contentType: string;    // Response Content-Type
  status: number;         // HTTP status
  body: Buffer;           // Response body
  fetchedAt: string;      // ISO timestamp
}

export interface FetchError {
  url: string;
  status: number | null;
  reason: "fetch_failed" | "timeout" | "ssrf_blocked" | "too_large" | "redirect_limit";
}

interface FetchContext {
  originalUrl: string;
  currentUrl: string;
  redirectCount: number;
  resolvedIp?: string;  // Resolved IP from SSRF validation
  hostname?: string;    // Original hostname
  port?: number;        // Port from validated URL
}

async function fetchSingleUrl(context: FetchContext): Promise<FetchResult> {
  // Validate URL for SSRF and get resolved IP
  let validationResult: { hostname: string; resolvedIp: string; port: number };
  try {
    validationResult = await validateUrl(context.currentUrl);
  } catch (error) {
    if (error instanceof SsrfError) {
      throw { url: context.originalUrl, status: null, reason: "ssrf_blocked" as const };
    }
    throw error;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Note: We use the original hostname in the URL to preserve TLS certificate validation for HTTPS.
    // This creates a small DNS rebinding window between validation and fetch, but is necessary
    // for proper HTTPS operation. The native fetch API doesn't support custom DNS resolution
    // without breaking TLS SNI/certificate validation.
    const response = await fetch(context.currentUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "gzip, deflate, br",
      },
      signal: controller.signal,
      redirect: "manual", // Handle redirects manually
    });

    clearTimeout(timeoutId);

    // Handle redirects manually to validate each redirect target
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw { url: context.originalUrl, status: response.status, reason: "fetch_failed" as const };
      }

      // Check redirect limit
      if (context.redirectCount >= MAX_REDIRECTS) {
        throw { url: context.originalUrl, status: response.status, reason: "redirect_limit" as const };
      }

      // Resolve relative redirects
      let redirectUrl: string;
      try {
        redirectUrl = new URL(location, context.currentUrl).toString();
      } catch {
        throw { url: context.originalUrl, status: response.status, reason: "fetch_failed" as const };
      }

      // Validate redirect protocol - only allow HTTP(S)
      const redirectProto = new URL(redirectUrl).protocol;
      
      if (redirectProto !== "http:" && redirectProto !== "https:") {
        throw { url: context.originalUrl, status: response.status, reason: "ssrf_blocked" as const };
      }
      
      // Prevent HTTPS → HTTP downgrade
      const currentProto = new URL(context.currentUrl).protocol;
      if (currentProto === "https:" && redirectProto !== "https:") {
        throw { url: context.originalUrl, status: response.status, reason: "ssrf_blocked" as const };
      }

      // Follow redirect
      return fetchSingleUrl({
        originalUrl: context.originalUrl,
        currentUrl: redirectUrl,
        redirectCount: context.redirectCount + 1,
      });
    }

    // Check content length
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      throw { url: context.originalUrl, status: response.status, reason: "too_large" as const };
    }

    // Read response body with size limit
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    if (response.body) {
      const reader = response.body.getReader();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          totalSize += value.length;
          if (totalSize > MAX_RESPONSE_BYTES) {
            // Cancel the stream before throwing
            await reader.cancel();
            throw { url: context.originalUrl, status: response.status, reason: "too_large" as const };
          }
          
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    const body = Buffer.concat(chunks);
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    return {
      url: context.originalUrl,
      resolvedUrl: context.currentUrl,
      contentType,
      status: response.status,
      body,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    clearTimeout(timeoutId);

    // Re-throw structured errors
    if (error && typeof error === "object" && "reason" in error) {
      throw error;
    }

    // Handle timeout
    if (error instanceof Error && error.name === "AbortError") {
      throw { url: context.originalUrl, status: null, reason: "timeout" as const };
    }

    // Generic fetch failure
    throw { url: context.originalUrl, status: null, reason: "fetch_failed" as const };
  }
}

async function fetchWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workers: Promise<void>[] = [];

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) break;
      await fn(items[index]);
    }
  }

  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
}

export async function fetchUrls(urls: string[]): Promise<{
  results: Map<string, FetchResult>;
  errors: FetchError[];
}> {
  // Deduplicate URLs
  const uniqueUrls = Array.from(new Set(urls));
  
  const results = new Map<string, FetchResult>();
  const errors: FetchError[] = [];

  await fetchWithConcurrency(uniqueUrls, MAX_CONCURRENT_FETCHES, async (url) => {
    try {
      const result = await fetchSingleUrl({
        originalUrl: url,
        currentUrl: url,
        redirectCount: 0,
      });
      results.set(url, result);
    } catch (error) {
      if (error && typeof error === "object" && "reason" in error) {
        errors.push(error as FetchError);
      } else {
        errors.push({ url, status: null, reason: "fetch_failed" });
      }
    }
  });

  return { results, errors };
}
