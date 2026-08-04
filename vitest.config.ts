import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@domain": r("./src/domain"),
      "@features": r("./src/features"),
      "@lib": r("./src/lib"),
      "@components": r("./src/components"),
    },
  },
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    environment: "node",
    /**
     * The default 5s is too tight for the heaviest jsdom tests once v8
     * coverage instrumentation is on: the SRF is a seven-step form and its
     * tests type into most of it, so several sat at 5-8s and failed
     * INTERMITTENTLY - green on `test:run`, red on `test:cov`. A flaky suite
     * teaches people to re-run rather than to read, which costs far more than
     * the seconds this buys back.
     */
    testTimeout: 20_000,
    /**
     * Capped deliberately. Thirteen of these files start a full PostgreSQL in
     * WASM (PGlite) and the heaviest jsdom files render a seven-step form; on
     * an 8-core / 8GB machine, one worker per core drove the box into memory
     * pressure and a jsdom test would simply stall - the 20s timeouts were
     * starvation, not slow code. Every one of them runs in well under a second
     * in isolation.
     */
    maxWorkers: 4,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.*",
        "src/**/index.ts",
        "src/**/*.d.ts",
        // Composition root: no logic, exercised by Playwright rather than unit tests.
        "src/main.tsx",
        "src/mocks/**",
        // Test-only harness; its correctness is proven by the tests that use it.
        "src/db/harness.ts",
      ],
      // CLAUDE.md Rule 1 — these gates block CI.
      thresholds: {
        // Pure business rules must be exhaustively tested.
        "src/domain/**": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
