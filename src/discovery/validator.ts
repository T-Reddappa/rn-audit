/**
 * Project Validator
 *
 * Validates that a discovered project root contains a supported React Native
 * or Expo project. This is the second step of the discovery pipeline, called
 * immediately after the root finder locates the project root.
 *
 * ## What validation checks
 *
 * 1. **Dependency presence**: `react-native` or `expo` must be declared as
 *    a dependency. This is a double-check — the root finder already verified
 *    this, but the validator re-checks it with better error reporting.
 *
 * 2. **Version compatibility**: The installed React Native version must be
 *    within our supported range.
 *
 * 3. **Framework exclusion**: Projects that match unsupported patterns
 *    (e.g., Next.js with react-native-web) are rejected with a specific
 *    reason.
 *
 * ## Extensibility
 *
 * To add support for a new framework or project type:
 * 1. Add the detection logic to this module.
 * 2. If the framework is supported, return `{ isSupported: true }`.
 * 3. If unsupported, return a `{ isSupported: false, reason }` object.
 *
 * No other modules need to change. The orchestrator passes the validation
 * result to the Project Model.
 *
 * @module discovery/validator
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NotReactNativeProjectError } from "./errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum supported React Native version.
 *
 * React Native 0.71 was the first version to be TypeScript-first and
 * the template structure changed significantly. We may support earlier
 * versions in the future, but 0.71 is the baseline for Phase 1.
 */
const MINIMUM_REACT_NATIVE_VERSION = { major: 0, minor: 71, patch: 0 };

/**
 * Known frameworks that are NOT React Native projects but might have
 * `react-native` in their dependencies (typically for react-native-web).
 *
 * When a project has one of these frameworks as a primary dependency
 * AND react-native as a secondary dependency, it's likely a web app
 * using react-native-web, not a React Native project.
 */
