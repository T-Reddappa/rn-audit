/**
 * AST Engine — Type Definitions
 *
 * Core types for the AST subsystem. These types form the contract between
 * the AST engine and every future subsystem: Rule Engine, Auto-Fix Engine,
 * VS Code Extension, and Runtime Analyzer.
 *
 * ## Abstraction principle
 *
 * Types in this module reference TypeScript's `SyntaxKind` enum (for node
 * type identification) but NEVER reference ts-morph classes directly.
 * Consumers import from this module and from `typescript` (for SyntaxKind),
 * never from `ts-morph`.
 *
 * This means if we migrate from ts-morph to the raw TypeScript Compiler
 * API (or to a Rust-based parser), only the implementation files change.
 * The type contracts remain stable.
 *
 * @module ast/types
 */

// ---------------------------------------------------------------------------
// AST Node — our abstraction over any parsed AST node
// ---------------------------------------------------------------------------

/**
 * Represents a single node in the parsed AST.
 *
 * This is an opaque handle — consumers never access internal properties
 * directly. Instead, they use the visitor and query helper functions
 * exported by this module.
 *
 * Internally, this wraps a ts-morph `Node` instance. The `_internal`
 * property is marked with a leading underscore and documented as
 * off-limits. Direct access to `_internal` is a code smell that
 * indicates a missing abstraction in our API.
 */
export interface ASTNode {
  /** @internal — ts-morph Node instance. Do not access directly. */
  readonly _internal: unknown;
}

// ---------------------------------------------------------------------------
// Source file
// ---------------------------------------------------------------------------

/**
 * A single parsed source file in the AST project.
 *
 * Each ASTSourceFile wraps one file from the scanner's FileModel.
 * It provides traversal and query access without exposing ts-morph.
 *
 * ## Lifecycle
 *
 * 1. Created by {@link ASTProject.addSourceFile} when a file is added.
 * 2. Parsed lazily on first access or eagerly during project init (configurable).
 * 3. Traversed by rules via `traverse()`.
 * 4. Cached between runs (file content hash determines cache validity).
 */
export interface ASTSourceFile {
  /** Absolute path to the source file. Matches FileModel.absolutePath. */
  readonly filePath: string;

  /** File name with extension. Matches FileModel.fileName. */
  readonly fileName: string;

  /** Whether this file was successfully parsed (no syntax errors). */
  readonly isParsed: boolean;

  /** Parse errors, if any. Empty array if parsing succeeded. */
  readonly parseErrors: ParseError[];

  /**
   * Traverse the AST with a visitor.
   *
   * The visitor is an object mapping `SyntaxKind` values to handler
   * functions. The engine walks the AST depth-first and calls the
   * appropriate handler for each node.
   *
   * This is the primary API that rules use. Each rule declares which
   * node types it cares about and receives callbacks for matching nodes.
   *
   * @example
   * ```typescript
   * sourceFile.traverse({
   *   [SyntaxKind.CallExpression]: (node, ctx) => {
   *     // Check if this is a StyleSheet.create() call
   *   },
   *   [SyntaxKind.JsxElement]: (node, ctx) => {
   *     // Check JSX elements for inline styles
   *   },
   * });
   * ```
   */
  traverse(visitor: ASTVisitor): void;

  /**
   * Get the root AST node for this file.
   *
   * Advanced use only. Most consumers should use `traverse()` instead.
   * Direct AST manipulation indicates a gap in the visitor/query API.
   */
  getRoot(): ASTNode;
}

// ---------------------------------------------------------------------------
// AST Project
// ---------------------------------------------------------------------------

/**
 * The top-level AST project — wraps a ts-morph `Project`.
 *
 * Owns all parsed source files and the shared TypeScript program.
 * Created once per audit run. Provides access to individual source
 * files and aggregate operations (type checking, module resolution).
 *
 * ## Lifecycle
 *
 * 1. Created via {@link createASTProject} with scanner's ProjectModel.
 * 2. Source files are added and parsed (lazily or eagerly).
 * 3. Rules traverse source files via `sourceFile.traverse()`.
 * 4. Discarded after the audit completes.
 */
export interface ASTProject {
  /** Absolute path to the project root. */
  readonly root: string;

