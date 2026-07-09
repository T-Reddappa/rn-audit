/**
 * Project Root Finder
 *
 * Locates the React Native / Expo project root by walking up the directory
 * tree from a starting point until a package.json with react-native or expo
 * in its dependencies is found.
 *
 * This is the first step in the discovery pipeline. Every subsequent step
 * operates relative to the discovered root.
 *
 * @module discovery/root-finder
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { NoPackageJsonError, NotReactNativeProjectError } from "./errors.js";
import type { RootFinderResult } from "../types/discovery.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Marker dependencies that identify a React Native or Expo project.
 *
 * A project is considered a React Native project if its package.json
 * contains EITHER of these in dependencies, devDependencies, or
 * peerDependencies.
 */
const RN_MARKER_DEPENDENCIES = new Set(["react-native", "expo"]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find the project root by walking up from `startDir` until a package.json
 * with `react-native` or `expo` in its dependencies is discovered.
 *
 * ## Algorithm
 *
 * 1. Resolve `startDir` to an absolute path.
 * 2. Check if `<startDir>/package.json` exists.
 * 3. If it exists, parse it and check for RN marker dependencies.
 * 4. If found → return this directory as the project root.
 * 5. If not found (or no marker deps) → move to the parent directory.
 * 6. Repeat until the filesystem root is reached.
 * 7. If the root is reached without finding an RN project, throw.
 *
 * ## Edge cases handled
 *
 * - **Symlinks**: The walk uses `resolve()` which normalizes but follows
 *   symlinks at the filesystem level. Node.js `fs` operations follow
 *   symlinks by default.
 * - **Filesystem root**: Detected when `parent === current`. On macOS/Linux
 *   the root is `/`. On Windows it's `C:\\` or similar.
 * - **Missing package.json**: Continues walking up — the RN project might
 *   be higher in the tree.
 * - **Permission denied**: Let the `readFileSync` exception propagate.
 *   The orchestrator catches and wraps it in a `DiscoveryError`.
 *
 * @param startDir - Directory to start searching from. Defaults to
 *   `process.cwd()`. Must be an absolute path.
 * @returns The absolute path to the discovered project root.
 * @throws {NoPackageJsonError} When no RN project is found up to the filesystem root.
 */
export function findProjectRoot(startDir: string = process.cwd()): RootFinderResult {
  let currentDir = resolve(startDir);

  // Walk up the directory tree
  while (true) {
    const pkgPath = resolve(currentDir, "package.json");

    if (existsSync(pkgPath)) {
      const isRNProject = checkPackageJsonForReactNative(pkgPath);

      if (isRNProject) {
        return {
          root: currentDir,
          explicit: false,
        };
      }
    }

    // Move to the parent directory.
    const parentDir = dirname(currentDir);

    // Detect filesystem root: if parent is the same as current, we've
    // reached the top and can't go higher.
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  // If we exit the loop, we reached the filesystem root without finding
  // a React Native project.
  throw new NoPackageJsonError(resolve(startDir));
}

/**
 * Find the project root starting from an explicitly provided path.
 *
 * Unlike {@link findProjectRoot}, this does NOT walk up the directory
 * tree. It validates that the provided path is a React Native project
 * root. If not, it throws immediately.
 *
 * Used when the user provides `--config <path>` and we infer the root
 * from the config file location.
 *
 * @param explicitRoot - Absolute path provided by the user.
 * @returns The validated project root.
 * @throws {NotReactNativeProjectError} If the directory is not an RN project.
 */
export function findProjectRootExplicit(explicitRoot: string): RootFinderResult {
  const absoluteRoot = resolve(explicitRoot);
  const pkgPath = resolve(absoluteRoot, "package.json");

  if (!existsSync(pkgPath)) {
    throw new NoPackageJsonError(absoluteRoot);
  }

  if (!checkPackageJsonForReactNative(pkgPath)) {
    throw new NotReactNativeProjectError(absoluteRoot);
  }

  return {
    root: absoluteRoot,
    explicit: true,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a package.json file represents a React Native project.
 *
 * Reads the file, parses it as JSON, and checks for `react-native` or
 * `expo` across all dependency fields.
 *
 * ## Why check devDependencies and peerDependencies too?
 *
 * - **dependencies**: Most common — `react-native` is a runtime dependency.
 * - **devDependencies**: Some monorepo setups hoist react-native to the
 *   workspace root's devDependencies.
 * - **peerDependencies**: Some libraries declare react-native as a peer
 *   dependency without depending on it directly.
 *
 * @param packageJsonPath - Absolute path to the package.json file.
 * @returns `true` if the project uses React Native or Expo.
 */
function checkPackageJsonForReactNative(packageJsonPath: string): boolean {
  let pkg: Record<string, unknown>;

  try {
    const raw = readFileSync(packageJsonPath, "utf-8");
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // If the file exists but can't be parsed as JSON, treat it as a
    // non-RN project and continue walking. The validator will catch
    // the malformed JSON later when we actually need to read metadata.
    return false;
  }

  // Merge all dependency maps into a single set of package names to check
  const dependencySources: Array<Record<string, unknown> | undefined> = [
    pkg["dependencies"] as Record<string, unknown> | undefined,
    pkg["devDependencies"] as Record<string, unknown> | undefined,
    pkg["peerDependencies"] as Record<string, unknown> | undefined,
  ];

  for (const deps of dependencySources) {
    if (!deps || typeof deps !== "object") continue;

    for (const key of Object.keys(deps)) {
      if (RN_MARKER_DEPENDENCIES.has(key)) {
        return true;
      }
    }
  }

  return false;
}
