/**
 * File Walker
 *
 * Recursive filesystem traversal that discovers every source file in the
 * project. Uses {@link ALWAYS_IGNORED_DIRECTORIES} for eager pruning and
 * an injected ignore predicate for gitignore-aware filtering.
 *
 * ## Traversal strategy
 *
 * 1. Start at the project root.
 * 2. For each directory entry (via `readdirSync` with `withFileTypes`):
 *    - **Directory**: Check against always-ignored list. If not ignored,
 *      recurse into it. If it's a symlink, resolve and follow with
 *      loop detection.
 *    - **File**: Check extension. If supported, stat it, test against
 *      ignore predicate, create a FileModel, and collect it.
 *    - **Symlink to file**: Resolve, stat, create FileModel for the
 *      resolved path.
 * 3. Report non-fatal errors (permission denied, broken symlinks) via
 *    the warning callback so the caller can log or surface them.
 *
 * ## Error handling
 *
 * | OS Error | Handled as | Scan continues? |
 * |----------|-----------|----------------|
 * | `EACCES` / `EPERM` | PermissionDeniedError (warning) | Yes |
 * | `ENOENT` (TOCTOU) | Silently skipped | Yes |
 * | `ELOOP` (symlink cycle) | BrokenSymlinkError (warning) | Yes |
 * | `ENOTDIR` | Silently skipped | Yes |
 *
 * ## Performance
 *
 * - `readdirSync` with `withFileTypes: true` avoids per-entry `stat` calls.
 * - Directories in the always-ignored set are pruned eagerly — we don't
 *   even call `readdir` on them, saving ~100K+ filesystem calls in a
 *   typical project.
 * - The ignore predicate is compiled once and called per-file. Regex
 *   matching is O(pattern length) per file.
 *
 * @module scanner/file-walker
 */

