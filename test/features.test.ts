import { describe, expect, it } from "vitest";

import { packPanelFeatures, unpackPanelFeatures } from "../src/features";
import { lock } from "../src/lock";

describe("packPanelFeatures / unpackPanelFeatures", () => {
  it("packs all-true input to (2^N - 1) and round-trips", () => {
    const allTrue: Record<string, boolean> = {};
    for (const name of lock.bits) allTrue[name] = true;

    const packed = packPanelFeatures(allTrue, lock);
    expect(packed).toBe(Math.pow(2, lock.bits.length) - 1);

    const unpacked = unpackPanelFeatures(packed, lock);
    expect(unpacked).toEqual(allTrue);
  });

  it("packs all-false input to 0", () => {
    const allFalse: Record<string, boolean> = {};
    for (const name of lock.bits) allFalse[name] = false;
    expect(packPanelFeatures(allFalse, lock)).toBe(0);
  });

  it("treats missing keys as 0 and round-trips them as false", () => {
    const partial = { "features.submit": true } as const;
    const packed = packPanelFeatures(partial, lock);
    expect(packed).toBe(Math.pow(2, lock.bits.indexOf("features.submit")));
    const unpacked = unpackPanelFeatures(packed, lock);
    expect(unpacked["features.submit"]).toBe(true);
    expect(unpacked["features.kickit"]).toBe(false);
    expect(unpacked["panel.dev"]).toBe(false);
  });

  it("accepts nested object input the same as flat-keyed input", () => {
    const nested = {
      panel: { dev: true },
      features: { submit: true, kickit: true },
    };
    const flat = {
      "panel.dev": true,
      "features.submit": true,
      "features.kickit": true,
    };
    expect(packPanelFeatures(nested, lock)).toBe(packPanelFeatures(flat, lock));
  });

  it("derives bit positions from the lock and is stable per position", () => {
    for (let i = 0; i < lock.bits.length; i++) {
      const name = lock.bits[i]!;
      const single = { [name]: true };
      expect(packPanelFeatures(single, lock)).toBe(Math.pow(2, i));
    }
  });

  it("asserts at runtime when the lock would overflow the 53-bit safe integer ceiling", () => {
    const tooMany = {
      blobs: lock.blobs,
      doubles: lock.doubles,
      bits: Array.from({ length: 54 }, (_, i) => `bit.${i}`),
    } as const;
    expect(() => packPanelFeatures({}, tooMany)).toThrow(/53/);
    expect(() => unpackPanelFeatures(0, tooMany)).toThrow(/53/);
  });

  it("ignores non-boolean truthy values (only literal `true` sets a bit)", () => {
    const fuzzy = {
      "features.submit": 1 as unknown as boolean,
      "features.protest": "yes" as unknown as boolean,
    };
    expect(packPanelFeatures(fuzzy, lock)).toBe(0);
  });
});
