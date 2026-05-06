import { Hono } from "hono";
import { ZodError } from "zod";

import { mapDataPoint, writeDataPoint, type AnalyticsEngineLike } from "./ae";
import { SchemaDispatchError, validate } from "./schema";
import { stripIp } from "./strip-ip";

/**
 * Cloudflare Worker bindings declared in `wrangler.toml`.
 *
 * `TELEMETRY` is an Analytics Engine dataset binding. The Worker's only side
 * effect is `env.TELEMETRY.writeDataPoint(...)`; nothing else is persisted or
 * logged.
 */
export interface Env {
  TELEMETRY: AnalyticsEngineLike;
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
 * Flow: parse JSON → dispatch on `body.schema` to the matching Zod validator →
 * map to AE data point → `writeDataPoint` → `204 No Content`. The data point
 * is built _only_ from the validated body; headers and `request.cf` location
 * fields are never read on this code path (anonymity contract).
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