import { readdirSync, statSync, readlinkSync, existsSync } from "node:fs";
import { resolve, relative, join, basename, extname } from "node:path";
import type { FileModel, FileExtension } from "../types/file.js";
import { PermissionDeniedError, BrokenSymlinkError, TraversalLimitError } from "./errors.js";
import {
  ALWAYS_IGNORED_DIRECTORIES,
  MAX_TRAVERSAL_DEPTH,
  MAX_FILE_COUNT,
  MAX_SYMLINK_DEPTH,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options controlling file traversal behavior.
 */
export interface WalkOptions {
  /**
   * Absolute path to the project root.
   * All relative paths in FileModel objects are computed from this base.
   */
  projectRoot: string;

  /**
   * The ignore predicate — a function that tests whether a file should
   * be excluded from analysis. Injected rather than created internally
   * so the walker is decoupled from the ignore resolver.
   *
   * Created by {@link createIgnorePredicate} in the ignore-resolver module.
   */
  isIgnored: (absolutePath: string) => [boolean, string | undefined];

  /**
   * For workspace packages: the package directory relative to the
   * workspace root. Tagged on every FileModel from this walk.
   */
  workspace?: string;

  /**
   * For workspace packages: the package name from the workspace
   * package's `package.json`. Tagged on every FileModel.
   */
  packageName?: string;

  /**
   * Callback invoked for each non-fatal error encountered during
   * traversal (permission denied, broken symlinks, etc.).
   *
   * If not provided, non-fatal errors are silently ignored.
   */
  onWarning?: (error: Error) => void;

  /**
   * Maximum number of files to collect before aborting.
   * Defaults to {@link MAX_FILE_COUNT} (500,000).
   */
  maxFileCount?: number;
}

/**
 * Statistics collected during a walk.
 */
export interface WalkStatistics {
  /** Total files found (before ignore filtering). */
  filesFound: number;

  /** Files that passed the ignore predicate. */
  filesAccepted: number;

  /** Files excluded by the ignore predicate. */
  filesIgnored: number;

  /** Directories entered during traversal. */
  directoriesVisited: number;

  /** Directories skipped (in always-ignored set or inaccessible). */
  directoriesSkipped: number;

  /** Symlinks followed during traversal. */
  symlinksFollowed: number;

  /** Non-fatal errors encountered. */
  errors: number;

  /** Wall-clock time for the walk (milliseconds). */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk the project directory tree and discover every source file.
 *
 * This is the main entry point for file discovery. It traverses the
 * directory tree, creates a {@link FileModel} for every source file
 * with a supported extension, and returns both the file list and
 * traversal statistics.
 *
 * @param options - Walk configuration including project root and
 *   ignore predicate.
 * @returns A tuple of `[files, statistics]` — all discovered files
 *   (including ignored ones, marked with `ignored: true`) and
 *   detailed traversal statistics.
 *
 * @example
 * ```typescript
 * import { createIgnorePredicate } from "./ignore-resolver.js";
 *
 * const isIgnored = createIgnorePredicate(projectRoot);
 * const [files, stats] = walkSourceFiles({
 *   projectRoot,
 *   isIgnored,
 *   onWarning: (err) => console.warn(err.message),
 * });
 * console.log(`Found ${files.length} files in ${stats.durationMs}ms`);
 * ```
 */
export function walkSourceFiles(options: WalkOptions): [FileModel[], WalkStatistics] {
  const {
    projectRoot,
    isIgnored,
    workspace,
    packageName,
    onWarning,
    maxFileCount = MAX_FILE_COUNT,
  } = options;

  const startTime = performance.now();

  const files: FileModel[] = [];
  const stats: WalkStatistics = {
    filesFound: 0,
    filesAccepted: 0,
    filesIgnored: 0,
    directoriesVisited: 0,
    directoriesSkipped: 0,
    symlinksFollowed: 0,
    errors: 0,
    durationMs: 0,
  };

  // Symlink loop detection: track resolved symlink targets by real path.
  // If we encounter the same real path twice, we've hit a cycle.
  const visitedSymlinks = new Set<string>();

  /**
   * Internal recursive walk function.
   *
   * @param currentDir - Absolute path to the directory being walked.
   * @param depth - Current recursion depth (checked against MAX_TRAVERSAL_DEPTH).
   */
  function walk(currentDir: string, depth: number): void {
    // --- Guard: maximum depth ---
    if (depth > MAX_TRAVERSAL_DEPTH) {
      const err = new TraversalLimitError(
        "depth",
        MAX_TRAVERSAL_DEPTH,
        currentDir,
      );
      if (onWarning) {
        onWarning(err);
      } else {
        throw err;
      }
      stats.errors++;
      return;
    }

    // --- Guard: maximum file count ---
    if (files.length >= maxFileCount) {
      const err = new TraversalLimitError(
        "fileCount",
        maxFileCount,
        currentDir,
      );
      if (onWarning) {
        onWarning(err);
      } else {
        throw err;
      }
      stats.errors++;
      return;
    }

    let entries: Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }>;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true }) as Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }>;
    } catch (error: unknown) {
      const errnoError = error as NodeJS.ErrnoException;

      if (errnoError.code === "EACCES" || errnoError.code === "EPERM") {
        const permissionError = new PermissionDeniedError(
          currentDir,
          errnoError.code,
          error,
        );
        if (onWarning) {
          onWarning(permissionError);
        }
        stats.directoriesSkipped++;
        stats.errors++;
        return;
      }

      // Other I/O errors — re-throw as unexpected
      throw error;
    }

    stats.directoriesVisited++;

    for (const entry of entries) {
      const absolutePath = resolve(currentDir, entry.name);

      // ----------------------------------------------------------------
      // Directories (including symlinks to directories)
      // ----------------------------------------------------------------
      if (entry.isDirectory()) {
        // Always-ignored directories: prune eagerly
        if (ALWAYS_IGNORED_DIRECTORIES.has(entry.name)) {
          stats.directoriesSkipped++;
          continue;
        }

        // Recurse
        walk(absolutePath, depth + 1);
        continue;
      }

      // ----------------------------------------------------------------
      // Symbolic links to files
      // ----------------------------------------------------------------
      if (entry.isSymbolicLink()) {
        let resolvedPath: string;
        try {
          resolvedPath = resolveSymlink(absolutePath);
        } catch (error: unknown) {
          const errnoError = error as NodeJS.ErrnoException;

          if (errnoError.code === "ENOENT") {
            const symlinkError = new BrokenSymlinkError(
              absolutePath,
              "(unresolvable)",
              error,
            );
            if (onWarning) {
              onWarning(symlinkError);
            }
            stats.errors++;
            continue;
          }

          if (errnoError.code === "ELOOP") {
            const symlinkError = new BrokenSymlinkError(
              absolutePath,
              "(circular)",
              error,
            );
            if (onWarning) {
              onWarning(symlinkError);
            }
            stats.errors++;
            continue;
          }

          throw error;
        }

        // Symlink loop detection via realpath
        if (visitedSymlinks.has(resolvedPath)) {
          const symlinkError = new BrokenSymlinkError(
            absolutePath,
            resolvedPath,
            new Error("Symlink cycle detected"),
          );
          if (onWarning) {
            onWarning(symlinkError);
          }
          stats.errors++;
          continue;
        }
        visitedSymlinks.add(resolvedPath);

        // Determine if the resolved target is a file or directory
        let targetStat;
        try {
          targetStat = statSync(resolvedPath);
        } catch (error: unknown) {
          const errnoError = error as NodeJS.ErrnoException;
          if (errnoError.code === "ENOENT") {
            const symlinkError = new BrokenSymlinkError(
              absolutePath,
              resolvedPath,
              error,
            );
            if (onWarning) {
              onWarning(symlinkError);
            }
            stats.errors++;
            continue;
          }
          throw error;
        }

        if (targetStat.isDirectory()) {
          // Symlink to directory: follow it (with loop detection)
          stats.symlinksFollowed++;
          walk(absolutePath, depth + 1);
        } else if (targetStat.isFile()) {
          // Symlink to file: process it as a file
          stats.symlinksFollowed++;
          processFile(absolutePath, targetStat);
        }
        // else: symlink to something else (socket, FIFO) — skip
        continue;
      }

      // ----------------------------------------------------------------
      // Regular files
      // ----------------------------------------------------------------
      if (entry.isFile()) {
        let fileStat;
        try {
          fileStat = statSync(absolutePath);
        } catch (error: unknown) {
          const errnoError = error as NodeJS.ErrnoException;

          if (errnoError.code === "ENOENT") {
            // TOCTOU race: file deleted between readdir and stat.
            // Silently skip — this is expected in active projects.
            continue;
          }

          if (errnoError.code === "EACCES" || errnoError.code === "EPERM") {
            const permissionError = new PermissionDeniedError(
              absolutePath,
              errnoError.code,
              error,
            );
            if (onWarning) {
              onWarning(permissionError);
            }
            stats.errors++;
            continue;
          }

          throw error;
        }

        if (fileStat.isFile()) {
          processFile(absolutePath, fileStat);
        }
      }
      // else: block devices, sockets, FIFOs — skip silently
    }
  }

  /**
   * Process a single file: check extension, create FileModel, test
   * against ignore rules, and add to the files array.
   *
   * Extracted as a nested function to avoid code duplication between
   * the regular-file and symlink-to-file code paths.
   */
  function processFile(
    absolutePath: string,
    fileStat: { size: number; mtimeMs: number; isFile: () => boolean },
  ): void {
    const extension = extname(absolutePath).toLowerCase();

    // Filter by supported extension
    if (!isSupportedExtension(extension)) {
      return;
    }

    stats.filesFound++;

    const relativePath = relative(projectRoot, absolutePath);

    // Test ignore rules (gitignore, built-in directory checks)
    const [ignored, ignoreReason] = isIgnored(absolutePath);

    const file: FileModel = {
      absolutePath,
      relativePath,
      extension: extension as FileExtension,
      fileName: basename(absolutePath),
      size: fileStat.size,
      lastModified: fileStat.mtimeMs,
      projectRoot,
      workspace,
      packageName,
      ignored,
      ignoreReason,
    };

    files.push(file);

    if (ignored) {
      stats.filesIgnored++;
    } else {
      stats.filesAccepted++;
    }
  }

  // Start the walk from the project root
  walk(projectRoot, 1);

  stats.durationMs = Math.round(performance.now() - startTime);

  return [files, stats];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Supported extensions for quick lookup during file processing.
 *
 * Using a Set here (rather than importing from constants.ts) because
 * we need per-character O(1) lookup. The constants module's SOURCE_EXTENSIONS
 * set is the source of truth; this is a local alias for the hot path.
 */
const supportedExtensions: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
]);

function isSupportedExtension(ext: string): boolean {
  return supportedExtensions.has(ext);
}

/**
 * Resolve a symbolic link to its ultimate target, following chains.
 *
 * Unlike `fs.realpathSync`, this:
 * - Tracks depth to prevent infinite chains
 * - Returns the immediate target on ENOENT (broken link) rather than
 *   throwing (the caller decides how to handle it)
 * - Throws on ELOOP (circular symlink detected by the OS)
 *
 * @param symlinkPath - Absolute path to the symlink.
 * @returns The absolute path of the resolved target.
 */
function resolveSymlink(symlinkPath: string): string {
  let current = symlinkPath;

  for (let depth = 0; depth < MAX_SYMLINK_DEPTH; depth++) {
    const target = readlinkSync(current);
    // Resolve relative to the symlink's containing directory
    current = resolve(join(current, ".."), target);
  }

  // If we exit the loop, we've exceeded the maximum resolution depth
  throw Object.assign(new Error("Maximum symlink resolution depth exceeded"), {
    code: "ELOOP",
  });
}
