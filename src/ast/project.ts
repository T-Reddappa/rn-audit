/**
 * AST Project
 *
 * The top-level AST container — wraps a ts-morph `Project` and manages
 * the lifecycle of all parsed source files. Created once per audit run
 * from the scanner's output.
 *
 * ## How ts-morph implements the Project internally
 *
 * ts-morph creates a `ts.CompilerHost` that reads files from disk,
 * a `ts.Program` that coordinates parsing and type-checking across
 * all source files, and a `ts.DocumentRegistry` that tracks which
 * files have been modified. All of this is hidden behind a single
 * `Project` class.
 *
 * Without ts-morph, we'd need to:
 * 1. Read tsconfig.json manually and parse compiler options
 * 2. Create a CompilerHost that resolves modules and reads files
 * 3. Create a Program with addSourceFile() for each file
 * 4. Manage incremental parsing when files change
 * 5. Handle module resolution failures gracefully
 *
 * ts-morph collapses ~200 lines of setup into one constructor call.
 *
 * ## Lazy vs eager parsing
 *
 * - **Lazy (default)**: Files are parsed when first accessed. Faster
 *   startup, lower memory for large projects, but first traversal of
 *   each file incurs parse cost.
 * - **Eager**: All files are parsed during `initialize()`. Slower startup.
 *   Better for CI where every file will be analyzed anyway.
 *
 * ## Caching strategy
 *
 * Cache entries store the file content hash. On subsequent runs, files
 * with unchanged content skip re-parsing. The cache is invalidated when:
 * - File content changes (hash mismatch)
 * - TypeScript compiler options change (tsconfig.json modified)
 * - rn-audit version changes (rule engine may produce different results)
 *
 * @module ast/project
 */

