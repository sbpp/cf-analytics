import { Hono } from "hono";
import { ZodError } from "zod";

import { mapDataPoint, writeDataPoint, type AnalyticsEngineLike } from "./ae";
import { SchemaDispatchError, validate } from "./schema";
import { stripIp } from "./strip-ip";

/**
 * Cloudflare Worker bindings declared in `wrangler.toml`.
 *
 * - `TELEMETRY` — Analytics Engine dataset binding. The Worker's only
 *   side effect is `env.TELEMETRY.writeDataPoint(...)`; nothing else is
 *   persisted or logged.
 * - `TELEMETRY_RL` — Workers Rate Limiting binding, keyed on the
 *   body-supplied `instance_id`. Keying on `instance_id` rather than the
 *   source IP preserves the "no IP data path" privacy contract documented
 *   in `src/strip-ip.ts` and the README.
 */
export interface Env {
  TELEMETRY: AnalyticsEngineLike;
  TELEMETRY_RL: RateLimitLike;
}

/**
 * Minimal rate-limit binding shape — narrower than `RateLimit` from
 * `@cloudflare/workers-types` so tests can mock it without dragging the full
 * type in (matches the pattern used for `AnalyticsEngineLike`).
 */
export interface RateLimitLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", stripIp);

/**
 * Liveness probe for uptime monitoring. Plain text body keeps the response
 * cheap and unambiguous for `curl` checks.
 */
app.get("/healthz", (c) => c.text("ok", 200));

/**
 * Telemetry ingest endpoint.
 *
 * Flow: parse JSON → dispatch on `body.schema` to the matching Zod validator
 * → rate-limit by `instance_id` → map to AE data point → `writeDataPoint` →
 * `204 No Content`. The data point is built _only_ from the validated body;
 * headers and `request.cf` location fields are never read on this code path
 * (anonymity contract).
 */
app.post("/v1/ping", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = validate(body) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SchemaDispatchError) {
      return c.json({ error: "schema_not_supported" }, 400);
    }
    if (err instanceof ZodError) {
      return c.json({ error: "schema_invalid" }, 400);
    }
    throw err;
  }

  // Rate-limit on the validated `instance_id`. The schema validator guarantees
  // it's a non-empty string by the time we reach this point. Returns 429 with
  // an empty body on exceed — same minimal-fingerprint posture as the 404.
  const { success } = await c.env.TELEMETRY_RL.limit({
    key: parsed["instance_id"] as string,
  });
  if (!success) {
    return c.body(null, 429);
  }

  const point = mapDataPoint(parsed);
  writeDataPoint(c.env.TELEMETRY, point);

  return c.body(null, 204);
});

/**
 * Catch-all 404 with empty body and no descriptive headers — don't echo the
 * path, don't help fingerprinting.
 */
app.all("*", (c) => c.body(null, 404));

export default app;
export { app };
