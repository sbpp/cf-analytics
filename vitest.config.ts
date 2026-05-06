import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * vitest config for `@cloudflare/vitest-pool-workers` 0.16+ (vitest 4 plugin
 * pattern). The `main` option points pool-workers at the same fetch handler
 * that ships to Cloudflare, so `import worker from "../src"` and the runtime's
 * `exports.default` resolve to the exact same instance during tests.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      wrangler: {
        configPath: "./wrangler.toml",
      },
    }),
  ],
});
