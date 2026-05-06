import { z, type ZodType } from "zod";

/**
 * Schema-1 wire payload. See sbpp/sourcebans-pp#1126 and `schema/1.lock.json`
 * for the locked field set.
 *
 * The optionality rule: only `schema` and `instance_id` are required. Every
 * other field is `.optional()` so a panel rolling out a new field doesn't
 * desync ahead of a not-yet-redeployed Worker, and a Worker rolling out
 * validation for a field that older panels don't send doesn't reject those
 * older installs.
 *
 * The top-level object uses `.passthrough()` so unknown keys aren't stripped —
 * the Worker preserves them into the `extras` blob for forward compatibility.
 */
const schema1Panel = z
  .object({
    version: z.string().optional(),
    git: z.string().optional(),
    dev: z.boolean().optional(),
    theme: z.string().optional(),
  })
  .passthrough();

const schema1Env = z
  .object({
    php: z.string().optional(),
    db_engine: z.string().optional(),
    db_version: z.string().optional(),
    web_server: z.string().optional(),
    os_family: z.string().optional(),
  })
  .passthrough();

const schema1Scale = z
  .object({
    admins: z.number().optional(),
    servers_enabled: z.number().optional(),
    bans_active: z.number().optional(),
    bans_total: z.number().optional(),
    comms_active: z.number().optional(),
    comms_total: z.number().optional(),
    submissions_30d: z.number().optional(),
    protests_30d: z.number().optional(),
  })
  .passthrough();

const schema1Features = z
  .object({
    submit: z.boolean().optional(),
    protest: z.boolean().optional(),
    comms: z.boolean().optional(),
    kickit: z.boolean().optional(),
    exportpublic: z.boolean().optional(),
    publiccomments: z.boolean().optional(),
    steamlogin: z.boolean().optional(),
    normallogin: z.boolean().optional(),
    groupbanning: z.boolean().optional(),
    friendsbanning: z.boolean().optional(),
    adminrehashing: z.boolean().optional(),
    smtp_configured: z.boolean().optional(),
    steam_api_key_set: z.boolean().optional(),
    geoip_present: z.boolean().optional(),
  })
  .passthrough();

export const schema1 = z
  .object({
    schema: z.literal(1),
    instance_id: z.string().min(1),
    panel: schema1Panel.optional(),
    env: schema1Env.optional(),
    scale: schema1Scale.optional(),
    features: schema1Features.optional(),
  })
  .passthrough();

export type Schema1 = z.infer<typeof schema1>;

/**
 * Schema-version dispatch table. Adding a new schema version is a one-file
 * change: implement `schemaN`, register it here, and write its
 * `mapDataPoint`-equivalent in `src/ae.ts`.
 *
 * `schema: 0` deliberately has no entry; per the issue, schema-0 is rejected
 * with `400`. Likewise `schema: 2` until that schema is actually defined.
 */
export const validators: Record<number, ZodType<unknown>> = {
  1: schema1,
};

/** Thrown by `validate()` when `body.schema` is missing, non-numeric, or unknown. */
export class SchemaDispatchError extends Error {
  constructor(public readonly received: unknown) {
    super(`schema_not_supported: ${JSON.stringify(received)}`);
    this.name = "SchemaDispatchError";
  }
}

/**
 * Dispatch on `body.schema` and validate against the matching schema. Throws
 * `SchemaDispatchError` for unknown schemas (including `schema: 0`, `schema: 2`,
 * missing, or non-numeric). Throws `ZodError` for shape mismatches.
 */
export function validate(body: unknown): unknown {
  const schemaNum =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)["schema"]
      : undefined;
  if (typeof schemaNum !== "number" || !Number.isFinite(schemaNum)) {
    throw new SchemaDispatchError(schemaNum);
  }
  const v = validators[schemaNum];
  if (!v) throw new SchemaDispatchError(schemaNum);
  return v.parse(body);
}
