/**
 * AST Engine — Error Handling
 *
 * Structured error types for parse failures. A single file with a syntax
 * error must not prevent other files from being parsed. Errors are collected
 * per-file and surfaced to the reporter alongside rule findings.
 *
 * ## Design
 *
 * - Errors are **data**, not exceptions. They're collected in arrays rather
 *   than thrown, so the parser can continue processing other files.
 * - Each error carries a machine-readable `code` for filtering/metrics and
 *   a human-readable `message` for terminal output.
 * - The `ParseErrorCollector` class accumulates errors during parsing and
 *   provides them to the ASTSourceFile after parsing completes.
 *
 * @module ast/errors
 */

import type { ParseError, ParseErrorSeverity } from "./types.js";
import { ParseErrorSeverity as Severity } from "./types.js";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Machine-readable error codes for parse failures.
 *
 * Stable across versions — adding a code is non-breaking.
 * Removing or renaming a code is a breaking change.
 */
export enum ParseErrorCode {
  /** The file contains a TypeScript/JavaScript syntax error. */
  SYNTAX_ERROR = "SYNTAX_ERROR",

  /** The file uses syntax not supported by the configured TypeScript target. */
  UNSUPPORTED_SYNTAX = "UNSUPPORTED_SYNTAX",

  /** The file could not be read (deleted, permission denied, encoding issue). */
  FILE_READ_ERROR = "FILE_READ_ERROR",

  /** The file was skipped because its extension is not supported. */
  UNSUPPORTED_EXTENSION = "UNSUPPORTED_EXTENSION",

  /** The file exceeds the configured maximum size for parsing. */
  FILE_TOO_LARGE = "FILE_TOO_LARGE",

  /** A type could not be resolved (non-fatal, type information unavailable). */
  TYPE_RESOLUTION_ERROR = "TYPE_RESOLUTION_ERROR",
}

// ---------------------------------------------------------------------------
// Error collector
// ---------------------------------------------------------------------------

/**
 * Collects parse errors during the parsing of a single file.
 *
 * Used internally by {@link ASTSourceFile}. After parsing completes,
 * the collected errors are frozen into an immutable array.
 *
 * @example
 * ```typescript
 * const collector = new ParseErrorCollector(filePath);
 * collector.add(ParseErrorCode.SYNTAX_ERROR, "Unexpected token", 10, 5);
 * const errors = collector.freeze(); // readonly
 * ```
 */
export class ParseErrorCollector {
  private readonly errors: ParseError[] = [];
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Add an error to the collector.
   *
   * @param code - Machine-readable error code.
   * @param message - Human-readable description.
   * @param line - 1-based line number (optional).
   * @param column - 1-based column number (optional).
   * @param severity - Error severity (default: Error).
   */
  add(
    code: ParseErrorCode,
    message: string,
    line?: number,
    column?: number,
    severity: ParseErrorSeverity = Severity.Error,
  ): void {
    this.errors.push({
      code,
      message,
      severity,
      filePath: this.filePath,
      line,
      column,
    });
  }

  /**
   * Whether any errors have been collected.
   */
  get hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Number of errors collected so far.
   */
  get count(): number {
    return this.errors.length;
  }

  /**
   * Freeze the collected errors into an immutable snapshot.
   *
   * After calling this, further calls to `add()` will add to the
   * snapshot (the reference is broken).
   */
  freeze(): readonly ParseError[] {
    return [...this.errors];
  }
}

// ---------------------------------------------------------------------------
// Helper: convert TypeScript diagnostics to our error format
// ---------------------------------------------------------------------------

/**
 * Convert a TypeScript diagnostic (from ts-morph or raw TS API) to our
 * {@link ParseError} format.
 *
 * This is the bridge between the TS compiler's error reporting and our
 * abstraction layer. All TypeScript-specific fields (like `category` and
 * `code`) are mapped to our stable error codes.
 *
 * @param diagnostic - A TypeScript diagnostic object.
 * @param filePath - Absolute path to the file containing the error.
 * @returns A normalized ParseError.
 */
export function fromTypeScriptDiagnostic(
  diagnostic: {
    messageText: string | { messageText: string };
    category: number; // 0 = Warning, 1 = Error
    code: number;
    start?: number;
    length?: number;
  },
  filePath: string,
): ParseError {
  // TypeScript wraps long messages in a nested object.
  // Extract the top-level message text.
  const message =
    typeof diagnostic.messageText === "string"
      ? diagnostic.messageText
      : diagnostic.messageText.messageText;

  // Map TypeScript diagnostic category to our severity
  // Category 0 = Warning, 1 = Error
  const severity = diagnostic.category === 0 ? Severity.Warning : Severity.Error;

  // Map TypeScript error codes to our ParseErrorCode
  let code: ParseErrorCode;
  switch (diagnostic.code) {
    case 2304: // Cannot find name
    case 2551: // Cannot find name (did you mean?)
      code = ParseErrorCode.TYPE_RESOLUTION_ERROR;
      break;
    case 1005: // ',' expected
    case 1128: // Declaration or statement expected
    case 1109: // Expression expected
    case 1434: // Unexpected keyword
    case 1435: // Unexpected token
    case 1483: // Unterminated string literal
    case 1160: // Unterminated template literal
      code = ParseErrorCode.SYNTAX_ERROR;
      break;
    default:
      // For unknown TS error codes, classify based on category
      code =
        severity === Severity.Error
          ? ParseErrorCode.SYNTAX_ERROR
          : ParseErrorCode.UNSUPPORTED_SYNTAX;
      break;
  }

  return {
    code,
    message,
    severity,
    filePath,
    line: diagnostic.start !== undefined ? diagnostic.start : undefined,
    column: undefined, // TypeScript diagnostics use offset, not line/column
  };
}
