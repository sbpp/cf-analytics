# cf-analytics — telemetry ingest Worker

Cloudflare Worker that accepts schema-1 telemetry pings from
[SourceBans++](https://github.com/sbpp/sourcebans-pp) panels at
`https://cf-analytics-telemetry.sbpp.workers.dev/v1/ping`, validates with
[Zod](https://zod.dev), strips IP-bearing headers by construction, and writes
to [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/).

This repo is the consumer half of [sbpp/sourcebans-pp#1126](https://github.com/sbpp/sourcebans-pp/issues/1126).
Implementation is tracked in [#1](https://github.com/sbpp/cf-analytics/issues/1).

## Endpoint contract

| Method | Path       | Behaviour                                                                                                                                                           |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/v1/ping` | Validate body against the schema dispatched on `body.schema`. On success: `writeDataPoint` to AE, return `204 No Content`. On schema mismatch / parse error: `400`. |
| `GET`  | `/healthz` | `200 OK`, body `ok` (plain text). For uptime monitoring.                                                                                                            |
| `*`    | `*`        | `404`, no body. The path is not echoed.                                                                                                                             |

No CORS, no `OPTIONS` handling. Edge rate limit returns `429` before the
Worker is invoked (see below).

### Request body (schema 1)

The wire schema is defined jointly by
[sbpp/sourcebans-pp#1126](https://github.com/sbpp/sourcebans-pp/issues/1126)
and this repo's [`schema/1.lock.json`](./schema/1.lock.json). The lock file
is the positional source of truth for the AE blob/double/bit layout; the
panel issue is the source of truth for the wire field set.

```json
{
  "schema": 1,
  "instance_id": "8f6c5b…",
  "panel": {
    "version": "2.0.0",
    "git": "abc1234",
    "dev": false,
    "theme": "default"
  },
  "env": {
    "php": "8.2",
    "sapi": "fpm-fcgi",
    "db_engine": "mariadb",
    "db_version": "10.11",
    "web_server": "litespeed",
    "os_family": "linux",
    "memory_limit_mb": 256,
    "max_execution_time": 30,
    "disable_functions_count": 7,
    "zts": false,
    "php_64bit": true,
    "open_basedir_set": true,
    "allow_url_fopen": true,
    "opcache_loaded": true,
    "suhosin_loaded": false,
    "posix_available": true,
    "host_panel_cpanel": true,
    "host_panel_plesk": false,
    "host_panel_directadmin": false,
    "docroot_user_home": true,
    "sapi_per_user": true
  },
  "scale": {
    "admins": 12,
    "servers_enabled": 7,
    "bans_active": 2847,
    "bans_total": 18394,
    "comms_active": 412,
    "comms_total": 5108,
    "submissions_30d": 23,
    "protests_30d": 0
  },
  "features": {
    "submit": true,
    "protest": true,
    "comms": true,
    "kickit": false,
    "exportpublic": false,
    "publiccomments": false,
    "steamlogin": true,
    "normallogin": true,
    "groupbanning": false,
    "friendsbanning": false,
    "adminrehashing": true,
    "smtp_configured": true,
    "steam_api_key_set": true,
    "geoip_present": true
  }
}
```

Only `schema` and `instance_id` are required. Every other field is
`.optional()` in the validator (forward-compat optionality rule). Unknown
top-level keys pass through and are captured into the `extras` blob.

### Response

- `204 No Content` on success — no body.
- `400 { "error": "schema_not_supported" }` for unknown / missing / non-numeric `schema`.
- `400 { "error": "schema_invalid" }` for shape mismatches inside a known schema.
- `400 { "error": "invalid_json" }` for malformed JSON bodies.
- `404` (no body) for everything else.
- `429` from Cloudflare's edge for rate-limited clients (the Worker isn't invoked).

## Privacy / anonymity contract

The Worker MUST NOT persist or log any of the following, full stop. This is
the load-bearing trust contract from
[sbpp/sourcebans-pp#1126](https://github.com/sbpp/sourcebans-pp/issues/1126):

- `CF-Connecting-IP` / `CF-Connecting-IPv6` header values
- `X-Forwarded-For` / `X-Real-IP` header values
- `True-Client-IP` (Enterprise plan; banned to be safe)
- `CF-Pseudo-IPv4` header value
- `request.cf.city`, `request.cf.latitude`, `request.cf.longitude`,
  `request.cf.region`, `request.cf.regionCode`, `request.cf.postalCode`,
  `request.cf.metroCode`, `request.cf.timezone`
- TLS fingerprints

`request.cf.colo` (the edge node id) is allowed — it identifies our edge, not
the client.

The Worker is structured so the AE data point is built _only_ from the
validated body. Headers and `request.cf` are never read on the ingest path.
That makes "no IP data path" the default, not an opt-in. The IP-stripping
middleware ([`src/strip-ip.ts`](./src/strip-ip.ts)) is a guard rail that
documents the contract and exposes a test helper (`assertNoIpFields`) that
the IP-leak test in [`test/ip-leak.test.ts`](./test/ip-leak.test.ts) calls on
every captured `writeDataPoint` argument.

**No Logpush.** Turning on Logpush would re-introduce the IP-leak surface;
adding it later requires re-deriving this contract against the new sink.

### On dropping `scale.*` bucketing (privacy trade-off)

Schema-1 ships raw integer counts (e.g. `bans_active: 2847`) rather than the
bucketed strings (`"1k-9.9k"`) originally proposed in
[sbpp/sourcebans-pp#1126](https://github.com/sbpp/sourcebans-pp/issues/1126).

**Raw counts combined with `panel.theme`, `panel.git`, and `env.*` produce a
higher-resolution per-install fingerprint than buckets would.** The trade-off
is acceptable for this iteration because:

1. The data lives only in AE, never in logs, extracts, or row-granularity exports.
2. The IP-stripping contract is unaffected.
3. Access to AE is roadmap-decision-only — there is no public dashboard, no
   anonymous extract, no row-level API.

**Any future change that exposes row-level data (public stats page,
downloadable extracts, etc.) reopens this decision and requires a privacy
review before shipping.** The original bucketing rationale is preserved in
sbpp/sourcebans-pp#1126's history.

## Schema evolution rules

There is no auto-update for self-hosted SourceBans++ installs. Old panels
keep sending old payloads forever. The Worker accepts every schema version
it has ever shipped, in parallel with whatever the latest panel sends.

**Three evolution axes** (see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the
edit policy):

1. **Additive — panel adds a new optional field within a schema version.**
   Schema number stays at 1. The Worker's `.passthrough()` validator keeps
   the unknown key in the parsed payload, and `mapDataPoint` puts it in the
   `extras` JSON blob. Once promoted to a typed slot, the field appends to
   `lock.blobs` / `lock.doubles` at the next free position. Until promotion,
   queries reach it via `json_extract(blob<extras>, '$.new_field')`.
2. **Slot exhaustion.** Schema-1 reserves 20 blob slots and 20 double slots.
   Currently 11/20 blobs and 13/20 doubles are committed. Once an addition
   would push past the cap, the field lives permanently in `extras` until a
   schema bump. **We never reshuffle existing slot positions** — AE indexes
   are positional, and historical rows already use the current layout.
3. **Subtractive / repurposing.** Bumps the schema number. The panel sends
   `schema: 2`, the Worker dispatches to a separate validator + writer.
   Both schemas write to the same AE dataset, distinguished by the `schema`
   double. Schema-1 validators are kept indefinitely — the long-tail of
   un-upgraded installs is exactly the dataset we exist to capture.

## AE layout

Positions in the table below are **the contract**. Never reorder them. The
JSON block between the markers is byte-equal to
[`schema/1.lock.json`](./schema/1.lock.json); the layout test in
[`test/layout.test.ts`](./test/layout.test.ts) parses this block and asserts
deep-equality both directions.

<!-- ae-layout-start -->

```json
{
  "blobs": [
    "instance_id",
    "panel.version",
    "panel.git",
    "panel.theme",
    "env.php",
    "env.sapi",
    "env.os_family",
    "env.web_server",
    "env.db_engine",
    "env.db_version",
    "extras"
  ],
  "doubles": [
    "schema",
    "panel_features_bits",
    "env.memory_limit_mb",
    "env.max_execution_time",
    "env.disable_functions_count",
    "scale.admins",
    "scale.servers_enabled",
    "scale.bans_active",
    "scale.bans_total",
    "scale.comms_active",
    "scale.comms_total",
    "scale.submissions_30d",
    "scale.protests_30d"
  ],
  "bits": [
    "panel.dev",
    "features.submit",
    "features.protest",
    "features.comms",
    "features.kickit",
    "features.exportpublic",
    "features.publiccomments",
    "features.steamlogin",
    "features.normallogin",
    "features.groupbanning",
    "features.friendsbanning",
    "features.adminrehashing",
    "features.smtp_configured",
    "features.steam_api_key_set",
    "features.geoip_present",
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
    "env.sapi_per_user"
  ]
}
```

<!-- ae-layout-end -->

### Reading the layout

- `blobs[i]` is AE's `blob{i+1}` column (AE columns are 1-indexed in SQL).
  `blobs[0] = "instance_id"` therefore queries as `blob1`.
- `doubles[i]` is AE's `double{i+1}` column.
- `indexes[0]` is AE's `index1` column. The Worker indexes by
  `panel.version`, which gives bounded cardinality and is the field most
  queries filter on.
- `bits[i]` is bit `i` (LSB = 0) of the `panel_features_bits` double.
  27 booleans pack into one double (well under the 53-bit safe-integer
  ceiling), leaving 7/20 doubles free for future scale dimensions.
- Missing typed strings → `null` in the corresponding blob. Missing scale
  numbers → `null` in the corresponding double (so analysts can distinguish
  "not sent" from "zero"). Missing booleans → `0` bits in
  `panel_features_bits`. The `panel_features_bits` double is always present.
- `extras` (last blob) is `null` when there are no unknown top-level keys,
  otherwise a JSON-stringified object of every unknown top-level key. AE
  stores nothing rather than `{}` so analysts don't have to coalesce empty
  objects out.

## `featureFlag(name)` SQL macro for AE

Once a feature is in `lock.bits`, queries against AE can extract any
individual feature flag from the `panel_features_bits` double:

```sql
-- featureFlag(name): treats double2 as the packed bitfield and returns 1
-- when bit at lock.bits.indexOf(name) is set, 0 otherwise.
--
-- Replace <bit_index> with the 0-based position of `<name>` in lock.bits.
-- e.g. "features.submit" lives at index 1, so featureFlag("features.submit")
-- is `(double2 >> 1) & 1`.
SELECT
  blob2 AS panel_version,
  ((toUInt64(double2) >> 0)  & 1) AS panel_dev,
  ((toUInt64(double2) >> 1)  & 1) AS feature_submit,
  ((toUInt64(double2) >> 4)  & 1) AS feature_kickit,
  ((toUInt64(double2) >> 14) & 1) AS feature_geoip_present,
  count() AS pings
FROM telemetry
WHERE timestamp > now() - INTERVAL 7 DAY
GROUP BY panel_version, panel_dev, feature_submit, feature_kickit, feature_geoip_present
ORDER BY pings DESC;
```

The bit index for a feature name is its 0-based position in `lock.bits`. To
look up the position programmatically, see
[`src/lock.ts`](./src/lock.ts)'s `bitIndex()` helper.

### Deriving `host_kind` query-time

The `env.*` shared-hosting fingerprint signals (added in
[#3](https://github.com/sbpp/cf-analytics/issues/3)) are deliberately shipped
raw rather than collapsed into a panel-side `env.host_kind` label. The
heuristic that classifies a host as `shared` / `constrained` /
`unconstrained` is exactly the thing we want to retune as we see what real
installs look like — keeping it in SQL means tuning is a query edit, not a
panel deploy.

Bit and double indices below come straight from `schema/1.lock.json`:
`env.open_basedir_set` is bit 17, the four panel/path/SAPI corroborators
are bits 22–26, `env.memory_limit_mb` is `double3` (slot index 2),
`env.max_execution_time` is `double4` (slot index 3). If the lock file ever
changes (subject to [`CONTRIBUTING.md`](./CONTRIBUTING.md) rule 1), update
the shifts here in lockstep.

```sql
-- hostKind(): heuristic shared-vs-not classification computed query-time
-- from the env.* fingerprint signals. Tuneable without a panel/Worker
-- deploy by editing this query.
SELECT
  CASE
    WHEN ((toUInt64(double2) >> 17) & 1) = 1                       -- env.open_basedir_set
      AND (
        ((toUInt64(double2) >> 22) & 1) = 1                        -- env.host_panel_cpanel
        OR ((toUInt64(double2) >> 23) & 1) = 1                     -- env.host_panel_plesk
        OR ((toUInt64(double2) >> 24) & 1) = 1                     -- env.host_panel_directadmin
        OR ((toUInt64(double2) >> 25) & 1) = 1                     -- env.docroot_user_home
        OR ((toUInt64(double2) >> 26) & 1) = 1                     -- env.sapi_per_user
      )
      THEN 'shared'
    WHEN double3 IS NOT NULL AND double3 <= 256                    -- env.memory_limit_mb
      AND double4 IS NOT NULL AND double4 <= 60                    -- env.max_execution_time
      THEN 'constrained'
    ELSE 'unconstrained'
  END AS host_kind,
  count() AS pings
FROM telemetry
WHERE timestamp > now() - INTERVAL 7 DAY
GROUP BY host_kind
ORDER BY pings DESC;
```

Two notes on why the signals exist as they do:

- **No raw paths or `disable_functions` strings.** `DOCUMENT_ROOT` under
  cPanel/DirectAdmin contains the account username; `open_basedir`'s value
  leaks the home dir; `disable_functions` as a string is itself a host-
  provider fingerprint. Each of those is reduced to a boolean or count
  here, matching the rest of the schema's privacy posture.
- **Bits 22–26 corroborate bit 17.** `env.open_basedir_set` alone catches
  most shared hosts but also flags hardened VPS/dedicated boxes; AND-ing
  with at least one of the panel/path/SAPI signals separates the cohorts.

### Promoting an `extras` field to a typed slot

Once a panel-side field is observed often enough to promote out of `extras`,
queries that span the promotion boundary need to coalesce both sources:

```sql
SELECT
  coalesce(blob10, json_extract(blob10, '$.field_name')) AS field_name
FROM telemetry;
```

The exact column index depends on which blob the field is promoted to.
Update this README's AE-layout block (and `schema/1.lock.json`) at promotion
time so the contract stays self-documenting.

## Rate limit

The canonical deploy uses the [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
declared in [`wrangler.toml`](./wrangler.toml) as `TELEMETRY_RL`, configured
at **1 request per 10 seconds**. The `limit()` call is keyed on the
body-supplied `instance_id` rather than the source IP, deliberately:

- Keying on IP would require reading `CF-Connecting-IP`, which violates the
  "no IP data path" privacy contract enforced by [`src/strip-ip.ts`](./src/strip-ip.ts)
  and pinned by [`test/ip-leak.test.ts`](./test/ip-leak.test.ts).
- A misconfigured panel hammering the endpoint is the realistic abuse case;
  rate-limiting per-`instance_id` throttles the offending panel without
  punishing other panels behind the same NAT.
- A bad actor varying `instance_id` to bypass the per-instance limit still
  pays the full schema-validation cost on each request and writes nothing
  to AE on rejection — the Worker invocation cost is the only damage.
- Period must be 10 or 60 (the binding's only supported values); 10 matches
  the legacy WAF-rule design.

Panels ping once per 24h with ±1h jitter, so legitimate traffic stays orders
of magnitude below the threshold. The test in [`test/ping.test.ts`](./test/ping.test.ts)
pins both behaviours: 429-on-exceed without an AE write, and the
`instance_id`-as-key choice (so a future maintainer can't quietly switch the
key to `cf-connecting-ip`).

### WAF rate limit (self-hosters with their own zone)

If you fork this and own a Cloudflare zone, you can layer a WAF Rate
Limiting Rule on top for cheaper edge rejection (blocked-at-edge requests
don't invoke the Worker at all — no Workers billing, no AE write). The
Worker-runtime limit above stays in place either way.

Recommended rule expression in the Cloudflare dashboard / Terraform
(substitute your hostname):

```
(http.host eq "telemetry.example.com") and (http.request.method eq "POST") and (http.request.uri.path eq "/v1/ping")
```

- Characteristics: IP source.
- Period: 10 seconds.
- Requests: 1.
- Action: Block (or `Managed Challenge` if false-positives become a problem).

WAF rate limit rules are a per-zone feature; they are not available on
`*.workers.dev`, which is why the canonical deploy relies on the
Worker-runtime binding instead.

## Cross-repo usage

`schema/1.lock.json` is **vendored** by SourceBans++ at
`web/includes/telemetry/schema-1.lock.json` (see
[sbpp/sourcebans-pp#1126](https://github.com/sbpp/sourcebans-pp/issues/1126)).

Non-append edits to the lock file require a paired panel-side PR _before_
merge here. The append-only edit policy and the parity test are documented
in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Local dev

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run dev          # wrangler dev — local Workers runtime on :8787
```

Send a test ping:

```bash
curl -i http://127.0.0.1:8787/v1/ping \
  -H 'content-type: application/json' \
  -d '{
    "schema": 1,
    "instance_id": "test-instance-0000000000000000000000000000000000000000000000000000",
    "panel": {"version":"2.0.0","git":"abc1234","dev":false,"theme":"default"},
    "env": {"php":"8.2","sapi":"fpm-fcgi","db_engine":"mariadb","db_version":"10.11","web_server":"litespeed","os_family":"linux","memory_limit_mb":256,"max_execution_time":30,"disable_functions_count":7,"zts":false,"php_64bit":true,"open_basedir_set":true,"allow_url_fopen":true,"opcache_loaded":true,"suhosin_loaded":false,"posix_available":true,"host_panel_cpanel":true,"host_panel_plesk":false,"host_panel_directadmin":false,"docroot_user_home":true,"sapi_per_user":true},
    "scale": {"admins":1,"servers_enabled":1,"bans_active":0,"bans_total":0,"comms_active":0,"comms_total":0,"submissions_30d":0,"protests_30d":0},
    "features": {"submit":true,"protest":false,"comms":false,"kickit":false,"exportpublic":false,"publiccomments":false,"steamlogin":true,"normallogin":true,"groupbanning":false,"friendsbanning":false,"adminrehashing":false,"smtp_configured":false,"steam_api_key_set":false,"geoip_present":false}
  }'
```

Expected: `HTTP/1.1 204 No Content` and an AE write recorded in
`wrangler dev`'s log (the binding is real even in local dev — miniflare
provides an in-memory implementation).

Liveness probe:

```bash
curl http://127.0.0.1:8787/healthz
# ok
```

## Deploy

### Required GitHub Actions secrets

| Secret                  | Purpose                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Token with `Workers Scripts: Edit` and `Account Analytics: Read` scopes for this account. |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns the `cf-analytics-telemetry` Worker.                                    |

CI workflow [`./.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs
typecheck / lint / test / `wrangler deploy --dry-run` on every PR — no
secrets needed for the dry-run gate.

The deploy workflow [`./.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)
runs `wrangler deploy` on push to `main` and reads the two secrets above.

### Custom domain (optional)

The canonical deploy lives at
`https://cf-analytics-telemetry.sbpp.workers.dev` and requires no zone
wiring. If you fork this and own a Cloudflare zone, you can route a
hostname of your choosing to the Worker by editing the commented
`[[routes]]` block in [`wrangler.toml`](./wrangler.toml):

```toml
# [[routes]]
# pattern = "telemetry.example.com/*"
# zone_name = "example.com"
```

Steps:

1. Confirm `example.com` is in a Cloudflare account your deploy token can
   manage routes for, and add the `Workers Routes: Edit` zone scope to the
   token.
2. Create a `CNAME telemetry → workers.dev` (or the equivalent Workers
   custom-domain wiring).
3. Uncomment and edit the `[[routes]]` block to your hostname / zone.
4. Re-run `wrangler deploy`.
5. Verify `https://telemetry.example.com/healthz` returns `200 OK` from a
   fresh curl from outside the Cloudflare network.

## Self-hoster path

The default endpoint baked into SourceBans++ is
`https://cf-analytics-telemetry.sbpp.workers.dev/v1/ping`, but the project
is single-tenant friendly. To run your own collector:

1. Fork this repo (or just clone it; nothing is opinionated about the org).
2. Edit `wrangler.toml`: change `name`, the `dataset` if you want a separate
   AE dataset, and the (commented) `[[routes]]` block to your hostname.
3. `npm install && npm run deploy` with your own `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`.
4. Point your panel at your collector via the panel-side telemetry endpoint
   override (see [sbpp/sourcebans-pp#1126](https://github.com/sbpp/sourcebans-pp/issues/1126)
   for the override config key).

The schema lock file and IP-stripping contract are part of this repo, not
the deploy target — your collector inherits both.
