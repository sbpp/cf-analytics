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

describe("env.* shared-host fingerprint round-trip (issue #3)", () => {
  // The issue is explicit that no new mapping logic is needed: every new
  // env.* field reads through the existing readPath / bit-pack path. These
  // tests pin that contract by populating every new field and asserting it
  // lands at the lock-derived blob/double/bit position.

  it("round-trips every new env.* signal to its lock-derived position", () => {
    const dp = mapDataPoint(canonicalPayload);

    expect(dp.blobs[lock.blobs.indexOf("env.sapi")]).toBe("fpm-fcgi");

    expect(dp.doubles[lock.doubles.indexOf("env.memory_limit_mb")]).toBe(256);
    expect(dp.doubles[lock.doubles.indexOf("env.max_execution_time")]).toBe(30);
    expect(dp.doubles[lock.doubles.indexOf("env.disable_functions_count")]).toBe(7);

    const bitsIdx = lock.doubles.indexOf("panel_features_bits");
    const bits = dp.doubles[bitsIdx] ?? 0;
    const bit = (name: string): boolean =>
      (Math.floor(bits / Math.pow(2, lock.bits.indexOf(name))) & 1) === 1;

    expect(bit("env.zts")).toBe(false);
    expect(bit("env.php_64bit")).toBe(true);
    expect(bit("env.open_basedir_set")).toBe(true);
    expect(bit("env.allow_url_fopen")).toBe(true);
    expect(bit("env.opcache_loaded")).toBe(true);
    expect(bit("env.suhosin_loaded")).toBe(false);
    expect(bit("env.posix_available")).toBe(true);
    expect(bit("env.host_panel_cpanel")).toBe(true);
    expect(bit("env.host_panel_plesk")).toBe(false);
    expect(bit("env.host_panel_directadmin")).toBe(false);
    expect(bit("env.docroot_user_home")).toBe(true);
    expect(bit("env.sapi_per_user")).toBe(true);
  });

  it("emits null/0 for the new env signals when the panel sends only the legacy env block", () => {
    const sparseEnv = {
      schema: 1 as const,
      instance_id: canonicalPayload.instance_id,
      env: {
        php: "8.2",
        db_engine: "mariadb",
        db_version: "10.11",
        web_server: "apache",
        os_family: "linux",
      },
    };
    const dp = mapDataPoint(sparseEnv);

    expect(dp.blobs[lock.blobs.indexOf("env.sapi")]).toBeNull();

    expect(dp.doubles[lock.doubles.indexOf("env.memory_limit_mb")]).toBeNull();
    expect(dp.doubles[lock.doubles.indexOf("env.max_execution_time")]).toBeNull();
    expect(dp.doubles[lock.doubles.indexOf("env.disable_functions_count")]).toBeNull();

    const bitsIdx = lock.doubles.indexOf("panel_features_bits");
    const bits = dp.doubles[bitsIdx] ?? 0;
    for (const name of [
      "env.zts",
      "env.php_64bit",
      "env.open_basedir_set",
      "env.allow_url_fopen",
      "env.opcache_loaded",
      "env.suhosin_loaded",
      "env.posix_available",
      "env.host_panel_cpanel",
      "env.host_panel_plesk",
      "env.host_panel_directadmin",
      "env.docroot_user_home",
      "env.sapi_per_user",
    ]) {
      const set = (Math.floor(bits / Math.pow(2, lock.bits.indexOf(name))) & 1) === 1;
      expect(set, `expected bit ${name} to be 0 for sparse payload`).toBe(false);
    }

    // Legacy env strings still serialise — sparseness is for the new fields only.
    expect(dp.blobs[lock.blobs.indexOf("env.php")]).toBe("8.2");
  });

  // Mirrors the existing `features.kickit` per-bit position tests but
  // exercises three of the new env.* bits to lock their positions in.
  it("places env.open_basedir_set at the lock-derived bit", () => {
    const payload = {
      schema: 1 as const,
      instance_id: "abc",
      env: { open_basedir_set: true },
    };
    const dp = mapDataPoint(payload);
    const bits = dp.doubles[lock.doubles.indexOf("panel_features_bits")] ?? 0;
    expect(bits).toBe(Math.pow(2, lock.bits.indexOf("env.open_basedir_set")));
  });

  it("places env.host_panel_cpanel at the lock-derived bit", () => {
    const payload = {
      schema: 1 as const,
      instance_id: "abc",
      env: { host_panel_cpanel: true },
    };
    const dp = mapDataPoint(payload);
    const bits = dp.doubles[lock.doubles.indexOf("panel_features_bits")] ?? 0;
    expect(bits).toBe(Math.pow(2, lock.bits.indexOf("env.host_panel_cpanel")));
  });

  it("places env.sapi_per_user at the lock-derived bit", () => {
    const payload = {
      schema: 1 as const,
      instance_id: "abc",
      env: { sapi_per_user: true },
    };
    const dp = mapDataPoint(payload);
    const bits = dp.doubles[lock.doubles.indexOf("panel_features_bits")] ?? 0;
    expect(bits).toBe(Math.pow(2, lock.bits.indexOf("env.sapi_per_user")));
  });
});