const NON_RN_FRAMEWORKS = new Set([
  "next", // Next.js
  "nuxt", // Nuxt.js
  "remix", // Remix
  "@sveltejs/kit", // SvelteKit
  "gatsby", // Gatsby
  "astro", // Astro
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of project validation.
 */
export interface ValidationResult {
  /** Whether rn-audit can audit this project. */
  isSupported: boolean;

  /**
   * If unsupported, the human-readable reason why.
   * `undefined` when the project is supported.
   */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that a project root is a supported React Native project.
 *
 * This function performs a series of checks, each of which can reject
 * the project. Checks are ordered from cheapest (no file I/O) to most
 * expensive (version parsing) so that failures happen fast.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns A validation result indicating support status.
 * @throws {NotReactNativeProjectError} If the project lacks RN dependencies.
 * @throws {UnsupportedProjectError} If the project is explicitly unsupported.
 */
export function validateProject(projectRoot: string): ValidationResult {
  const pkgPath = resolve(projectRoot, "package.json");

  // Parse package.json. If it fails here, the root finder shouldn't have
  // accepted this directory. But we double-check for safety.
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  } catch {
    throw new NotReactNativeProjectError(projectRoot);
  }

  const dependencies = asRecord(pkg["dependencies"]);
  const devDependencies = asRecord(pkg["devDependencies"]);
  const peerDependencies = asRecord(pkg["peerDependencies"]);

  // --- Check 1: Is react-native or expo declared? ---
  const hasReactNative =
    "react-native" in dependencies ||
    "react-native" in devDependencies ||
    "react-native" in peerDependencies;

  const hasExpo = "expo" in dependencies || "expo" in devDependencies || "expo" in peerDependencies;

  if (!hasReactNative && !hasExpo) {
    throw new NotReactNativeProjectError(projectRoot);
  }

  // --- Check 2: Is this a web framework masquerading as RN? ---
  const allDeps = { ...dependencies, ...devDependencies, ...peerDependencies };

  for (const framework of NON_RN_FRAMEWORKS) {
    if (framework in allDeps) {
      return {
        isSupported: false,
        reason:
          `Project uses "${framework}" which is a web framework. ` +
          "rn-audit only supports React Native and Expo projects. " +
          "If this is a React Native project with a web target, " +
          "please file an issue so we can add support.",
      };
    }
  }

  // --- Check 3: Is the React Native version supported? ---
  if (hasReactNative) {
    const rnVersion = allDeps["react-native"];

    if (rnVersion && typeof rnVersion === "string") {
      const versionCheck = checkReactNativeVersion(rnVersion);

      if (!versionCheck.supported) {
        return {
          isSupported: false,
          reason: versionCheck.reason ?? "Unsupported React Native version.",
        };
      }
    }
    // If rnVersion is undefined or not a string, we're lenient —
    // workspace protocols (like "workspace:*") or file: dependencies
    // are trusted and will be validated when the version is resolved.
  }

  // --- Check 4: Expo-specific validation ---
  if (hasExpo) {
    // Check for app.json or app.config.* existence for Expo projects.
    // An Expo project without either is suspicious (it may be a library
    // that depends on expo but isn't an Expo app).
    // This is a soft check — we don't reject, we just note it.
    // We only validate that Expo SDK version is parseable.
    const expoVersion = allDeps["expo"];

    if (expoVersion && typeof expoVersion === "string") {
      // Parse the semver range to extract a minimum version.
      // Expo SDK versions are typically ~52.0.0 or ^52.0.0.
      const cleaned = expoVersion.replace(/^[\^~>=<]+/, "");
      const parts = cleaned.split(".").map(Number);

      // We require at least Expo SDK 49+ (Phase 1 baseline)
      if (parts[0] !== undefined && !isNaN(parts[0]) && parts[0] < 49) {
        return {
          isSupported: false,
          reason:
            `Expo SDK ${cleaned} is not supported. ` + "rn-audit requires Expo SDK 49 or later.",
        };
      }
    }
  }

  return { isSupported: true };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely cast an unknown value to a Record, returning an empty object
 * if the value is not a plain object.
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Check whether a React Native semver range meets our minimum version.
 *
 * Handles the common semver range prefixes: `^`, `~`, `>=`, `>`, `=`.
 * Complex ranges (like `>=0.71.0 <0.77.0`) are simplified to the lower
 * bound for Phase 1.
 */
function checkReactNativeVersion(semverRange: string): { supported: boolean; reason?: string } {
  // Strip semver range prefix characters
  const cleaned = semverRange.replace(/^[\^~>=<]+/, "");

  // Handle file: and workspace: protocols — we can't validate these
  if (semverRange.startsWith("file:") || semverRange.startsWith("workspace:")) {
    return { supported: true }; // Trust it and validate at runtime
  }

  // Handle URL-based and git-based dependencies
  if (semverRange.startsWith("http") || semverRange.startsWith("git")) {
    return { supported: true };
  }

  const parts = cleaned.split(".");
  const major = parts[0] !== undefined ? parseInt(parts[0], 10) : 0;
  const minor = parts[1] !== undefined ? parseInt(parts[1], 10) : 0;

  if (isNaN(major) || isNaN(minor)) {
    // Can't parse — be lenient. The project will either work or fail
    // at the parsing stage with a more specific error.
    return { supported: true };
  }

  if (
    major < MINIMUM_REACT_NATIVE_VERSION.major ||
    (major === MINIMUM_REACT_NATIVE_VERSION.major && minor < MINIMUM_REACT_NATIVE_VERSION.minor)
  ) {
    return {
      supported: false,
      reason:
        `React Native ${major}.${minor} is below the minimum supported ` +
        `version (${MINIMUM_REACT_NATIVE_VERSION.major}.${MINIMUM_REACT_NATIVE_VERSION.minor}). ` +
        "Please upgrade to a newer version of React Native.",
    };
  }

  return { supported: true };
}
