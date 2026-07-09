/**
 * Source Discovery — Public API
 *
 * The single entry point for discovering every source file in the project
 * that should be analyzed. Takes a {@link ProjectModel} from the discovery
 * subsystem and returns a {@link SourceDiscoveryResult} containing all
 * discovered {@link FileModel} objects.
 *
 * ## Pipeline
 *
 * ```
 * ProjectModel
 *   │
 *   ├─ resolveWorkspaces(projectRoot)
 *   │     Detects workspace tool, extracts glob patterns, resolves
 *   │     to actual package directories.
 *   │
 *   ├─ createIgnorePredicate(projectRoot)
 *   │     Compiles .gitignore patterns into a predicate function.
 *   │
 *   ├─ For EACH workspace package (and root):
 *   │     walkSourceFiles({ projectRoot, isIgnored, workspace, packageName })
 *   │       - Traverses the directory tree
 *   │       - Applies .gitignore and built-in ignore rules
 *   │       - Creates FileModel for each supported source file
 *   │
 *   └─ Merge & partition
 *       Combines files from all packages, deduplicates by absolute path,
 *       splits into active (not ignored) and ignored buckets.
 * ```
 *
 * @module scanner
 */

import type { ProjectModel } from "../types/project.js";
import type { FileModel, SourceDiscoveryResult } from "../types/file.js";
import { resolveWorkspaces } from "./workspace-resolver.js";
import { walkSourceFiles } from "./file-walker.js";
import type { WalkStatistics } from "./file-walker.js";
import { createIgnorePredicate } from "./ignore-resolver.js";
import { ScannerError } from "./errors.js";

// Re-export types for consumers
export type { FileModel, SourceDiscoveryResult, FileExtension } from "../types/file.js";
export { ScannerError, PermissionDeniedError, BrokenSymlinkError } from "./errors.js";
export type { WalkOptions, WalkStatistics } from "./file-walker.js";
export type { WorkspacePackage } from "./workspace-resolver.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all source files in a React Native / Expo project.
 *
 * This is the primary entry point for source discovery. It handles:
 * - Single-package projects: walks the project root directory
 * - Monorepo workspaces: discovers workspace packages and walks each one
 * - Ignore rules: applies .gitignore and built-in directory exclusions
 * - File filtering: only returns files with supported extensions
 * - Error resilience: non-fatal errors (permission denied, broken symlinks)
 *   are collected and reported as warnings
 *
 * @param project - The discovered {@link ProjectModel}.
 * @returns A {@link SourceDiscoveryResult} with active files, ignored files,
 *   and traversal statistics.
 *
 * @example
 * ```typescript
 * const project = discoverProject();
 * const result = discoverSourceFiles(project);
 * console.log(`Found ${result.files.length} files to analyze.`);
 * console.log(`Warnings: ${result.warnings.length}`);
 * ```
 */
export function discoverSourceFiles(project: ProjectModel): SourceDiscoveryResult {
  const startTime = performance.now();

  // ------------------------------------------------------------------
  // Step 1: Create the ignore predicate (shared across all walks)
  // ------------------------------------------------------------------
  const isIgnored = createIgnorePredicate(project.root);

  // ------------------------------------------------------------------
  // Step 2: Resolve workspaces
  // ------------------------------------------------------------------
  const workspaceResult = resolveWorkspaces(project.root);

  const allFiles: FileModel[] = [];
  const warnings: ScannerError[] = [];
  let totalStats: WalkStatistics = emptyStats();

  /**
   * Warning callback: collects non-fatal errors from the file walker.
   * Permission denied on a single directory shouldn't crash the scan.
   */
  function onWarning(error: Error): void {
    if (error instanceof ScannerError) {
      warnings.push(error);
    } else {
      // Wrap unknown errors so they're tracked with context
      warnings.push(new ScannerError("SCANNER_ERROR" as never, error.message, "(unknown)", error));
    }
  }

  // ------------------------------------------------------------------
  // Step 3: Walk files for each workspace package
  // ------------------------------------------------------------------

  if (workspaceResult.packages.length > 0) {
    // Monorepo: walk each workspace package independently.
    for (const pkg of workspaceResult.packages) {
      const [files, stats] = walkSourceFiles({
        projectRoot: pkg.path,
        isIgnored,
        workspace: pkg.relativePath,
        packageName: pkg.name,
        onWarning,
      });

      allFiles.push(...files);
      totalStats = mergeStats(totalStats, stats);
    }

    // Also walk the workspace root for shared source files.
    const [rootFiles, rootStats] = walkSourceFiles({
      projectRoot: project.root,
      isIgnored,
      onWarning,
    });
    allFiles.push(...rootFiles);
    totalStats = mergeStats(totalStats, rootStats);
  } else {
    // Single-package project: walk the project root.
    const [files, stats] = walkSourceFiles({
      projectRoot: project.root,
      isIgnored,
      onWarning,
    });

    allFiles.push(...files);
    totalStats = stats;
  }

  // ------------------------------------------------------------------
  // Step 4: Deduplicate by absolute path
  // ------------------------------------------------------------------
  const seen = new Set<string>();
  const deduped: FileModel[] = [];

  for (const file of allFiles) {
    const key = file.absolutePath;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(file);
    }
  }

  // ------------------------------------------------------------------
  // Step 5: Partition into active and ignored
  // ------------------------------------------------------------------
  const active: FileModel[] = [];
  const ignored: FileModel[] = [];

  for (const file of deduped) {
    if (file.ignored) {
      ignored.push(file);
    } else {
      active.push(file);
    }
  }

  // ------------------------------------------------------------------
  // Step 6: Assemble result
  // ------------------------------------------------------------------
  const endTime = performance.now();

  // Override the walk-level timing with aggregate timing from the
  // orchestrator's perspective (includes workspace resolution and
  // deduplication overhead).
  totalStats.durationMs = Math.round(endTime - startTime);

  return {
    files: active,
    ignored,
    traversalTimeMs: totalStats.durationMs,
    directoriesVisited: totalStats.directoriesVisited,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyStats(): WalkStatistics {
  return {
    filesFound: 0,
    filesAccepted: 0,
    filesIgnored: 0,
    directoriesVisited: 0,
    directoriesSkipped: 0,
    symlinksFollowed: 0,
    errors: 0,
    durationMs: 0,
  };
}

function mergeStats(a: WalkStatistics, b: WalkStatistics): WalkStatistics {
  return {
    filesFound: a.filesFound + b.filesFound,
    filesAccepted: a.filesAccepted + b.filesAccepted,
    filesIgnored: a.filesIgnored + b.filesIgnored,
    directoriesVisited: a.directoriesVisited + b.directoriesVisited,
    directoriesSkipped: a.directoriesSkipped + b.directoriesSkipped,
    symlinksFollowed: a.symlinksFollowed + b.symlinksFollowed,
    errors: a.errors + b.errors,
    durationMs: a.durationMs + b.durationMs,
  };
}
