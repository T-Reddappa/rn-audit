/**
 * AST Source File
 *
 * Wraps a single parsed source file. Provides traversal via the visitor
 * pattern and direct AST access for query helpers.
 *
 * ## Visitor pattern
 *
 * The `traverse()` method walks the AST depth-first and calls visitor
 * handlers for matching `SyntaxKind` values. This is the same pattern
 * used by ESLint, Babel, and the TypeScript compiler itself.
 *
 * ## How ESLint, TypeScript, and Biome implement visitors
 *
 * - **ESLint**: Uses ESTree AST nodes with `estraverse` for traversal.
 *   Visitors are objects keyed by node type string (e.g., `"CallExpression"`).
 *   No type information.
 * - **TypeScript Compiler**: Uses `ts.forEachChild()` with a callback that
 *   receives `ts.Node`. The callback returns `void` — `skipChildren` is
 *   not supported; you must manually implement pruning.
 * - **Biome**: Uses its own CST (Concrete Syntax Tree) with a query-based
 *   approach rather than visitors.
 * - **rn-audit**: Uses ts-morph (→ TypeScript AST) with a visitor pattern
 *   that supports `skipChildren` for efficient subtree pruning.
 *
 * @module ast/source-file
 */

import type { SourceFile, Node } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { FileModel } from "../types/file.js";
import type { ASTSourceFile, ASTNode, ASTVisitor, VisitorContext, ParseError } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an ASTSourceFile wrapper around a ts-morph SourceFile.
 *
 * @param fileModel - The scanner's FileModel for this file.
 * @param tsSourceFile - The ts-morph SourceFile (parsed AST), or null
 *   if the file could not be parsed.
 * @param parseErrors - Parse errors collected during parsing.
 * @returns A fully initialized ASTSourceFile.
 */
export function createASTSourceFile(
  fileModel: FileModel,
  tsSourceFile: SourceFile | null,
  parseErrors: readonly ParseError[],
): ASTSourceFile {
  const isParsed = tsSourceFile !== null && parseErrors.length === 0;

  // Build the base object without traverse/getRoot first,
  // then attach the methods that reference `self`.
  const self: ASTSourceFile = {
    filePath: fileModel.absolutePath,
    fileName: fileModel.fileName,
    isParsed,
    parseErrors: [...parseErrors],
    traverse: () => {}, // placeholder — replaced below
    getRoot: () => {
      throw new Error("Not initialized");
    }, // placeholder
  };

  // ----------------------------------------------------------------
  // Traversal
  // ----------------------------------------------------------------

  self.traverse = function traverse(visitor: ASTVisitor): void {
    if (!tsSourceFile) {
      return; // File couldn't be parsed — nothing to traverse
    }

    // Build the set of SyntaxKind values the visitor cares about.
    const visitedKinds = new Set(Object.keys(visitor).map(Number));

    // Stack of ancestor ASTNodes for context
    const ancestorStack: ASTNode[] = [];

    /**
     * Recursive depth-first traversal.
     *
     * For each node:
     * 1. Check if the visitor has a handler for this node's SyntaxKind
     * 2. If yes, call the handler with the node and context
     * 3. If the handler set `skipChildren: true`, prune the subtree
     * 4. Otherwise, recurse into children
     */
    function walk(node: Node, depth: number): void {
      const kind = node.getKind();

      // Check if any visitor cares about this node kind
      if (visitedKinds.has(kind)) {
        const handler = visitor[kind];
        if (handler) {
          // Build context for the handler
          const parentNode: ASTNode | undefined =
            ancestorStack.length > 0 ? ancestorStack[ancestorStack.length - 1] : undefined;

          const ctx: VisitorContext = {
            sourceFile: self,
            parent: parentNode,
            ancestors: [...ancestorStack],
            depth,
            skipChildren: false,
          };

          // Call the handler with our wrapped node
          handler(wrapNode(node), ctx);

          // If the handler requested subtree pruning, return without
          // recursing into children
          if (ctx.skipChildren) {
            return;
          }
        }
      }

      // Recurse into children
      ancestorStack.push(wrapNode(node));
      node.forEachChild((child) => walk(child, depth + 1));
      ancestorStack.pop();
    }

    walk(tsSourceFile, 0);
  };

  // ----------------------------------------------------------------
  // Root access
  // ----------------------------------------------------------------

  self.getRoot = function getRoot(): ASTNode {
    if (!tsSourceFile) {
      throw new Error(`Cannot get root of unparsed file: ${fileModel.absolutePath}`);
    }
    return wrapNode(tsSourceFile);
  };

  return self;
}

// ---------------------------------------------------------------------------
// Node wrapping
// ---------------------------------------------------------------------------

/**
 * Wrap a ts-morph Node in our ASTNode abstraction.
 *
 * This is the ONLY place where ts-morph's Node type is wrapped in our
 * `ASTNode` interface. All other code passes `ASTNode` values around
 * without ever touching the internal ts-morph reference.
 *
 * Design decision: we use a simple wrapper object rather than a class
 * to keep the API minimal and avoid `instanceof` dependencies on our
 * internal classes.
 */
function wrapNode(node: Node): ASTNode {
  return {
    _internal: node as unknown,
  };
}

// ---------------------------------------------------------------------------
// Re-export SyntaxKind
// ---------------------------------------------------------------------------

/**
 * Re-export TypeScript's SyntaxKind enum from ts-morph.
 *
 * ts-morph re-exports SyntaxKind from the underlying TypeScript compiler.
 * By re-exporting from here, consumers only need to import from our
 * `src/ast/` module — they never need to add ts-morph as a direct
 * dependency.
 */
export { SyntaxKind };
