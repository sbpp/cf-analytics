import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import { assertNoIpFields } from "../src/strip-ip";
import { canonicalPayload, makeEnv } from "./fixtures";

const IncomingRequest = Request;

/**
 * Literal substrings that, if present in a JSON-stringified data point or log
 * line, indicate a leak from the request's headers or `request.cf` to AE.
 *
 * For digit-only values (latitude `"1"`, longitude `"2"`) we wrap the search
 * pattern in surrounding double-quotes so the check matches exactly the
 * JSON-encoded shape a leaked blob would take, not any random digit inside a
 * count value. The IP and city literals are unique enough to match unwrapped.
 */
const BANNED_LITERALS = [
  "1.2.3.4", // CF-Connecting-IP / CF-Pseudo-IPv4
  "5.6.7.8", // X-Forwarded-For / X-Real-IP
  "9.10.11.12", // True-Client-IP
  "TestCity", // request.cf.city
  '"1"', // request.cf.latitude (string value)
  '"2"', // request.cf.longitude (string value)
];

describe("IP-leak contract", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;
  let consoleInfo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    consoleInfo.mockRestore();
  });

  it("never reaches AE or logs with banned-header values or geo cf fields", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();

    const headers = new Headers({
      "content-type": "application/json",
      "CF-Connecting-IP": "1.2.3.4",
      "X-Forwarded-For": "5.6.7.8",
      "True-Client-IP": "9.10.11.12",
      "X-Real-IP": "5.6.7.8",
      "CF-Pseudo-IPv4": "1.2.3.4",
    });
    const baseRequest = new IncomingRequest("http://telemetry.sbpp.dev/v1/ping", {
      method: "POST",
      headers,
      body: JSON.stringify(canonicalPayload),
    });

    // Synthesise a request with a populated `cf` field — Workers' production
    // runtime decorates inbound requests with this, and this test asserts the
    // Worker doesn't read from it.
    const cfPayload = {
      colo: "ATL",
      city: "TestCity",
      latitude: "1",
      longitude: "2",
      region: "TestRegion",
      regionCode: "TC",
      postalCode: "12345",
      metroCode: "999",
      timezone: "Europe/TestZone",
    };
    Object.defineProperty(baseRequest, "cf", {
      value: cfPayload,
      writable: false,
      configurable: true,
      enumerable: true,
    });

    const res = await worker.fetch(baseRequest, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(204);
    expect(env.TELEMETRY.calls).toHaveLength(1);

    for (const dp of env.TELEMETRY.calls) {
      assertNoIpFields(dp, BANNED_LITERALS);
    }

    const allLogCalls = [
      ...consoleLog.mock.calls,
      ...consoleError.mock.calls,
      ...consoleWarn.mock.calls,
      ...consoleInfo.mock.calls,
    ];
    const logHaystack = JSON.stringify(allLogCalls);
    for (const needle of BANNED_LITERALS) {
      expect(logHaystack).not.toContain(needle);
    }
  });

  it("ignores latitude/longitude even when they appear as the panel.theme value (no fallback path leaks)", async () => {
    const env = makeEnv();
    const ctx = createExecutionContext();

    // Sanity: the panel-supplied body fields ARE written to AE — that's expected.
    // The leak we guard against is non-body sources (headers, request.cf).
    // This test confirms the code path doesn't, e.g., concatenate request.cf
    // into the data point even when the body doesn't override it.
    const sparseBody = { schema: 1, instance_id: "abc" };
    const headers = new Headers({
      "content-type": "application/json",
      "CF-Connecting-IP": "1.2.3.4",
    });
    const req = new IncomingRequest("http://telemetry.sbpp.dev/v1/ping", {
      method: "POST",
      headers,
      body: JSON.stringify(sparseBody),
    });
    Object.defineProperty(req, "cf", {
      value: { city: "TestCity", latitude: "1", longitude: "2" },
      writable: false,
      configurable: true,
      enumerable: true,
    });

    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(204);
    for (const dp of env.TELEMETRY.calls) {
      assertNoIpFields(dp, BANNED_LITERALS);
    }
  });
});
