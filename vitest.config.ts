import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test environment: 'node' because this is a CLI tool, not a browser app.
    // No DOM needed — we test file system operations, CLI output, and pure logic.
    environment: "node",

    // Glob pattern for test files
    include: ["tests/**/*.test.ts"],

    // Global test utilities (describe, it, expect) without explicit imports.
    // This matches Jest's behavior and reduces boilerplate in test files.
    globals: true,

    // Code coverage configuration
    coverage: {
      provider: "v8",

      // Coverage reporters:
      // - text: printed in terminal after test run
      // - lcov: for CI tools and coverage dashboards
      // - html: for local inspection (open coverage/index.html)
      reporter: ["text", "lcov", "html"],

      // Which files to measure coverage on
      include: ["src/**/*.ts"],

      // Exclude type-only files and the CLI entrypoint from coverage
      // (CLI entrypoint is tested via integration tests)
      exclude: ["src/types/**", "src/cli.ts"],
    },
  },
});
