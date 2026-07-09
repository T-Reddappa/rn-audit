/**
 * Workspace Resolver
 *
 * Detects monorepo workspace configurations and resolves workspace
 * package directories. Supports npm, Yarn, pnpm, TurboRepo, and Nx.
 *
 * ## How workspace discovery works
 *
 * 1. **Detect** the workspace tool from configuration files at the root.
 * 2. **Extract** workspace glob patterns from the configuration.
 * 3. **Resolve** glob patterns to actual directories on disk.
 * 4. **Validate** each directory has a `package.json` (i.e., it's a real package).
 * 5. **Return** a list of workspace package descriptors.
 *
 * ## Tool-specific behavior
 *
 * npm and Yarn use the `workspaces` field in root `package.json`.
 * pnpm uses `pnpm-workspace.yaml`.
 * TurboRepo and Nx add orchestration on top but delegate workspace
 * definition to the underlying package manager. We detect them for
 * reporting purposes but use the PM's workspace config for resolution.
 *
 * ## Single-package projects
 *
 * If no workspace configuration is found, the resolver returns an empty
 * array. The scanner treats the project root itself as the sole source
 * of files to analyze.
 *
 * @module scanner/workspace-resolver
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Describes a detected workspace tool.
 */
export type WorkspaceTool = "npm" | "yarn" | "pnpm" | "turborepo" | "nx" | null;

/**
 * A single workspace package discovered in the monorepo.
 */
export interface WorkspacePackage {
  /**
   * Absolute path to the package directory.
   * Example: `/Users/dev/my-monorepo/packages/mobile`
   */
  path: string;

  /**
   * Package directory relative to the workspace root.
   * Example: `packages/mobile`
   */
  relativePath: string;

  /**
   * Package name from the package's `package.json`.
   * Example: `@my-org/mobile-app`
   */
  name: string;
}

/**
 * Result of workspace resolution.
 */
export interface WorkspaceResult {
  /** The detected workspace tool, or null for single-package projects. */
  tool: WorkspaceTool;

