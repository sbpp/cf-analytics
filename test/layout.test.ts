import { describe, expect, it } from "vitest";

import readme from "../README.md?raw";
import lock from "../schema/1.lock.json";

const LOCK = lock as { blobs: string[]; doubles: string[]; bits: string[] };

describe("schema/1.lock.json layout enforcement", () => {
  it("respects AE blob/double/bit bounds", () => {
    expect(LOCK.blobs.length).toBeLessThanOrEqual(20);
    expect(LOCK.doubles.length).toBeLessThanOrEqual(20);
    expect(LOCK.bits.length).toBeLessThanOrEqual(53);
  });

  it("has no duplicate names within blobs / doubles / bits", () => {
    for (const dim of ["blobs", "doubles", "bits"] as const) {
      const arr = LOCK[dim];
      const seen = new Set<string>();
      const dups: string[] = [];
      for (const name of arr) {
        if (seen.has(name)) dups.push(name);
        seen.add(name);
      }
      expect(dups, `duplicates in lock.${dim}: ${dups.join(", ")}`).toEqual([]);
    }
  });

  it("README AE-layout block is byte-equal to schema/1.lock.json", () => {
    const startMarker = "<!-- ae-layout-start -->";
    const endMarker = "<!-- ae-layout-end -->";
    const startIdx = readme.indexOf(startMarker);
    const endIdx = readme.indexOf(endMarker);
    expect(startIdx, `README missing ${startMarker}`).toBeGreaterThanOrEqual(0);
    expect(endIdx, `README missing ${endMarker}`).toBeGreaterThan(startIdx);

    const block = readme.slice(startIdx + startMarker.length, endIdx);
    const fenceMatch = block.match(/```json\s*([\s\S]*?)\s*```/);
    expect(fenceMatch, "README ae-layout block missing fenced JSON").not.toBeNull();
    const fencedJson = fenceMatch![1]!;

    const parsed = JSON.parse(fencedJson);
    expect(parsed).toEqual(LOCK);
  });
});
