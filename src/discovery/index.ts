/**
 * Project Discovery — Public API
 *
 * The single entry point for discovering, validating, and modeling a
 * React Native / Expo project. Orchestrates the full discovery pipeline:
 *
 * ```
 * findProjectRoot → validateProject → detectProjectType
 *                                   → discoverConfigFiles
 *                                   → extractMetadata
 *                                   → assemble ProjectModel
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { discoverProject } from "./discovery/index.js";
 *
 * // Auto-detect from process.cwd()
 * const project = discoverProject();
 *
 * // Or specify a starting directory
 * const project = discoverProject({ cwd: "/path/to/project" });
 * ```
 *
 * ## Error handling
 *
 * All errors thrown by this function are instances of {@link DiscoveryError}.
 * The CLI layer catches these and maps them to user-facing messages and
 * exit codes. Programmatic consumers can catch and handle specific error
 * codes.
 *
 * @module discovery
 */

import type { ProjectModel } from "../types/project.js";
import type { DiscoveryOptions } from "../types/discovery.js";
import { findProjectRoot, findProjectRootExplicit } from "./root-finder.js";
import { validateProject } from "./validator.js";
import { detectProjectType } from "./type-detector.js";
import { discoverConfigFiles } from "./config-finder.js";
import { extractMetadata } from "./metadata.js";
import { UnsupportedProjectError } from "./errors.js";

// Re-export error classes for consumers
export {
  DiscoveryError,
  NoPackageJsonError,
  NotReactNativeProjectError,
  UnsupportedProjectError,
  InvalidConfigurationError,
} from "./errors.js";

// Re-export types for convenience
export type { DiscoveryOptions } from "../types/discovery.js";
export type { ProjectModel, ConfigFiles, DependencyMap } from "../types/project.js";

// Re-export enums (must be value exports, not type-only — enums are runtime values)
export { ProjectFramework, ExpoWorkflow, PackageManager } from "../types/project.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover and model a React Native / Expo project.
 *
 * This is the primary entry point for the discovery subsystem. It runs
 * the full discovery pipeline and returns a strongly-typed
 * {@link ProjectModel} that every future subsystem consumes.
 *
 * ## Pipeline steps
 *
 * 1. **Root finding**: Walk up from `options.cwd` (or `process.cwd()`)
 *    to find the nearest package.json with `react-native` or `expo`.
 * 2. **Validation**: Check that the project is supported by rn-audit
 *    (correct framework, supported version range).
 * 3. **Type detection**: Determine the specific project type (Expo managed,
 *    Expo bare, React Native CLI) and whether Expo Router is used.
 * 4. **Config file discovery**: Find all known configuration files and
 *    record their paths.
 * 5. **Metadata extraction**: Read package.json and extract versions,
 *    dependencies, and the active package manager.
 * 6. **Assembly**: Combine all results into a single ProjectModel.
 *
 * @param options - Optional discovery configuration. All fields are optional
 *   with sensible defaults.
 * @returns A fully populated {@link ProjectModel}.
 * @throws {NoPackageJsonError} When no package.json with RN/Expo is found.
 * @throws {NotReactNativeProjectError} When the project lacks RN dependencies.
 * @throws {UnsupportedProjectError} When the project is explicitly unsupported.
 * @throws {InvalidConfigurationError} When a required config file is malformed.
 *
 * @example
 * ```typescript
 * const project = discoverProject();
 * console.log(project.name);          // "my-app"
 * console.log(project.framework);     // ProjectFramework.Expo
 * console.log(project.workflow);      // ExpoWorkflow.Managed
 * ```
 */
export function discoverProject(options: DiscoveryOptions = {}): ProjectModel {
  // ------------------------------------------------------------------
  // Step 1: Locate the project root
  // ------------------------------------------------------------------
  const rootResult = options.projectRoot
    ? findProjectRootExplicit(options.projectRoot)
    : findProjectRoot(options.cwd);

  const { root } = rootResult;

  // ------------------------------------------------------------------
  // Step 2: Validate the project
  // ------------------------------------------------------------------
  const validation = validateProject(root);

  // ------------------------------------------------------------------
  // Step 3: Extract metadata (needed by steps 4 and 5)
  // ------------------------------------------------------------------
  const metadata = extractMetadata(root);

  // ------------------------------------------------------------------
  // Step 4: Detect project type
  // ------------------------------------------------------------------
  const typeResult = detectProjectType(root, metadata.dependencies, metadata.devDependencies);

  // ------------------------------------------------------------------
  // Step 5: Discover configuration files
  // ------------------------------------------------------------------
  const configFiles = discoverConfigFiles(root);

  // ------------------------------------------------------------------
  // Step 6: Assemble the ProjectModel
  // ------------------------------------------------------------------
  const project: ProjectModel = {
    // Identity
    root,
    name: metadata.name,
    version: metadata.version,

    // Classification
    framework: typeResult.framework,
    isSupported: validation.isSupported,
    workflow: typeResult.workflow,
    hasExpoRouter: typeResult.hasExpoRouter,

    // Runtime versions
    reactNativeVersion: metadata.reactNativeVersion,
    expoVersion: metadata.expoVersion,
    reactVersion: metadata.reactVersion,
    typescriptVersion: metadata.typescriptVersion,
    nodeEngine: metadata.nodeEngine,

    // Package manager
    packageManager: metadata.packageManager,

    // Dependencies
    dependencies: metadata.dependencies,
    devDependencies: metadata.devDependencies,

    // Configuration files
    configFiles,

    // Monorepo (Phase 2)
    isWorkspace: false,
    workspaceRoot: null,

    // Metadata
    discoveredAt: new Date().toISOString(),
  };

  // If the project is unsupported, throw with the specific reason
  // from the validator. The CLI layer will catch this and display
  // a user-facing error message.
  if (!validation.isSupported) {
    throw new UnsupportedProjectError(
      root,
      validation.reason ?? "This project is not supported by rn-audit.",
    );
  }

  return project;
}
