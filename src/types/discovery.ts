/**
 * Discovery Subsystem Types
 *
 * Types used by the discovery pipeline internally. Consumers of the
 * {@link ProjectModel} (scanner, parser, engine, reporter) should not
 * need to import from this module.
 *
 * Separated from `project.ts` to keep the Project Model pure — it describes
 * the output (what was found), not the process (how it was found).
 *
 * @module types/discovery
 */

import type { ProjectFramework, ExpoWorkflow } from "./project.js";

// ---------------------------------------------------------------------------
// Discovery options
// ---------------------------------------------------------------------------

/**
 * Options controlling the project discovery process.
 *
 * All fields are optional — sensible defaults are used when omitted.
 * CLI flags in future milestones will map to these options.
 */
export interface DiscoveryOptions {
  /**
   * Starting directory for project discovery.
   * Defaults to `process.cwd()` when not specified.
   *
   * Must be an absolute path. If a relative path is provided, the
   * discovery function resolves it against the current working directory.
   */
  cwd?: string;

  /**
   * Explicit project root path. When provided, skips the root-finding
   * walk and uses this directory directly.
   *
   * Useful for CI environments where the project root is known ahead
   * of time, or when the user specifies `--config <path>` and we can
   * infer the root from the config file location.
   *
   * Must be an absolute path.
   */
  projectRoot?: string;
}

// ---------------------------------------------------------------------------
// Discovery error codes
// ---------------------------------------------------------------------------

/**
 * Machine-readable error codes for discovery failures.
 *
 * Each code corresponds to a specific failure mode. The CLI layer maps
 * these to user-facing error messages. Programmatic consumers can
 * switch on the code to handle specific failures differently.
 */
export enum DiscoveryErrorCode {
  /** No package.json found in the current directory or any parent. */
  NO_PACKAGE_JSON = "NO_PACKAGE_JSON",

  /**
   * A package.json was found, but it does not contain `react-native`
   * or `expo` in dependencies, devDependencies, or peerDependencies.
   */
  NOT_A_REACT_NATIVE_PROJECT = "NOT_A_REACT_NATIVE_PROJECT",

  /**
   * The project type was detected but is explicitly unsupported.
   * Example: a Next.js project that also has react-native installed
   * (for react-native-web) but is not a React Native project.
   */
  UNSUPPORTED_PROJECT_TYPE = "UNSUPPORTED_PROJECT_TYPE",

  /**
   * A required configuration file is malformed or unreadable.
   * Example: package.json exists but is not valid JSON.
   */
  INVALID_CONFIGURATION = "INVALID_CONFIGURATION",

  /**
   * A file that should exist could not be read due to permissions.
   */
  PERMISSION_DENIED = "PERMISSION_DENIED",
}

// ---------------------------------------------------------------------------
// Internal: type detection
// ---------------------------------------------------------------------------

/**
 * The result of the project type detection step.
 *
 * This is an internal type — the public API merges these fields into
 * the {@link ProjectModel}. Separated so the type detector can be
 * tested independently of the full discovery pipeline.
 */
export interface TypeDetectionResult {
  /** The detected framework. */
  framework: ProjectFramework;

  /** Whether the project is supported by rn-audit. */
  isSupported: boolean;

  /** The Expo workflow, if applicable. */
  workflow?: ExpoWorkflow;

  /** Whether expo-router is in use. */
  hasExpoRouter: boolean;
}

// ---------------------------------------------------------------------------
// Internal: metadata extraction
// ---------------------------------------------------------------------------

/**
 * Raw metadata extracted from package.json before processing.
 *
 * Version strings are extracted as-is from the package.json (with
 * semver ranges like `^0.76.0`). The metadata extractor cleans these
 * (removes `^`, `~`, `>=`, etc.) before storing in the ProjectModel.
 */
export interface RawPackageMetadata {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  engines: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Internal: root finding
// ---------------------------------------------------------------------------

/**
 * Result of the root-finding step.
 */
export interface RootFinderResult {
  /** Absolute path to the project root (where package.json was found). */
  root: string;

  /** Whether the root was explicitly provided (not discovered by walking). */
  explicit: boolean;
}

// ---------------------------------------------------------------------------
// Internal: config file entry
// ---------------------------------------------------------------------------

/**
 * A single configuration file that could exist in the project.
 *
 * Used by the config finder to declare what to look for and in what
 * priority order. Adding a new config file type means adding a new
 * entry to the {@link CONFIG_FILE_PATTERNS} constant in the config
 * finder module — no other code changes needed.
 */
export interface ConfigFilePattern {
  /** Key in {@link ConfigFiles} this file maps to. */
  key: string;

  /** File names to check, in priority order (first match wins). */
  names: string[];
}
