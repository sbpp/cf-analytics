import { describe, expect, it } from "vitest";

import { mapDataPoint } from "../src/ae";
import { lock } from "../src/lock";
import { canonicalPayload } from "./fixtures";

describe("mapDataPoint", () => {
  it("maps the canonical payload to the snapshot data point", () => {
    const dp = mapDataPoint(canonicalPayload);
    expect(dp).toMatchSnapshot();
  });

  it("indexes by panel.version", () => {
    const dp = mapDataPoint(canonicalPayload);
    expect(dp.indexes).toEqual([canonicalPayload.panel.version]);
  });

  it("uses positions read from the lock file (not hardcoded)", () => {
    const dp = mapDataPoint(canonicalPayload);
    expect(dp.blobs.length).toBe(lock.blobs.length);
    expect(dp.doubles.length).toBe(lock.doubles.length);

    const phpIdx = lock.blobs.indexOf("env.php");
    expect(dp.blobs[phpIdx]).toBe("8.2");
    const bansActiveIdx = lock.doubles.indexOf("scale.bans_active");
    expect(dp.doubles[bansActiveIdx]).toBe(2847);
  });

  it("emits null for missing typed strings", () => {
    const sparse = { schema: 1, instance_id: "abc" };
    const dp = mapDataPoint(sparse);
    const phpIdx = lock.blobs.indexOf("env.php");
    expect(dp.blobs[phpIdx]).toBeNull();
  });

  it("emits null for missing scale doubles (not zero)", () => {
    const sparse = { schema: 1, instance_id: "abc" };
    const dp = mapDataPoint(sparse);
    const protestsIdx = lock.doubles.indexOf("scale.protests_30d");
    expect(dp.doubles[protestsIdx]).toBeNull();
  });

  it("always emits panel_features_bits, defaulting to 0", () => {
    const sparse = { schema: 1, instance_id: "abc" };
    const dp = mapDataPoint(sparse);
    const bitsIdx = lock.doubles.indexOf("panel_features_bits");
    expect(dp.doubles[bitsIdx]).toBe(0);
  });

  it("places extras as JSON in the extras blob and null when empty", () => {
    const extrasIdx = lock.blobs.indexOf("extras");
    const empty = mapDataPoint({ schema: 1, instance_id: "abc" });
    expect(empty.blobs[extrasIdx]).toBeNull();

    const withExtras = mapDataPoint({
      schema: 1,
      instance_id: "abc",
      future_thing: "hello",
      another: 42,
    });
    const blob = withExtras.blobs[extrasIdx];
    expect(blob).not.toBeNull();
    expect(JSON.parse(blob as string)).toEqual({
      future_thing: "hello",
      another: 42,
    });
  });

  it("keeps the schema number in the schema double", () => {
    const dp = mapDataPoint(canonicalPayload);
    const schemaIdx = lock.doubles.indexOf("schema");
    expect(dp.doubles[schemaIdx]).toBe(1);
  });
});
