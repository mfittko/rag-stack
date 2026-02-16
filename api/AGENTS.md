# AGENTS.md — api/

> Inherits all principles from the root [AGENTS.md](../AGENTS.md). This file adds API-specific rules.

## Module Structure

```
src/
  server.ts     → Fastify app setup, route registration, server start
  auth.ts       → Authentication hook (bearer token)
  chunking.ts   → Text chunking logic
  ollama.ts     → Embedding client (Ollama HTTP API)
  db.ts         → Postgres client and migrations
```

## Rules

### Route Handlers Stay Thin

Route handlers in `server.ts` must only: parse input, call service functions, return output. No business logic in handlers. If a handler grows beyond ~15 lines, extract the logic into a service module.

### Fastify Plugins for Cross-Cutting Concerns

Authentication, logging, and other cross-cutting concerns must be registered as Fastify hooks or plugins — not inlined into route handlers. See `auth.ts` for the pattern.

### Input Validation

Every route must validate its input. Use Fastify's built-in JSON Schema validation on route definitions. Do not validate inside handler functions.

### Single Responsibility Per Module

- `chunking.ts` — only text chunking. No embedding, no HTTP, no database.
- `ollama.ts` — only embedding via Ollama. No chunking, no database.
- `db.ts` — only Postgres client and migrations. No embedding, no chunking.
- `auth.ts` — only authentication. No business logic.

If a new concern appears (e.g., caching, rate limiting), create a new module.

### Health Endpoint

`/healthz` must always be unauthenticated and must return `{ ok: true }`. It is used by Kubernetes liveness probes. Never add auth or heavy logic to it.

### Error Responses

Return structured JSON errors: `{ error: "<message>" }`. Use appropriate HTTP status codes. Never expose stack traces in production responses.

### Environment Variables

All configuration is via environment variables. Document every env var in this file:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://raged:raged@postgres:5432/raged` | Postgres connection URL |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama server URL |
| `EMBED_MODEL` | `nomic-embed-text` | Ollama embedding model |
| `PORT` | `8080` | API listen port |
| `RAGED_API_TOKEN` | _(empty)_ | Bearer token for auth (empty = auth disabled) |
| `ENRICHMENT_ENABLED` | `false` | Enable enrichment queue processing |
