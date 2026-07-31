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
