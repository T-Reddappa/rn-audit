/**
 * Scanner Error Hierarchy
 *
 * Typed errors for every failure mode in the source discovery pipeline.
 * Each error class carries structured context (file path, OS error code,
 * original error) so callers can handle failures appropriately without
 * parsing human-readable message strings.
 *
 * ## Design
 *
 * - **Base class**: {@link ScannerError} — all scanner errors extend this.
 *   Callers can `catch (e instanceof ScannerError)` for generic handling.
 * - **Specific classes**: Each failure mode has its own class with
 *   additional context fields. Callers switch on `instanceof` or
 *   `error.code` for granular handling.
 * - **Error codes**: Machine-readable enum values for logging, metrics,
 *   and future error-code-based reporting.
 *
 * ## Usage
 *
 * ```typescript
 * try {
 *   walkSourceFiles({ projectRoot });
 * } catch (error) {
 *   if (error instanceof PermissionDeniedError) {
 *     logger.warn(`Skipping ${error.path}: permission denied`);
 *     // Continue with partial results
 *   } else if (error instanceof ScannerError) {
 *     logger.error(`Scanner failed: ${error.message}`);
 *     throw error; // Fatal — abort
 *   }
 *   throw error; // Unknown error — re-throw
 * }
 * ```
 *
 * @module scanner/errors
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Machine-readable error codes for scanner failures.
 *
 * Each code maps to a specific error class. The code is stable across
 * versions — renaming a class won't break consumers that check the code.
 */
export enum ScannerErrorCode {
  /** Base code for unclassified scanner errors. */
  SCANNER_ERROR = "SCANNER_ERROR",

  /** File or directory cannot be read due to OS permissions. */
  PERMISSION_DENIED = "PERMISSION_DENIED",

  /** A symbolic link target does not exist or creates a cycle. */
  BROKEN_SYMLINK = "BROKEN_SYMLINK",

  /** A file was deleted between directory listing and stat. */
  FILE_NOT_FOUND = "FILE_NOT_FOUND",

  /** Workspace configuration is malformed (bad JSON, invalid YAML). */
  INVALID_WORKSPACE = "INVALID_WORKSPACE",

  /** A workspace glob pattern uses unsupported syntax. */
  UNSUPPORTED_PATTERN = "UNSUPPORTED_PATTERN",

  /** Traversal exceeded configured limits (depth or file count). */
  TRAVERSAL_LIMIT = "TRAVERSAL_LIMIT",
}

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

/**
 * Base error class for all scanner failures.
 *
 * Every scanner error has:
 * - `code` — machine-readable identifier for metrics and logging
 * - `path` — filesystem path involved in the error (for debugging)
 * - `cause` — the underlying system error, if any (for stack traces)
 */
export class ScannerError extends Error {
  /** Machine-readable error code. Stable across versions. */
  public readonly code: ScannerErrorCode;

  /** Filesystem path associated with the error. */
  public readonly path: string;

  /** Underlying system error that triggered this scanner error. */
  public readonly cause?: unknown;

  constructor(
    code: ScannerErrorCode,
    message: string,
    path: string,
    cause?: unknown,
  ) {
    super(message);
    // Restore prototype for instanceof checks (required when extending
    // built-in Error in TypeScript targeting ES2015+)
    Object.setPrototypeOf(this, ScannerError.prototype);

    this.code = code;
    this.path = path;
    this.cause = cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ScannerError);
    }
  }

  override toString(): string {
    return `[${this.code}] ${this.message} (path: ${this.path})`;
  }
}

// ---------------------------------------------------------------------------
// Specific error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when a file or directory cannot be read due to operating system
 * permissions (EACCES, EPERM).
 *
 * This is a **recoverable** error — the scanner should skip the inaccessible
 * path and continue scanning other files.
 *
 * Common causes:
 * - `node_modules` owned by root after `sudo npm install`
 * - macOS privacy restrictions on Desktop/Documents folders
 * - Corporate security software blocking access to certain paths
 */
export class PermissionDeniedError extends ScannerError {
  /** OS-level error code (e.g., "EACCES", "EPERM"). */
  public readonly syscall: string;

  constructor(path: string, syscall: string, cause?: unknown) {
    super(
      ScannerErrorCode.PERMISSION_DENIED,
      `Permission denied: ${path}`,
      path,
      cause,
    );
    Object.setPrototypeOf(this, PermissionDeniedError.prototype);
    this.syscall = syscall;
  }
}

