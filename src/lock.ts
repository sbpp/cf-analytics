import lockJson from "../schema/1.lock.json";

/**
 * Typed reader for `schema/1.lock.json`. The lock file is the positional
 * source of truth for the AE blob/double/bit layout — every position is part
 * of the on-the-wire contract and must never be reordered (see CONTRIBUTING.md).
 *
 * Importing the JSON file (rather than re-declaring the constants) keeps a
 * single source of truth that the layout test asserts against.
 */
export interface SchemaLock {
  readonly blobs: readonly string[];
  readonly doubles: readonly string[];
  readonly bits: readonly string[];
}

export const lock: SchemaLock = lockJson as SchemaLock;

/** Top-level keys the schema-1 validator promotes to typed AE slots. */
export const TYPED_TOP_LEVEL_KEYS: readonly string[] = [
  "schema",
  "instance_id",
  "panel",
  "env",
  "scale",
  "features",
];

/** Position of a named slot in `lock.blobs`; throws if missing. */
export function blobIndex(name: string): number {
  const i = lock.blobs.indexOf(name);
  if (i < 0) throw new Error(`unknown blob slot: ${name}`);
  return i;
}

/** Position of a named slot in `lock.doubles`; throws if missing. */
export function doubleIndex(name: string): number {
  const i = lock.doubles.indexOf(name);
  if (i < 0) throw new Error(`unknown double slot: ${name}`);
  return i;
}

/** Position of a named slot in `lock.bits`; throws if missing. */
export function bitIndex(name: string): number {
  const i = lock.bits.indexOf(name);
  if (i < 0) throw new Error(`unknown bit slot: ${name}`);
  return i;
}
