import { defineConfig } from "tsup";

export default defineConfig({
  // Entry points: CLI binary and public API
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },

  // Output as ECMAScript Modules (Node 18+)
  format: ["esm"],

  // Generate TypeScript declaration files for the public API
  dts: true,

  // Do NOT split shared code into chunks.
  // For a CLI, a single self-contained file per entry is simpler and faster.
  splitting: false,

  // Generate source maps for readable stack traces
  sourcemap: true,

  // Clean dist/ before each build (prevents stale files)
  clean: true,

  // Transpile down to Node 18 (the minimum we support)
  target: "node18",

  // Prepend the Node.js shebang to the CLI output.
  // This is what lets users run `./dist/cli.js` directly or
  // what npm uses when creating the bin wrapper in node_modules/.bin/
  banner: {
    js: "#!/usr/bin/env node",
  },

  // Build-time constants. tsup replaces these identifiers with their values
  // during bundling. Faster and simpler than reading package.json at runtime.
  define: {
    RN_AUDIT_VERSION: JSON.stringify(process.env.npm_package_version ?? "0.0.0"),
  },

  // External packages that should NOT be bundled.
  // Dependencies (not devDependencies) are externalized by default in tsup.
  // We're explicit about it for clarity.
  external: [
    "commander",
    "chalk",
    "ora",
    "cli-table3",
  ],
});
