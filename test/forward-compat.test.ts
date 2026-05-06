import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { lock } from "../src/lock";
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

describe("forward compatibility", () => {
  it("preserves unknown top-level keys into the extras blob (additive)", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const payload = { ...canonicalPayload, future_thing: "hello" };
    const res = await worker.fetch(jsonRequest(payload), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(204);
    expect(env.TELEMETRY.calls).toHaveLength(1);

    const extrasIdx = lock.blobs.indexOf("extras");
    const blob = env.TELEMETRY.calls[0]!.blobs?.[extrasIdx] ?? null;
    expect(blob).not.toBeNull();
    expect(JSON.parse(blob as string)).toEqual({ future_thing: "hello" });
  });

  it("treats every non-required field as optional (sparse payloads still write)", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const sparse = {
      schema: 1 as const,
      instance_id: canonicalPayload.instance_id,
      panel: { version: "2.0.0", git: "abc1234", dev: false, theme: "default" },
      env: canonicalPayload.env,
      scale: {
        admins: 12,
        servers_enabled: 7,
        bans_active: 2847,
        bans_total: 18394,
        comms_active: 412,
        comms_total: 5108,
        submissions_30d: 23,
      },
      features: {
        submit: true,
        protest: true,
        comms: true,
        exportpublic: false,
        publiccomments: false,
        steamlogin: true,
        normallogin: true,
        groupbanning: false,
        friendsbanning: false,
        adminrehashing: true,
        smtp_configured: true,
        steam_api_key_set: true,
        geoip_present: true,
      },
    };

    const res = await worker.fetch(jsonRequest(sparse), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(204);
    expect(env.TELEMETRY.calls).toHaveLength(1);

    const dp = env.TELEMETRY.calls[0]!;
    const bitsIdx = lock.doubles.indexOf("panel_features_bits");
    const kickitBitIdx = lock.bits.indexOf("features.kickit");
    const bitsValue = dp.doubles?.[bitsIdx] ?? 0;
    const kickitBit = (Math.floor(bitsValue / Math.pow(2, kickitBitIdx)) & 1) === 1;
    expect(kickitBit).toBe(false);

    const protestsIdx = lock.doubles.indexOf("scale.protests_30d");
    expect(dp.doubles).toBeDefined();
    expect(dp.doubles![protestsIdx]).toBeNull();
  });

  it("dispatches schema:2 to a 400 today with no AE write (dispatch is exercised)", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();
    const res = await worker.fetch(jsonRequest({ schema: 2, instance_id: "abc" }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "schema_not_supported" });
    expect(env.TELEMETRY.calls).toHaveLength(0);
  });
});
