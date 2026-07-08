/**
 * File Model Types
 *
 * Defines the structure for discovered source files. The FileModel is
 * the output of the Source Discovery subsystem and the input to the
 * parsing and analysis pipeline.
 *
 * Every discovered source file carries its full metadata — path, size,
 * timestamps, workspace ownership — so that downstream subsystems
 * (parser, cache, reporter) never need to re-stat the filesystem.
 *
 * @module types/file
 */

// ---------------------------------------------------------------------------
// File extension
// ---------------------------------------------------------------------------

/**
 * Supported source file extensions.
 *
 * This is a union type rather than `string` to enable exhaustive checking
 * in the parser dispatch. Adding a new extension to this union will cause
 * TypeScript errors in every switch/case that handles extensions, ensuring
 * no parser path is forgotten.
 *
 * Phase 1 supports: .ts, .tsx, .js, .jsx
 * Future: .mts, .cts, .mjs, .cjs
 */
export type FileExtension = ".ts" | ".tsx" | ".js" | ".jsx";

// ---------------------------------------------------------------------------
// Supported extensions set
// ---------------------------------------------------------------------------

/**
 * The set of file extensions the scanner looks for.
 *
 * This is the canonical list of "what counts as a source file."
 * The scanner uses this to filter files during traversal. The parser
 * uses this to dispatch to language-specific AST parsers.
 *
 * Stored as a ReadonlySet for O(1) lookup during traversal.
 */
export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
]);

// ---------------------------------------------------------------------------
// FileModel
// ---------------------------------------------------------------------------

/**
 * Metadata for a single discovered source file.
 *
 * Produced by the scanner during source discovery. Each FileModel
 * represents one file that should be parsed and analyzed. Files that
 * are discovered but excluded by ignore rules are still represented
 * (with `ignored: true`) for accurate counting and debugging.
 *
 * ## Lifecycle
 *
 * 1. **Created** by the file walker during traversal
 * 2. **Filtered** by the ignore resolver (sets `ignored: true` if excluded)
 * 3. **Consumed** by the parser (reads the file, produces AST)
 * 4. **Cached** by the cache module (keyed on absolutePath + hash)
 *
 * ## Future fields
 *
 * - `hash`: SHA-256 of file contents (added in caching milestone)
 * - `ast`: Reference to parsed AST (added in parsing milestone)
 * - `language`: 'typescript' | 'javascript' (derived from extension for now)
 */
export interface FileModel {
  // ------------------------------------------------------------------
  // Identity
  // ------------------------------------------------------------------

  /**
   * Absolute path to the file on disk.
   *
   * This is the canonical identifier for the file. The cache module
   * uses this as the primary cache key. The reporter uses it to
   * display file locations in output.
   *
   * Example: `/Users/dev/my-app/src/components/Button.tsx`
   */
  absolutePath: string;

  /**
   * Path relative to the project root.
   *
   * Used in terminal output, SARIF reports, and anywhere the user
   * needs to see a concise file reference.
   *
   * Example: `src/components/Button.tsx`
   */
  relativePath: string;

  /**
   * File extension including the leading dot.
   *
   * Used by the parser dispatcher to select the correct AST parser.
   *
   * Example: `.tsx`
   */
  extension: FileExtension;

  /**
   * File name with extension, without the directory path.
   *
   * Used by the reporter for file-name-based grouping and by rules
   * that have file-naming conventions (e.g., "component files must
   * use PascalCase").
   *
   * Example: `Button.tsx`
   */
  fileName: string;

  // ------------------------------------------------------------------
  // Filesystem metadata
  // ------------------------------------------------------------------

  /**
   * File size in bytes.
   *
   * Used by:
   * - The parser to estimate memory requirements for large files
   * - Rules that flag oversized files (e.g., "component exceeds 500 lines")
   * - The reporter to show per-file size statistics
   */
  size: number;

  /**
   * Last modified time as a Unix timestamp (milliseconds since epoch).
   *
   * Stored as a number (not a Date) for:
   * - Fast integer comparison in cache freshness checks
   * - Trivial JSON serialization for the cache file format
   * - Deterministic sorting in reports
   */
  lastModified: number;

  // ------------------------------------------------------------------
  // Project membership
  // ------------------------------------------------------------------

  /**
   * Absolute path to the project root that owns this file.
   *
   * For single-package projects, this is the same as `projectRoot` in
   * the ProjectModel.
   *
   * For monorepos, each workspace package has its own project root.
   * This field identifies which package owns the file.
   */
  projectRoot: string;

  /**
   * For monorepo workspace packages: the package directory relative
   * to the workspace root.
   *
   * Example: `packages/mobile` or `apps/expo-app`
   *
   * `undefined` for files in the workspace root itself (config files,
   * scripts) or in single-package projects.
   */
  workspace?: string;

  /**
   * For monorepo workspace packages: the package name from the
   * workspace package's `package.json`.
   *
   * Example: `@my-org/mobile-app`
   *
   * `undefined` for files in non-workspace projects or the workspace
   * root itself.
   */
  packageName?: string;

  // ------------------------------------------------------------------
  // Filtering
  // ------------------------------------------------------------------

  /**
   * Whether this file is excluded by ignore rules.
   *
   * The scanner discovers ALL files during traversal, then applies
   * ignore rules. Files that match an ignore pattern are not deleted
   * — they are marked with `ignored: true`.
   *
   * This enables:
   * - Accurate file counts ("Found 500 files, 50 ignored, 450 to analyze")
   * - Debugging ("Why isn't my file being analyzed? Check ignore rules")
   * - Dry-run mode ("Show me what would be analyzed without actually analyzing")
   */
  ignored: boolean;

  /**
   * If ignored, which rule caused the exclusion.
   *
   * Examples:
   * - `"node_modules (built-in)"`
   * - `".gitignore:*.generated.* (line 12)"`
   * - `"dist (built-in)"`
   *
   * `undefined` when the file is not ignored.
   */
  ignoreReason?: string;
}

// ---------------------------------------------------------------------------
// Batch types
// ---------------------------------------------------------------------------

/**
 * Result of the source discovery operation.
 *
 * Separates files into analyzed and ignored buckets so consumers can
 * choose whether to process only active files or report on all files.
 */
export interface SourceDiscoveryResult {
  /** Files that passed all ignore filters and should be analyzed. */
  files: FileModel[];

  /** Files that were discovered but excluded by ignore rules. */
  ignored: FileModel[];

  /** Total time spent in filesystem traversal (milliseconds). */
  traversalTimeMs: number;

  /** Total number of directories visited during traversal. */
  directoriesVisited: number;

  /**
   * Non-fatal errors and warnings encountered during traversal.
   * Examples: permission denied on a single directory, broken symlinks,
   * unsupported workspace patterns. These do not cause the scan to fail
   * but may indicate incomplete results.
   *
   * `undefined` when no warnings were encountered (the common case).
   */
  warnings?: Error[];
}
