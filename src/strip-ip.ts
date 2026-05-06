import type { MiddlewareHandler } from "hono";

/**
 * Headers and `request.cf` fields the Worker is contractually forbidden to
 * persist or log. The list mirrors the anonymity contract in sbpp/cf-analytics#1
 * and the panel's privacy guarantee in sbpp/sourcebans-pp#1126.
 *
 * `cf.colo` is intentionally absent — that's our edge node, not the client's
 * location, so it's safe to read.
 */
export const BANNED_HEADERS: readonly string[] = [
  "cf-connecting-ip",
  "cf-connecting-ipv6",
  "x-forwarded-for",
  "x-real-ip",
  "true-client-ip",
  "cf-pseudo-ipv4",
];

/** `request.cf` field names that resolve to client-identifying location data. */
export const BANNED_CF_FIELDS: readonly string[] = [
  "city",
  "latitude",
  "longitude",
  "region",
  "regionCode",
  "postalCode",
  "metroCode",
  "timezone",
  "tlsClientHelloLength",
  "tlsClientRandom",
  "tlsExportedAuthenticator",
];

/**
 * IP-stripping middleware. The Worker is structured so the AE data point is
 * built _only_ from the validated body — never from headers or `request.cf`.
 * That makes "no IP data path" the default; this middleware exists to make
 * that contract explicit and to give the IP-leak test a single boundary to
 * reason about.
 *
 * The middleware itself does not mutate the request — Hono / Workers do not
 * let user code rewrite the inbound `Request` headers in place anyway. What
 * it _does_ do is pass through to `next()` without ever touching banned
 * headers or banned `cf` fields. The route handler that follows is similarly
 * forbidden from reading those.
 *
 * If a future contributor adds code that reads, e.g., `c.req.header(...)`
 * with a banned header name, the IP-leak test will catch the leak at CI
 * time. The combination of structural construction and the leak test is the
 * load-bearing safeguard.
 */
export const stripIp: MiddlewareHandler = async (_c, next) => {
  await next();
};

/** Reads `request.cf.colo` (the edge node id) safely; returns null if unavailable. */
export function getEdgeColo(request: Request): string | null {
  const cf = (request as unknown as { cf?: { colo?: unknown } }).cf;
  if (!cf || typeof cf !== "object") return null;
  const colo = cf.colo;
  return typeof colo === "string" ? colo : null;
}

/**
 * Test helper: throws if `record` (typically a serialised AE data point or log
 * line) contains any value from a banned header / `cf` field. The matcher is
 * structural: it walks the record recursively and asserts no string value
 * starts with or equals any of the supplied IP-bearing literals.
 *
 * Designed to be cheap and obviously correct so the IP-leak test can call it
 * on every captured `writeDataPoint` argument without ceremony.
 */
export function assertNoIpFields(record: unknown, bannedLiterals: readonly string[]): void {
  const haystack = JSON.stringify(record ?? null);
  for (const needle of bannedLiterals) {
    if (haystack.includes(needle)) {
      throw new Error(`IP-leak: record contains forbidden literal ${JSON.stringify(needle)}`);
    }
  }
}
