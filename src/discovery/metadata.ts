/**
 * Metadata Extractor
 *
 * Reads and processes the project's package.json to extract structured
 * metadata: version numbers, dependencies, package manager detection,
 * and engine requirements.
 *
 * ## Version cleaning
 *
 * package.json stores semver ranges (e.g., `"^0.76.0"`, `"~52.0.0"`).
 * The ProjectModel stores cleaned versions (e.g., `"0.76.0"`, `"52.0.0"`).
 * The cleaning function strips range operators while preserving the
 * version number. Complex ranges (e.g., `">=0.71.0 <0.77.0"`) are
 * simplified to the first version in the range.
 *
 * ## Package manager detection
 *
 * Detected from lock files, NOT from the `packageManager` field:
 * - `package-lock.json` → npm
 * - `yarn.lock` → yarn
 * - `pnpm-lock.yaml` → pnpm
 *
 * The `packageManager` field in package.json is a Corepack hint and may
 * not reflect what the project *actually* uses. The lock file is ground truth.
 *
 * @module discovery/metadata
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PackageManager } from "../types/project.js";
import { InvalidConfigurationError } from "./errors.js";
import type { RawPackageMetadata } from "../types/discovery.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * All metadata extracted from the project, ready to be merged into the
 * {@link ProjectModel}.
 */
export interface ExtractedMetadata {
  name: string;
  version: string;
  reactNativeVersion: string | null;
  expoVersion: string | null;
  reactVersion: string | null;
  typescriptVersion: string | null;
  nodeEngine: string | null;
  packageManager: PackageManager;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

/**
 * Extract all metadata from the project's package.json and lock files.
 *
 * This is the single place where package.json is read and parsed during
 * discovery. Every other module receives already-extracted data.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns Structured metadata ready for the ProjectModel.
 * @throws {InvalidConfigurationError} If package.json is malformed.
 */
export function extractMetadata(projectRoot: string): ExtractedMetadata {
  const pkgPath = resolve(projectRoot, "package.json");

  // --- Parse package.json ---
  let raw: RawPackageMetadata;
  try {
    const content = readFileSync(pkgPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    raw = {
      name: asString(parsed["name"], "unknown"),
      version: asString(parsed["version"], "0.0.0"),
      dependencies: asRecord(parsed["dependencies"]),
      devDependencies: asRecord(parsed["devDependencies"]),
      peerDependencies: asRecord(parsed["peerDependencies"]),
      engines: asRecord(parsed["engines"]),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InvalidConfigurationError(
        projectRoot,
        "package.json",
        `Failed to parse JSON: ${error.message}`,
      );
    }
    throw error;
  }

  // --- Merge all dependency sources for version lookups ---
  // Some projects put react-native in devDependencies (workspace roots),
  // others in dependencies (normal projects), others in peerDependencies
  // (libraries). We check all three.
  const allDeps = {
    ...raw.devDependencies,
    ...raw.peerDependencies,
    ...raw.dependencies, // dependencies last — highest priority
  };

  // --- Extract version numbers ---
  const reactNativeVersion = extractVersion(allDeps["react-native"]);
  const expoVersion = extractVersion(allDeps["expo"]);
  const reactVersion = extractVersion(allDeps["react"]);
  const typescriptVersion = extractVersion(
    raw.devDependencies["typescript"] ?? allDeps["typescript"],
  );

  // --- Extract Node engine requirement ---
  const nodeEngine = raw.engines["node"]
    ? String(raw.engines["node"])
    : null;

  // --- Detect package manager ---
  const packageManager = detectPackageManager(projectRoot);

  return {
    name: raw.name,
    version: raw.version,
    reactNativeVersion,
    expoVersion,
    reactVersion,
    typescriptVersion,
    nodeEngine,
    packageManager,
    dependencies: raw.dependencies,
    devDependencies: raw.devDependencies,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Clean a semver range string to extract the version number.
 *
 * Examples:
 * - `"^0.76.0"` → `"0.76.0"`
 * - `"~52.0.0"` → `"52.0.0"`
 * - `">=0.71.0"` → `"0.71.0"`
 * - `"workspace:*"` → `null` (can't resolve)
 * - `"file:../react-native"` → `null`
 * - `undefined` → `null`
 *
 * @param semverRange - Raw semver range from package.json, or undefined.
 * @returns The cleaned version string, or null if it can't be determined.
 */
function extractVersion(semverRange: string | undefined): string | null {
  if (!semverRange) return null;

  // Non-semver protocols can't be resolved to a version number
  if (
    semverRange.startsWith("workspace:") ||
    semverRange.startsWith("file:") ||
    semverRange.startsWith("link:") ||
    semverRange.startsWith("git") ||
    semverRange.startsWith("http")
  ) {
    return null;
  }

  // Strip range operators: ^, ~, >=, <=, >, <, =
  const cleaned = semverRange.replace(/^[\^~>=<=\s]+/, "");

  // If the result contains a space, it's a compound range like
  // ">=0.71.0 <0.77.0". Take the first version.
  const firstVersion = cleaned.split(/\s+/)[0];

  return firstVersion || null;
}

/**
 * Detect the package manager from lock files.
 *
 * Check order: pnpm → yarn → npm (npm is the default).
 * pnpm and yarn are checked first because their lock files are more
 * distinctive. npm's `package-lock.json` is the fallback.
 */
function detectPackageManager(projectRoot: string): PackageManager {
  if (existsSync(resolve(projectRoot, "pnpm-lock.yaml"))) {
    return PackageManager.Pnpm;
  }

  if (existsSync(resolve(projectRoot, "yarn.lock"))) {
    return PackageManager.Yarn;
  }

  if (existsSync(resolve(projectRoot, "package-lock.json"))) {
    return PackageManager.Npm;
  }

  return PackageManager.Unknown;
}

// ---------------------------------------------------------------------------
// Type coercion helpers
// ---------------------------------------------------------------------------

/** Safely cast unknown to string, with a default fallback. */
function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Safely cast unknown to Record, returning empty object for non-objects. */
function asRecord(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (typeof val === "string") {
        result[key] = val;
      }
    }
    return result;
  }
  return {};
}
