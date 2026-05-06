import type { SchemaLock } from "./lock";

const MAX_SAFE_BITS = 53;

/**
 * Read a dotted path (e.g. `"panel.dev"` or `"features.submit"`) out of an
 * arbitrary object tree. Returns `undefined` if any segment is missing.
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
 * Accept either a flat-keyed object (`{ "features.submit": true, ... }`) or a
 * nested object tree (`{ features: { submit: true } }`). Returns whatever the
 * caller meant for `path`, preferring the flat key if both are present.
 */
function readFlatOrNested(input: unknown, path: string): unknown {
  if (input === null || typeof input !== "object") return undefined;
  const flat = (input as Record<string, unknown>)[path];
  if (flat !== undefined) return flat;
  return readPath(input, path);
}

/**
 * Pack the boolean inputs named in `lock.bits` into a single number, where
 * bit `i` is set iff `lock.bits[i]` is truthy in `input`. Missing keys = 0.
 *
 * `input` may be flat-keyed (`"panel.dev": true`) or nested (`{ panel: { dev: true } }`).
 */
export function packPanelFeatures(input: unknown, lock: SchemaLock): number {
  if (lock.bits.length > MAX_SAFE_BITS) {
    throw new Error(
      `lock.bits.length=${lock.bits.length} exceeds safe-integer ceiling of ${MAX_SAFE_BITS}`,
    );
  }
  let bits = 0;
  for (let i = 0; i < lock.bits.length; i++) {
    const name = lock.bits[i]!;
    const value = readFlatOrNested(input, name);
    if (value === true) {
      bits += Math.pow(2, i);
    }
  }
  return bits;
}

/**
 * Reverse `packPanelFeatures`. Returns a flat-keyed object whose keys are
 * exactly `lock.bits`, with each value the boolean state of that bit.
 */
export function unpackPanelFeatures(bitsValue: number, lock: SchemaLock): Record<string, boolean> {
  if (lock.bits.length > MAX_SAFE_BITS) {
    throw new Error(
      `lock.bits.length=${lock.bits.length} exceeds safe-integer ceiling of ${MAX_SAFE_BITS}`,
    );
  }
  const out: Record<string, boolean> = {};
  for (let i = 0; i < lock.bits.length; i++) {
    const name = lock.bits[i]!;
    out[name] = (Math.floor(bitsValue / Math.pow(2, i)) & 1) === 1;
  }
  return out;
}
