/**
 * Scanner Extension Points
 *
 * Well-defined interfaces for extending the scanner without modifying
 * its core. Each interface represents a single capability that can be
 * replaced or augmented by plugin code.
 *
 * ## Design principle
 *
 * Extension points follow the **Strategy pattern**: the scanner core
 * depends on interfaces, not implementations. Plugins implement these
 * interfaces. The scanner orchestrator accepts instances of these
 * interfaces via configuration.
 *
 * ## Phase 1 status
 *
 * These interfaces are **designed but not yet pluggable**. Phase 1
 * uses the built-in implementations. Phase 2 adds the plugin loader
 * that discovers and instantiates third-party implementations.
 *
 * @module scanner/types
 */

import type { FileModel } from "../types/file.js";
import type { WorkspacePackage } from "./workspace-resolver.js";

// ---------------------------------------------------------------------------
// FileSystemProvider
// ---------------------------------------------------------------------------

/**
 * Abstraction over filesystem operations used by the file walker.
 *
 * The default implementation delegates to Node.js `fs` module.
 * Alternate implementations can:
 * - Serve files from a remote API (cloud scanning)
 * - Use an in-memory filesystem (testing)
 * - Apply virtual file transformations (e.g., expand macros before scanning)
 *
 * Each method mirrors the corresponding `fs` operation, but returns
 * structured results instead of throwing on common errors.
 */
export interface FileSystemProvider {
  /**
   * List entries in a directory.
   *
   * Returns `null` when the directory cannot be read (permission denied,
   * not a directory, doesn't exist). This allows the walker to skip
   * gracefully rather than catching exceptions.
   */
  readdir(path: string): DirectoryEntry[] | null;

  /**
   * Get file or directory metadata.
   *
   * Returns `null` when the path cannot be stat'd. This is a common
   * race condition (file deleted between readdir and stat) and should
   * not be treated as an error.
   */
  stat(path: string): FileStat | null;

  /**
   * Resolve a symbolic link to its target.
   *
   * Returns `null` for broken symlinks or when symlinks are not
   * supported by the provider (e.g., remote filesystem).
   */
  readlink(path: string): string | null;
}

/** Directory entry returned by {@link FileSystemProvider.readdir}. */
export interface DirectoryEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** File metadata returned by {@link FileSystemProvider.stat}. */
export interface FileStat {
  size: number;
  mtimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

// ---------------------------------------------------------------------------
// IgnoreRuleProvider
// ---------------------------------------------------------------------------

/**
 * Provides ignore rules that determine which files to exclude.
 *
 * The default implementation reads `.gitignore` files and applies
 * built-in directory exclusions. Custom implementations can:
 * - Add `.rnauditignore` support (project-specific overrides)
 * - Read exclusion patterns from configuration
 * - Implement CI-specific rules (e.g., exclude test fixtures in CI)
 * - Apply organization-wide exclusion policies
 *
 * ## Precedence
 *
 * Multiple providers are consulted in order. A provider can return:
 * - `"ignored"` — file should be excluded (stop consulting providers)
 * - `"not-ignored"` — file should be included (stop consulting providers)
 * - `"undecided"` — defer to the next provider
 */
export interface IgnoreRuleProvider {
  /** Human-readable name for debugging. */
  readonly name: string;

  /**
   * Test whether a file should be excluded.
   *
   * @param absolutePath - Absolute path to the file.
   * @param relativePath - Path relative to the project root.
   * @returns The decision and a human-readable reason.
   */
  test(
    absolutePath: string,
    relativePath: string,
  ): IgnoreDecision;
}

/** Result of consulting an ignore rule provider. */
export type IgnoreDecision =
  | { result: "ignored"; reason: string }
  | { result: "not-ignored"; reason?: string }
  | { result: "undecided" };

// ---------------------------------------------------------------------------
// WorkspaceResolver
// ---------------------------------------------------------------------------

/**
 * Resolves workspace packages in a monorepo.
 *
 * The default implementation handles npm, Yarn, and pnpm workspaces.
 * Custom implementations can add support for:
 * - Bazel workspace rules
 * - Buck/Lage monorepo layouts
 * - Custom monorepo tools used by large organizations
 * - Non-standard directory layouts
 */
export interface WorkspaceResolver {
  /** Human-readable name for debugging. */
  readonly name: string;

  /**
   * Detect whether this resolver applies to the given project.
   *
   * @returns `true` if this resolver should be used.
   */
  detect(projectRoot: string): boolean;

  /**
   * Resolve workspace packages.
   *
   * @returns List of workspace package descriptors, or an empty array
   *   for single-package projects.
   */
  resolve(projectRoot: string): WorkspacePackage[];
}

// ---------------------------------------------------------------------------
// FileFilter
// ---------------------------------------------------------------------------

/**
 * Filters files after discovery but before analysis.
 *
 * Unlike ignore rules (which happen during traversal), file filters
 * are applied after the full file list is collected. This is for
 * rules that need cross-file context — e.g., "skip files that are
 * also exported from index.ts" or "skip generated files based on
 * a @generated comment in the file header."
 *
 * Phase 1 does not ship file filters (the filtering is extension-based).
 * This interface exists so future milestones can add content-based
 * filtering without modifying the scanner core.
 */
export interface FileFilter {
  /** Human-readable name for debugging. */
  readonly name: string;

  /**
   * Test whether a file should be included in analysis.
   *
   * Called once per file after all files are discovered.
   *
   * @param file - The file to test.
   * @param allFiles - All discovered files (for cross-file context).
   * @returns `true` if the file should be analyzed.
   */
  filter(file: FileModel, allFiles: FileModel[]): boolean;
}

// ---------------------------------------------------------------------------
// ProgressReporter
// ---------------------------------------------------------------------------

/**
 * Reports progress during long-running scans.
 *
 * The default implementation is a no-op (scan completes fast enough
 * for most projects). Custom implementations can:
 * - Render a progress bar in the terminal (ora, cli-progress)
 * - Send progress events to a VS Code extension
 * - Log progress to CI output
 * - Track metrics in a monitoring system
 */
export interface ProgressReporter {
  /** Called when scanning begins. */
  onStart?(totalPaths: number): void;

  /** Called as each directory is entered. */
  onDirectory?(path: string, depth: number): void;

  /** Called as each file is processed. */
  onFile?(file: FileModel): void;

  /** Called when scanning completes. */
  onComplete?(stats: {
    filesFound: number;
    filesAccepted: number;
    durationMs: number;
  }): void;

  /** Called for non-fatal errors during scanning. */
  onWarning?(error: Error): void;
}