  /** List of resolved workspace packages. Empty for single-package projects. */
  packages: WorkspacePackage[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve workspace packages for a project.
 *
 * Detects the workspace tool, extracts package glob patterns,
 * resolves them to directories on disk, and returns validated
 * workspace package descriptors.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns A {@link WorkspaceResult} with the tool and list of packages.
 */
export function resolveWorkspaces(projectRoot: string): WorkspaceResult {
  // --- Step 1: Detect the workspace tool ---
  const tool = detectWorkspaceTool(projectRoot);

  // --- Step 2: Extract workspace patterns ---
  const patterns = extractWorkspacePatterns(projectRoot, tool);

  if (patterns.length === 0) {
    return { tool, packages: [] };
  }

  // --- Step 3: Resolve patterns to directories ---
  const packages = resolvePatterns(projectRoot, patterns);

  return { tool, packages };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect which workspace tool is in use.
 *
 * Check order:
 * 1. pnpm (distinctive lock file)
 * 2. Yarn (distinctive lock file)
 * 3. npm (default if workspaces field exists)
 * 4. Overlay tools: turborepo, nx (detected independently)
 *
 * TurboRepo and Nx can coexist with any package manager. They are
 * detected as secondary attributes, not primary workspace tools.
 */
function detectWorkspaceTool(projectRoot: string): WorkspaceTool {
  const hasTurbo = existsSync(join(projectRoot, "turbo.json"));
  const hasNx = existsSync(join(projectRoot, "nx.json"));

  // pnpm — check first because pnpm projects may also have a
  // package.json with a workspaces field
  if (existsSync(join(projectRoot, "pnpm-workspace.yaml"))) {
    return "pnpm";
  }

  // Yarn — check for yarn.lock
  if (existsSync(join(projectRoot, "yarn.lock"))) {
    return "yarn";
  }

  // npm — check for package.json with workspaces field
  try {
    const pkg = readPackageJson(projectRoot);
    if (pkg && "workspaces" in pkg) {
      return "npm";
    }
  } catch {
    // package.json doesn't exist or can't be read — not a workspace
  }

  // Overlay tools without explicit workspace config from package manager
  if (hasTurbo) return "turborepo";
  if (hasNx) return "nx";

  return null;
}

// ---------------------------------------------------------------------------
// Pattern extraction
// ---------------------------------------------------------------------------

/**
 * Extract workspace glob patterns from the project configuration.
 *
 * The source depends on the workspace tool:
 * - npm/yarn: `workspaces` field in root package.json
 * - pnpm: `packages` field in pnpm-workspace.yaml
 * - turborepo/nx: delegates to underlying PM; falls back to package.json
 */
function extractWorkspacePatterns(projectRoot: string, tool: WorkspaceTool): string[] {
  switch (tool) {
    case "npm":
    case "yarn":
    case "turborepo":
    case "nx":
      return extractNpmWorkspacePatterns(projectRoot);

    case "pnpm":
      return extractPnpmWorkspacePatterns(projectRoot);

    default:
      return [];
  }
}

/**
 * Extract workspace patterns from package.json.
 *
 * Handles both formats:
 * - Simple array: `"workspaces": ["packages/*", "apps/*"]`
 * - Object with packages: `"workspaces": { "packages": ["packages/*"] }`
 */
function extractNpmWorkspacePatterns(projectRoot: string): string[] {
  try {
    const pkg = readPackageJson(projectRoot);
    if (!pkg) return [];

    const workspaces = pkg["workspaces"];

    // Array format: "workspaces": ["packages/*", "apps/*"]
    if (Array.isArray(workspaces)) {
      return workspaces.filter((w): w is string => typeof w === "string");
    }

    // Object format: "workspaces": { "packages": ["packages/*"] }
    if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
      const packagesArray = (workspaces as Record<string, unknown>)["packages"];
      if (Array.isArray(packagesArray)) {
        return packagesArray.filter((w): w is string => typeof w === "string");
      }
    }
  } catch {
    // package.json doesn't exist or can't be read
  }

  return [];
}

/**
 * Extract workspace patterns from pnpm-workspace.yaml.
 *
 * The pnpm-workspace.yaml format has a `packages` key with
 * a list of glob patterns. Example:
 *
 *   packages:
 *     - 'packages/*'
 *     - 'apps/*'
 *
 * Uses focused line-by-line extraction rather than a full YAML
 * parser dependency.
 */
function extractPnpmWorkspacePatterns(projectRoot: string): string[] {
  const yamlPath = join(projectRoot, "pnpm-workspace.yaml");

  if (!existsSync(yamlPath)) return [];

  try {
    const content = readFileSync(yamlPath, "utf-8");
    const patterns: string[] = [];

    // Parse the `packages:` section. This is a focused extraction —
    // we look for lines that start with `- '...'` or `- "..."` after
    // the `packages:` key. This handles the 99% case without a full
    // YAML parser dependency.
    let inPackagesSection = false;

    for (const line of content.split("\n")) {
      const trimmed = line.trim();

      // Detect the `packages:` key
      if (trimmed.startsWith("packages:")) {
        inPackagesSection = true;
        continue;
      }

      // Exit the packages section when we hit a non-indented line
      // that isn't a list item
      if (inPackagesSection && trimmed.length > 0 && !trimmed.startsWith("-")) {
        inPackagesSection = false;
        continue;
      }

      if (inPackagesSection && trimmed.startsWith("-")) {
        // Extract the glob pattern from: - 'pattern' or - "pattern"
        const match = trimmed.match(/^-\s*['"](.+?)['"]\s*$/);
        if (match && match[1]) {
          const pattern = match[1];
          // Skip negation patterns (starting with !)
          if (!pattern.startsWith("!")) {
            patterns.push(pattern);
          }
        }
        // Also handle unquoted: - pattern
        const unquoted = trimmed.match(/^-\s+(.+?)\s*$/);
        if (unquoted && unquoted[1] && !unquoted[1].startsWith("!")) {
          patterns.push(unquoted[1]);
        }
      }
    }

    return patterns;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pattern resolution
// ---------------------------------------------------------------------------

/**
 * Resolve workspace glob patterns to actual directories on disk.
 *
 * For Phase 1, supports the two most common patterns:
 * - `*` — match any single directory at that level
 * - `**` — match any directory at any depth (recursive)
 *
 * Full glob syntax (character classes, brace expansion, alternation)
 * is not supported in Phase 1. If a pattern uses these features,
 * it's silently skipped (no match) rather than throwing.
 *
 * @param projectRoot - The workspace root directory.
 * @param patterns - Glob patterns from workspace config.
 * @returns Validated workspace packages (directories with package.json).
 */
function resolvePatterns(projectRoot: string, patterns: string[]): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  const seen = new Set<string>(); // Deduplicate overlapping patterns

  for (const pattern of patterns) {
    const resolved = resolveGlobPattern(projectRoot, pattern);

    for (const dirPath of resolved) {
      // Validate: directory must contain a package.json
      if (!existsSync(join(dirPath, "package.json"))) {
        continue;
      }

      // Deduplicate
      if (seen.has(dirPath)) continue;
      seen.add(dirPath);

      // Extract package name
      let pkgName = basename(dirPath);
      try {
        const pkg = JSON.parse(readFileSync(join(dirPath, "package.json"), "utf-8")) as Record<
          string,
          unknown
        >;
        if (typeof pkg["name"] === "string") {
          pkgName = pkg["name"];
        }
      } catch {
        // Use directory name as fallback
      }

      packages.push({
        path: dirPath,
        relativePath: relativeFromRoot(projectRoot, dirPath),
        name: pkgName,
      });
    }
  }

  return packages;
}

/**
 * Resolve a single workspace glob pattern to matching directories.
 *
 * Supports `*` (single directory level) and `**` (recursive).
 * Patterns with unsupported syntax return an empty array.
 */
function resolveGlobPattern(projectRoot: string, pattern: string): string[] {
  // Normalize: remove leading ./ if present
  const normalized = pattern.replace(/^\.\//, "");

  // --- Pattern: `dir/*` — single-level wildcard ---
  if (normalized.endsWith("/*") && !normalized.includes("**")) {
    const baseDir = normalized.slice(0, -2); // Remove `/*`
    const targetDir = join(projectRoot, baseDir);

    if (!existsSync(targetDir)) return [];

    try {
      return readdirSync(targetDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(targetDir, entry.name));
    } catch {
      return [];
    }
  }

  // --- Pattern: `dir/**` — recursive wildcard ---
  if (normalized.endsWith("/**")) {
    const baseDir = normalized.slice(0, -3); // Remove `/**`
    const targetDir = join(projectRoot, baseDir);

    if (!existsSync(targetDir)) return [];

    return collectDirectoriesRecursive(targetDir);
  }

  // --- Pattern: exact directory name (no wildcard) ---
  if (!normalized.includes("*")) {
    const targetDir = join(projectRoot, normalized);

    if (existsSync(targetDir)) {
      return [targetDir];
    }
    return [];
  }

  // Unsupported pattern syntax — return empty
  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read and parse the root package.json.
 */
function readPackageJson(projectRoot: string): Record<string, unknown> | null {
  const pkgPath = join(projectRoot, "package.json");

  if (!existsSync(pkgPath)) return null;

  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Recursively collect all directories under a given path.
 */
function collectDirectoriesRecursive(rootDir: string): string[] {
  const dirs: string[] = [];

  function walk(current: string): void {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = join(current, entry.name);
        dirs.push(fullPath);
        walk(fullPath);
      }
    }
  }

  walk(rootDir);
  return dirs;
}

/**
 * Compute a relative path from one directory to another.
 * Avoids the performance cost of path.relative when paths are simple.
 */
function relativeFromRoot(root: string, target: string): string {
  if (target.startsWith(root)) {
    let rel = target.slice(root.length);
    if (rel.startsWith("/")) rel = rel.slice(1);
    return rel;
  }
  return target;
}
