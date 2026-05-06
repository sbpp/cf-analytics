import { lock as defaultLock, TYPED_TOP_LEVEL_KEYS, type SchemaLock } from "./lock";
import { packPanelFeatures } from "./features";

/**
 * Canonical AE data point shape produced by `mapDataPoint`. We model `null`
 * for missing values explicitly — the AE binding's TypeScript signature for
 * `doubles` is `number[]` (no null), but Cloudflare's runtime accepts and
 * persists `null` as a missing-value marker, which is what the issue's
 * acceptance criteria require for absent scale fields.
 */
export interface MappedDataPoint {
  indexes: (string | null)[];
  blobs: (string | null)[];
  doubles: (number | null)[];
}

/**
 * Walk a dotted path and return the leaf value, or `undefined` if any segment
 * is missing.
 */
function readPath(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  let cursor: unknown = obj;
  for (const seg of segments) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

/**
 * Collect every top-level key in `payload` that is NOT a defined typed field
 * (`schema`, `instance_id`, `panel`, `env`, `scale`, `features`) into a plain
 * object. Used to populate the `extras` blob for forward-compat.
 */
function collectExtras(payload: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (payload === null || typeof payload !== "object") return out;
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (TYPED_TOP_LEVEL_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Map a validated schema-1 payload to the AE data point in canonical form.
 *
 * Positions are read out of `lock` rather than hardcoded. The lock file is
 * append-only by contract (see CONTRIBUTING.md), so the position-to-name
 * binding is stable and historical AE rows stay queryable.
 *
 * Edge cases:
 * - Missing typed string fields → `null` (AE accepts `null` in blobs).
 * - Missing scale numbers → `null` (the issue's acceptance criteria require
 *   `null` rather than `0` so analysts can distinguish "not sent" from "zero").
 * - `panel_features_bits` is always present and defaults to `0`.
 * - `extras` blob is `null` when there are no unknown top-level keys, so AE
 *   stores nothing rather than an empty-object literal that would have to be
 *   coalesced away in queries.
 */
export function mapDataPoint(
  payload: Record<string, unknown>,
  lock: SchemaLock = defaultLock,
): MappedDataPoint {
  const blobs: (string | null)[] = lock.blobs.map((slot) => {
    if (slot === "extras") {
      const extras = collectExtras(payload);
      return Object.keys(extras).length === 0 ? null : JSON.stringify(extras);
    }
    const value = readPath(payload, slot);
    if (value === undefined || value === null) return null;
    return String(value);
  });

  const doubles: (number | null)[] = lock.doubles.map((slot) => {
    if (slot === "schema") {
      const v = (payload as Record<string, unknown>)["schema"];
      return typeof v === "number" ? v : null;
    }
    if (slot === "panel_features_bits") {
      // Always present, default 0 even when payload.features is missing.
      return packPanelFeatures(payload, lock);
    }
    const value = readPath(payload, slot);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });

  const versionRaw = readPath(payload, "panel.version");
  const indexValue = typeof versionRaw === "string" ? versionRaw : "";
  const indexes: (string | null)[] = [indexValue];

  return { indexes, blobs, doubles };
}

/**
 * Minimal binding shape — narrower than `AnalyticsEngineDataset` from
 * `@cloudflare/workers-types` so tests can mock it without dragging the full
 * type in.
 */
export interface AnalyticsEngineLike {
  writeDataPoint(point: {
    indexes?: (string | null)[];
    blobs?: (string | null)[];
    doubles?: number[];
  }): void;
}

/**
 * Write a mapped data point to the AE binding. Splitting this out from
 * `mapDataPoint` keeps `mapDataPoint` pure (snapshot-testable) and isolates
 * the type-cast we need to bridge our `(number|null)[]` model to the AE
 * binding's stricter `number[]` signature.
 */
export function writeDataPoint(binding: AnalyticsEngineLike, point: MappedDataPoint): void {
  binding.writeDataPoint({
    indexes: point.indexes,
    blobs: point.blobs,
    // The AE runtime accepts `null` in doubles to mean "missing", but the
    // generated TS signature only declares `number[]`. Cast at the binding
    // boundary so the in-Worker model can stay honest.
    doubles: point.doubles as unknown as number[],
  });
}