import { Project, type CompilerOptions, type SourceFile } from "ts-morph";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectModel } from "../types/project.js";
import type { FileModel } from "../types/file.js";
import type {
  ASTProject as IASTProject,
  ASTSourceFile as IASTSourceFile,
  ASTProjectOptions,
} from "./types.js";
import { createASTSourceFile } from "./source-file.js";
import { ParseErrorCollector, ParseErrorCode } from "./errors.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an AST project from the scanner's output.
 *
 * This is the primary entry point for the AST subsystem. It:
 * 1. Creates a ts-morph Project with the project's tsconfig.json
 * 2. Adds all source files from the scanner's FileModel array
 * 3. Handles parse errors per-file (one bad file doesn't crash everything)
 * 4. Returns an ASTProject ready for traversal
 *
 * @param projectModel - The scanner's ProjectModel (project root, metadata).
 * @param sourceFiles - The scanner's active FileModel[] (files to analyze).
 * @param options - Optional configuration (eager/lazy parsing, cache).
 * @returns A fully initialized ASTProject.
 *
 * @example
 * ```typescript
 * const project = discoverProject();
 * const { files } = discoverSourceFiles(project);
 * const astProject = createASTProject(project, files);
 *
 * for (const sourceFile of astProject.getSourceFiles()) {
 *   sourceFile.traverse(myVisitor);
 * }
 * ```
 */
export function createASTProject(
  projectModel: ProjectModel,
  sourceFiles: FileModel[],
  options: ASTProjectOptions = {},
): IASTProject {
  // ------------------------------------------------------------------
  // Step 1: Locate tsconfig.json
  // ------------------------------------------------------------------
  const tsConfigPath = findTsConfig(projectModel.root);

  // ------------------------------------------------------------------
  // Step 2: Create the ts-morph Project
  // ------------------------------------------------------------------
  // ts-morph reads tsconfig.json, configures the CompilerHost,
  // and sets up the shared TypeScript Program — all in one call.
  const tsMorphProject = new Project({
    tsConfigFilePath: tsConfigPath ?? undefined,
    // Skip adding node_modules types by default — we only care about
    // project source files. Library types are resolved lazily when
    // a rule needs type information.
    skipAddingFilesFromTsConfig: false,
    // Override compiler options if provided.
    // Cast through unknown: our public API accepts Record<string, unknown>
    // so it doesn't couple to TypeScript's CompilerOptions type, but
    // ts-morph needs the real type internally.
    compilerOptions: options.compilerOptions
      ? (options.compilerOptions as CompilerOptions)
      : undefined,
  });

  // ------------------------------------------------------------------
  // Step 3: Add source files and parse
  // ------------------------------------------------------------------
  const fileMap = new Map<string, IASTSourceFile>();

  for (const fileModel of sourceFiles) {
    const astSourceFile = addSourceFileToProject(tsMorphProject, fileModel);

    if (astSourceFile) {
      fileMap.set(fileModel.absolutePath, astSourceFile);
    }
  }

  // If eager parsing is requested, resolve all lazy source files now.
  // This triggers parsing for files that haven't been accessed yet.
  if (options.eagerParsing) {
    for (const [, astFile] of fileMap) {
      // Accessing getRoot() forces parsing if the file was lazy
      astFile.getRoot();
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Build and return the ASTProject
  // ------------------------------------------------------------------
  return {
    root: projectModel.root,
    fileCount: fileMap.size,

    getSourceFile(path: string): IASTSourceFile | undefined {
      return fileMap.get(path);
    },

    getSourceFiles(): Iterable<IASTSourceFile> {
      return fileMap.values();
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find the project's tsconfig.json file.
 *
 * Checks, in order:
 * 1. `tsconfig.json` at the project root
 * 2. Returns null if not found (ts-morph uses sensible defaults)
 */
function findTsConfig(projectRoot: string): string | null {
  const tsConfigPath = resolve(projectRoot, "tsconfig.json");
  if (existsSync(tsConfigPath)) {
    return tsConfigPath;
  }
  return null;
}

/**
 * Add a single source file to the ts-morph Project and return our
 * ASTSourceFile wrapper.
 *
 * Handles parse errors gracefully — a syntax error in one file does
 * not prevent other files from being added to the project.
 *
 * @returns The ASTSourceFile wrapper, or null if the file could not be added.
 */
function addSourceFileToProject(
  tsMorphProject: Project,
  fileModel: FileModel,
): IASTSourceFile | null {
  const errorCollector = new ParseErrorCollector(fileModel.absolutePath);

  // --- Check: file still exists (could have been deleted between scan and parse) ---
  if (!existsSync(fileModel.absolutePath)) {
    errorCollector.add(ParseErrorCode.FILE_READ_ERROR, `File not found: ${fileModel.absolutePath}`);
    // Return a source file with just the error, no AST
    return createASTSourceFile(fileModel, null, errorCollector.freeze());
  }

  // --- Check: file size (optional, prevents OOM on enormous files) ---
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  if (fileModel.size > MAX_FILE_SIZE) {
    errorCollector.add(
      ParseErrorCode.FILE_TOO_LARGE,
      `File exceeds maximum size (${(fileModel.size / 1024 / 1024).toFixed(1)}MB > 10MB)`,
    );
    return createASTSourceFile(fileModel, null, errorCollector.freeze());
  }

  // --- Add to ts-morph project ---
  let tsSourceFile: SourceFile;
  try {
    // addSourceFileAtPath reads the file from disk, parses it, and
    // adds it to the shared TypeScript Program. If the file was already
    // added (via import resolution), returns the existing SourceFile.
    //
    // The file is parsed lazily by ts-morph — the AST is only created
    // when it's first accessed. This is the default behavior and is
    // what we want for large projects.
    tsSourceFile = tsMorphProject.addSourceFileAtPath(fileModel.absolutePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    errorCollector.add(ParseErrorCode.FILE_READ_ERROR, `Failed to add file to project: ${message}`);
    return createASTSourceFile(fileModel, null, errorCollector.freeze());
  }

  // --- Collect TypeScript diagnostics ---
  // ts-morph provides access to the raw TypeScript diagnostics.
  // We convert them to our error format for consumption by the reporter.
  // Only syntactic diagnostics indicate that parsing failed. Pre-emit
  // diagnostics also contain type/module-resolution errors, which are valid
  // inputs for a static analyser and must not mark the source file unparsed.
  const diagnostics = tsMorphProject.getProgram().getSyntacticDiagnostics(tsSourceFile);

  // For now, only collect syntax errors (not type errors).
  // Type errors are the rule engine's domain.
  for (const diagnostic of diagnostics) {
    if (diagnostic.getCategory() === 1) {
      const messageText = diagnostic.getMessageText();
      errorCollector.add(
        ParseErrorCode.SYNTAX_ERROR,
        typeof messageText === "string" ? messageText : messageText.getMessageText(),
        diagnostic.getStart() !== undefined
          ? tsSourceFile.getLineAndColumnAtPos(diagnostic.getStart()!).line
          : undefined,
        diagnostic.getStart() !== undefined
          ? tsSourceFile.getLineAndColumnAtPos(diagnostic.getStart()!).column
          : undefined,
      );
    }
  }

  // --- Build and return our wrapper ---
  return createASTSourceFile(fileModel, tsSourceFile, errorCollector.freeze());
}
