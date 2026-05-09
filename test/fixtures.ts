import type { AnalyticsEngineLike } from "../src/ae";

/**
 * Canonical schema-1 payload — byte-for-byte the example body in
 * sbpp/cf-analytics#1 and sbpp/sourcebans-pp#1126. Snapshot tests pin
 * `mapDataPoint(canonicalPayload)` against this so any unintended layout
 * drift fails CI loudly.
 */
export const canonicalPayload = {
  schema: 1 as const,
  instance_id: "8f6c5b0000000000000000000000000000000000000000000000000000000000",
  panel: {
    version: "2.0.0",
    git: "abc1234",
    dev: false,
    theme: "default",
  },
  env: {
    php: "8.2",
    sapi: "fpm-fcgi",
    db_engine: "mariadb",
    db_version: "10.11",
    web_server: "litespeed",
    os_family: "linux",
    memory_limit_mb: 256,
    max_execution_time: 30,
    disable_functions_count: 7,
    zts: false,
    php_64bit: true,
    open_basedir_set: true,
    allow_url_fopen: true,
    opcache_loaded: true,
    suhosin_loaded: false,
    posix_available: true,
    host_panel_cpanel: true,
    host_panel_plesk: false,
    host_panel_directadmin: false,
    docroot_user_home: true,
    sapi_per_user: true,
  },
  scale: {
    admins: 12,
    servers_enabled: 7,
    bans_active: 2847,
    bans_total: 18394,
    comms_active: 412,
    comms_total: 5108,
    submissions_30d: 23,
    protests_30d: 0,
  },
  features: {
    submit: true,
    protest: true,
    comms: true,
    kickit: false,
    exportpublic: false,
    publiccomments: false,
    steamlogin: true,
    normallogin: true,
    groupbanning: false,
    friendsbanning: false,
    adminrehashing: true,
    smtp_configured: true,
    steam_api_key_set: true,
    geoip_present: true,
  },
};

/** Captured `writeDataPoint` argument shape, narrowed for test ergonomics. */
export interface RecordedDataPoint {
  indexes?: (string | null)[];
  blobs?: (string | null)[];
  doubles?: number[];
}

/**
 * Mock AE binding that records every `writeDataPoint` call. Tests use this
 * instead of the real binding so they can inspect what the Worker would have
 * written to AE.
 */
export interface MockTelemetry extends AnalyticsEngineLike {
  calls: RecordedDataPoint[];
  reset(): void;
}

export function makeMockTelemetry(): MockTelemetry {
  const calls: RecordedDataPoint[] = [];
  return {
    calls,
    reset() {
      calls.length = 0;
    },
    writeDataPoint(point) {
      // Deep-clone so later mutations to the source object can't lie to assertions.
      calls.push(JSON.parse(JSON.stringify(point)) as RecordedDataPoint);
    },
  };
}

/** Build the env object passed to `worker.fetch(req, env, ctx)` in tests. */
export function makeEnv(): { TELEMETRY: MockTelemetry } {
  return { TELEMETRY: makeMockTelemetry() };
}
