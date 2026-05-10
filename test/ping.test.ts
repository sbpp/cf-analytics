import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { canonicalPayload, makeEnv } from "./fixtures";

const IncomingRequest = Request;

function jsonRequest(body: unknown): Request {
  return new IncomingRequest("http://telemetry.sbpp.dev/v1/ping", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Worker routes", () => {
  it("POST /v1/ping with the canonical payload returns 204 with empty body", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const res = await worker.fetch(jsonRequest(canonicalPayload), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(env.TELEMETRY.calls).toHaveLength(1);
    // The rate limiter is keyed on `instance_id` from the validated body.
    // This pins the privacy-preserving choice (key on body, not IP) into a
    // test so a future maintainer can't quietly switch it to `cf-connecting-ip`.
    expect(env.TELEMETRY_RL.calls).toEqual([{ key: canonicalPayload.instance_id }]);
  });

  it("returns 429 with empty body when the rate limiter rejects, without writing to AE", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    env.TELEMETRY_RL.forceFailures.push(true);
    const res = await worker.fetch(jsonRequest(canonicalPayload), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(429);
    expect(await res.text()).toBe("");
    expect(env.TELEMETRY.calls).toHaveLength(0);
    expect(env.TELEMETRY_RL.calls).toEqual([{ key: canonicalPayload.instance_id }]);
  });

  it("rate-limit check runs after schema validation (invalid payloads do not consume tokens)", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const res = await worker.fetch(jsonRequest({ schema: 1, instance_id: "" }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    expect(env.TELEMETRY.calls).toHaveLength(0);
    expect(env.TELEMETRY_RL.calls).toHaveLength(0);
  });

  it("GET /healthz returns 200 with body 'ok' as plain text", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const req = new IncomingRequest("http://telemetry.sbpp.dev/healthz", {
      method: "GET",
    });
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/text\/plain/);
    expect(env.TELEMETRY.calls).toHaveLength(0);
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const req = new IncomingRequest("http://telemetry.sbpp.dev/v1/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    expect(env.TELEMETRY.calls).toHaveLength(0);
  });

  it("returns 400 for schema:0 without writing to AE", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const res = await worker.fetch(jsonRequest({ schema: 0, instance_id: "abc" }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "schema_not_supported" });
    expect(env.TELEMETRY.calls).toHaveLength(0);
  });

  it("returns 400 for schema-1 payloads that fail validation", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const res = await worker.fetch(jsonRequest({ schema: 1, instance_id: "" }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    expect(env.TELEMETRY.calls).toHaveLength(0);
  });

  it("returns 404 with empty body for unknown paths", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const req = new IncomingRequest("http://telemetry.sbpp.dev/anything-else", {
      method: "GET",
    });
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("returns 404 for non-POST methods on /v1/ping", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const req = new IncomingRequest("http://telemetry.sbpp.dev/v1/ping", {
      method: "GET",
    });
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("does not echo path content in the 404 body or descriptive headers", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const req = new IncomingRequest("http://telemetry.sbpp.dev/secret-leak-attempt-9999", {
      method: "GET",
    });
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("");
    expect(text).not.toContain("secret-leak-attempt-9999");
  });
});
