/**
 * Configuration File Discovery
 *
 * Discovers all known configuration files in the project and records
 * their absolute paths. Each file is checked for existence; if found,
 * its path is stored in the {@link ConfigFiles} object. If not found,
 * the corresponding property is `null`.
 *
 * ## Extensibility
 *
 * To add a new configuration file type:
 * 1. Add a property to the `ConfigFiles` interface in `types/project.ts`.
 * 2. Add an entry to `CONFIG_FILE_PATTERNS` in this module.
 * 3. Done — no other code changes needed.
 *
 * The discovery loop iterates over the pattern array, checks each file
 * name in priority order, and records the first match. The loop is
 * completely generic and never needs to be modified.
 *
 * @module discovery/config-finder
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ConfigFiles } from "../types/project.js";
import type { ConfigFilePattern } from "../types/discovery.js";

// ---------------------------------------------------------------------------
// Configuration file patterns
// ---------------------------------------------------------------------------

/**
 * Declares every configuration file the tool knows how to discover.
 *
 * Each entry maps a key in the {@link ConfigFiles} interface to an
 * ordered list of file names. The first file that exists on disk wins.
 * Priority order matters: `babel.config.js` takes precedence over
 * `.babelrc`, `eslint.config.mjs` (flat config) over `.eslintrc.json`
 * (legacy).
 *
 * This array is the **single source of truth** for config file discovery.
 * Update this array AND the `ConfigFiles` interface together.
 */
const CONFIG_FILE_PATTERNS: ConfigFilePattern[] = [
  {
    key: "tsconfig",
    names: ["tsconfig.json"],
  },
  {
    key: "babelConfig",
    names: ["babel.config.js", "babel.config.cjs", "babel.config.mjs", ".babelrc"],
  },
  {
    key: "metroConfig",
    names: ["metro.config.js", "metro.config.cjs", "metro.config.mjs"],
  },
  {
    key: "appJson",
    names: ["app.json"],
  },
  {
    key: "appConfig",
    names: ["app.config.js", "app.config.ts"],
  },
  {
    key: "expoEnvDts",
    names: ["expo-env.d.ts"],
  },
  {
    key: "tailwindConfig",
    names: ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs"],
  },
  {
    key: "nativewindConfig",
    names: ["nativewind.config.js", "nativewind.config.ts"],
  },
  {
    key: "eslintConfig",
    names: [
      // Flat config first (modern, preferred)
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      // Legacy config (still widely used)
      ".eslintrc.js",
      ".eslintrc.json",
      ".eslintrc.yaml",
      ".eslintrc.yml",
    ],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all known configuration files in the project.
 *
 * For each config file pattern, checks each possible file name in priority
 * order. The first file that exists on disk is recorded. If no file matches,
 * the config property is `null`.
 *
 * `package.json` is always present — the validator already confirmed it
 * exists and is parseable. Its path is recorded unconditionally.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @returns A fully populated {@link ConfigFiles} object.
 */
export function discoverConfigFiles(projectRoot: string): ConfigFiles {
  // Initialize all config values to null.
  // packageJson is always present (validated earlier in the pipeline).
  // We build the result object dynamically from the pattern array.
  const configFiles: Record<string, string | null> = {
    packageJson: resolve(projectRoot, "package.json"),
  };

  // Initialize all pattern keys to null
  for (const pattern of CONFIG_FILE_PATTERNS) {
    configFiles[pattern.key] = null;
  }

  // Check each file pattern in priority order
  for (const pattern of CONFIG_FILE_PATTERNS) {
    for (const fileName of pattern.names) {
      const fullPath = resolve(projectRoot, fileName);

      if (existsSync(fullPath)) {
        configFiles[pattern.key] = fullPath;
        break; // First match wins — stop checking lower-priority names
      }
    }
  }

  // The ConfigFiles type is enforced by the return type annotation.
  // We use `as unknown as ConfigFiles` because TypeScript can't verify
  // that our dynamic object construction matches the interface shape,
  // but the CONFIG_FILE_PATTERNS array guarantees it.
  return configFiles as unknown as ConfigFiles;
}
