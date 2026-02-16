import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { timingSafeEqual, registerAuth } from "./auth.js";

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("returns false when only one is empty", () => {
    expect(timingSafeEqual("", "a")).toBe(false);
  });
});

describe("registerAuth", () => {
  const ORIGINAL_ENV = process.env.RAGED_API_TOKEN;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.RAGED_API_TOKEN;
    } else {
      process.env.RAGED_API_TOKEN = ORIGINAL_ENV;
    }
  });

  it("does not add auth hook when RAGED_API_TOKEN is empty", async () => {
    process.env.RAGED_API_TOKEN = "";
    const app = Fastify();
    registerAuth(app);
    app.post("/test", async () => ({ ok: true }));

    const res = await app.inject({
      method: "POST",
      url: "/test",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("allows GET /healthz without auth token", async () => {
    process.env.RAGED_API_TOKEN = "secret-token";
    const app = Fastify();
    registerAuth(app);
    app.get("/healthz", async () => ({ ok: true }));

    const res = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("returns 401 when no Authorization header is provided", async () => {
    process.env.RAGED_API_TOKEN = "secret-token";
    const app = Fastify();
    registerAuth(app);
    app.post("/test", async () => ({ ok: true }));

    const res = await app.inject({
      method: "POST",
      url: "/test",
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
    await app.close();
  });

  it("returns 401 when Authorization header lacks Bearer prefix", async () => {
    process.env.RAGED_API_TOKEN = "secret-token";
    const app = Fastify();
    registerAuth(app);
    app.post("/test", async () => ({ ok: true }));

    const res = await app.inject({
      method: "POST",
      url: "/test",
      payload: {},
      headers: { authorization: "Basic secret-token" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
    await app.close();
  });

  it("returns 401 when wrong token is provided", async () => {
    process.env.RAGED_API_TOKEN = "secret-token";
    const app = Fastify();
    registerAuth(app);
    app.post("/test", async () => ({ ok: true }));

    const res = await app.inject({
      method: "POST",
      url: "/test",
      payload: {},
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
    await app.close();
  });

  it("allows request when correct token is provided", async () => {
    process.env.RAGED_API_TOKEN = "secret-token";
    const app = Fastify();
    registerAuth(app);
    app.post("/test", async () => ({ ok: true }));

    const res = await app.inject({
      method: "POST",
      url: "/test",
      payload: {},
      headers: { authorization: "Bearer secret-token" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