  /** Total number of source files in the project. */
  readonly fileCount: number;

  /**
   * Get a source file by its absolute path.
   *
   * @returns The ASTSourceFile, or undefined if the path is not in the project.
   */
  getSourceFile(path: string): ASTSourceFile | undefined;

  /**
   * Get all source files in the project.
   *
   * @returns An iterable of all parsed source files.
   */
  getSourceFiles(): Iterable<ASTSourceFile>;
}

// ---------------------------------------------------------------------------
// Visitor
// ---------------------------------------------------------------------------

/**
 * Context passed to visitor handler functions.
 *
 * Provides access to the current node's parent, the source file,
 * and the type checker (for type-aware rules).
 *
 * Future: add `report()` method for findings (when the rule engine
 * is integrated).
 */
export interface VisitorContext {
  /** The ASTSourceFile being traversed. */
  readonly sourceFile: ASTSourceFile;

  /** The parent node of the current node, if any. */
  readonly parent: ASTNode | undefined;

  /** Stack of ancestor nodes from root to current node's parent. */
  readonly ancestors: ReadonlyArray<ASTNode>;

  /** Current traversal depth (root = 0). */
  readonly depth: number;

  /**
   * Whether to skip traversing the children of the current node.
   * Set to `true` in a visitor handler to prune the subtree.
   */
  skipChildren: boolean;
}

/**
 * A visitor for AST traversal.
 *
 * Maps TypeScript `SyntaxKind` enum values to handler functions.
 * When the traverser encounters a node of a given kind, it calls
 * the corresponding handler.
 *
 * Handlers are optional — if a `SyntaxKind` is not in the visitor
 * object, nodes of that kind are still traversed (their children
 * are visited) but no callback is invoked.
 *
 * @example
 * ```typescript
 * const visitor: ASTVisitor = {
 *   [SyntaxKind.JsxElement]: (node, ctx) => {
 *     // Inspect every JSX element in the file
 *   },
 * };
 * ```
 */
export interface ASTVisitor {
  [kind: number]: ((node: ASTNode, context: VisitorContext) => void) | undefined;
}

// ---------------------------------------------------------------------------
// Parse errors
// ---------------------------------------------------------------------------

/**
 * Severity of a parse problem.
 */
export enum ParseErrorSeverity {
  /** The file could not be parsed at all (syntax error). Skipped. */
  Error = "error",
  /** The file was parsed but has non-fatal issues (e.g., unsupported syntax). */
  Warning = "warning",
}

/**
 * A structured error or warning from the parser.
 *
 * Stored in {@link ASTSourceFile.parseErrors} so the reporter can
 * surface parse problems alongside rule findings.
 */
export interface ParseError {
  /** Machine-readable error code. */
  code: string;

  /** Human-readable error message. */
  message: string;

  /** Error severity. */
  severity: ParseErrorSeverity;

  /** File path (absolute). */
  filePath: string;

  /** 1-based line number, if available. */
  line?: number;

  /** 1-based column number, if available. */
  column?: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * A single cache entry for a parsed source file.
 *
 * Cached on disk (in `node_modules/.cache/rn-audit/`) between runs.
 * Invalidated when the file content hash changes or the TypeScript
 * compiler options change.
 */
export interface ASTCacheEntry {
  /** SHA-256 hash of the file content at parse time. */
  contentHash: string;

  /** ISO 8601 timestamp of when the file was parsed. */
  parsedAt: string;

  /** Whether parsing succeeded. */
  parseSuccess: boolean;

  /** Parse errors (empty if parsing succeeded). */
  parseErrors: ParseError[];

  /** rn-audit version that produced this cache entry. */
  toolVersion: string;
}

// ---------------------------------------------------------------------------
// Project options
// ---------------------------------------------------------------------------

/**
 * Options for creating an AST project.
 */
export interface ASTProjectOptions {
  /** Whether to parse all files eagerly (true) or lazily (false, default). */
  eagerParsing?: boolean;

  /** Whether to use the cache (default: true). */
  useCache?: boolean;

  /** Override TypeScript compiler options. Merged with tsconfig.json. */
  compilerOptions?: Record<string, unknown>;
}