/**
 * Thrown when a symbolic link's target does not exist, the link is
 * circular, or the link points outside the project boundary.
 *
 * This is a **recoverable** error — the scanner skips the broken symlink
 * and continues.
 *
 * Symlink loops are detected by tracking visited inode numbers during
 * traversal. A maximum symlink chain depth (default: 20) prevents
 * infinite resolution.
 */
export class BrokenSymlinkError extends ScannerError {
  /** The symlink target path that couldn't be resolved. */
  public readonly target: string;

  constructor(path: string, target: string, cause?: unknown) {
    super(
      ScannerErrorCode.BROKEN_SYMLINK,
      `Broken symbolic link: ${path} → ${target}`,
      path,
      cause,
    );
    Object.setPrototypeOf(this, BrokenSymlinkError.prototype);
    this.target = target;
  }
}

/**
 * Thrown when a file is listed in a directory but no longer exists when
 * the scanner attempts to stat it (TOCTOU race condition).
 *
 * This is a **recoverable** and **expected** error — it happens when a
 * build tool, editor, or file watcher modifies files during the scan.
 * The scanner silently skips the file and continues.
 *
 * Not thrown by default — file walker silently skips missing files.
 * This error class exists for strict mode (`strict: true`) where
 * TOCTOU races should be surfaced.
 */
export class FileNotFoundError extends ScannerError {
  constructor(path: string, cause?: unknown) {
    super(
      ScannerErrorCode.FILE_NOT_FOUND,
      `File not found during scan: ${path} (deleted between readdir and stat)`,
      path,
      cause,
    );
    Object.setPrototypeOf(this, FileNotFoundError.prototype);
  }
}

/**
 * Thrown when workspace configuration cannot be parsed.
 *
 * This is a **recoverable** error — the scanner treats the project as
 * a single-package project and continues. The invalid workspace config
 * is reported as a warning.
 *
 * Examples:
 * - `pnpm-workspace.yaml` contains invalid YAML
 * - `package.json` workspaces field is the wrong type
 */
export class InvalidWorkspaceError extends ScannerError {
  /** Path to the configuration file that couldn't be parsed. */
  public readonly configPath: string;

  constructor(configPath: string, detail: string, cause?: unknown) {
    super(
      ScannerErrorCode.INVALID_WORKSPACE,
      `Invalid workspace configuration in ${configPath}: ${detail}`,
      configPath,
      cause,
    );
    Object.setPrototypeOf(this, InvalidWorkspaceError.prototype);
    this.configPath = configPath;
  }
}

/**
 * Thrown (or logged) when a workspace glob pattern uses syntax that
 * the Phase 1 resolver cannot handle.
 *
 * This is a **recoverable** informational condition — the pattern is
 * skipped with a message. Not thrown by default; logged via the
 * progress callback.
 *
 * Phase 2 will add full glob support and this error type will be
 * retired (or repurposed for truly malformed patterns).
 */
export class UnsupportedPatternError extends ScannerError {
  /** The unsupported glob pattern. */
  public readonly pattern: string;

  /** Which syntax feature is unsupported. */
  public readonly feature: string;

  constructor(pattern: string, feature: string) {
    super(
      ScannerErrorCode.UNSUPPORTED_PATTERN,
      `Unsupported glob syntax in workspace pattern "${pattern}": ${feature}. ` +
        "This pattern will be skipped. Full glob support is planned for Phase 2.",
      pattern,
    );
    Object.setPrototypeOf(this, UnsupportedPatternError.prototype);
    this.pattern = pattern;
    this.feature = feature;
  }
}

/**
 * Thrown when traversal exceeds configured safety limits.
 *
 * This is a **fatal** error — the scan is aborted. It indicates either
 * a configuration error (limits set too low) or a pathological project
 * structure (circular symlinks, infinite directory nesting).
 *
 * Limits:
 * - Maximum directory depth (default: 50)
 * - Maximum file count (default: 500,000)
 */
export class TraversalLimitError extends ScannerError {
  /** Which limit was exceeded. */
  public readonly limit: "depth" | "fileCount";

  /** The configured maximum value. */
  public readonly max: number;

  constructor(limit: "depth" | "fileCount", max: number, path: string) {
    const description =
      limit === "depth"
        ? `Maximum directory depth (${max}) exceeded at ${path}`
        : `Maximum file count (${max}) exceeded. ` +
          "Increase the limit via configuration if your project is this large.";

    super(ScannerErrorCode.TRAVERSAL_LIMIT, description, path);
    Object.setPrototypeOf(this, TraversalLimitError.prototype);
    this.limit = limit;
    this.max = max;
  }
}
