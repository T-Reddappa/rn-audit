/**
 * AST Traversal Primitives
 *
 * Low-level functions for navigating and inspecting the AST. These are
 * the building blocks that query helpers and rules compose into analysis
 * logic. Every function operates on our {@link ASTNode} abstraction —
 * no ts-morph types are exposed.
 *
 * ## Design principles
 *
 * 1. **Pure functions**: Every function takes nodes as input and returns
 *    data as output. No mutation, no side effects, no stored state.
 * 2. **Composable**: Functions are small and focused. Complex traversals
 *    are built by composing primitives (like `Array.filter` + `Array.map`).
 * 3. **Framework-agnostic**: These functions use only our ASTNode interface.
 *    If we migrate from ts-morph to the raw TS Compiler API, these
 *    functions are the only layer that changes.
 *
 * ## Relationship to ts-morph
 *
 * Internally, these functions unwrap `ASTNode._internal` to access the
 * underlying ts-morph `Node`. This is the ONLY module outside of
 * `source-file.ts` that touches `_internal`. All other modules use
 * these primitives.
 *
 * @module ast/visitors
 */

import type { Node } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { ASTNode } from "./types.js";

// ---------------------------------------------------------------------------
// Node introspection
// ---------------------------------------------------------------------------

/**
 * Get the TypeScript SyntaxKind of an AST node.
 *
 * This is the primary way rules identify what they're looking at.
 * Every node in the AST has a SyntaxKind — `CallExpression`,
 * `JsxElement`, `VariableDeclaration`, etc.
 *
 * @example
 * ```typescript
 * const kind = getKind(node);
 * if (kind === SyntaxKind.CallExpression) {
 *   // This node is a function call
 * }
 * ```
 */
export function getKind(node: ASTNode): SyntaxKind {
  return (node._internal as Node).getKind();
}

/**
 * Get the source text of an AST node.
 *
 * Returns the exact text from the original source file, including
 * whitespace and comments within the node's range.
 *
 * @example
 * ```typescript
 * const text = getText(node);
 * // text might be: "StyleSheet.create({ ... })"
 * ```
 */
export function getText(node: ASTNode): string {
  return (node._internal as Node).getText();
}

/**
 * Get the full source text including leading and trailing trivia
 * (comments, whitespace) attached to this node.
 */
export function getFullText(node: ASTNode): string {
  return (node._internal as Node).getFullText();
}

/**
 * Get the starting position of the node in the source file
 * (0-based character offset).
 */
export function getStart(node: ASTNode): number {
  return (node._internal as Node).getStart();
}

/** Get the exclusive end position as a zero-based UTF-16 offset. */
export function getEnd(node: ASTNode): number {
  return (node._internal as Node).getEnd();
}

/**
 * Get the 1-based line number where this node starts.
 */
export function getStartLine(node: ASTNode): number {
  return (node._internal as Node).getStartLineNumber();
}

/** Get the 1-based column where the node starts. */
export function getStartColumn(node: ASTNode): number {
  const internal = node._internal as Node;
  return internal.getSourceFile().getLineAndColumnAtPos(internal.getStart()).column;
}

/** Get the 1-based line containing the node's exclusive end position. */
export function getEndLine(node: ASTNode): number {
  const internal = node._internal as Node;
  return internal.getSourceFile().getLineAndColumnAtPos(internal.getEnd()).line;
}

/** Get the 1-based column at the node's exclusive end position. */
export function getEndColumn(node: ASTNode): number {
  const internal = node._internal as Node;
  return internal.getSourceFile().getLineAndColumnAtPos(internal.getEnd()).column;
}

// ---------------------------------------------------------------------------
// Tree navigation
// ---------------------------------------------------------------------------

/**
 * Get the parent node, or undefined if this is the root.
 *
 * Rules use this to inspect context — e.g., "is this JSX element
 * inside a ScrollView?"
 */
export function getParent(node: ASTNode): ASTNode | undefined {
  const parent = (node._internal as Node).getParent();
  if (!parent) return undefined;
  // The SourceFile node has no parent — it's the root
  if (parent.getKind() === SyntaxKind.SourceFile) {
    // Still return the SourceFile as a valid parent
    return { _internal: parent as unknown };
  }
  return { _internal: parent as unknown };
}

/**
 * Get all ancestors from parent to root.
 *
 * Returns an array starting with the immediate parent and ending
 * with the SourceFile root node.
 *
 * @example
 * ```typescript
 * const ancestors = getAncestors(node);
 * // ancestors[0] = parent
 * // ancestors[ancestors.length - 1] = SourceFile
 * ```
 */
export function getAncestors(node: ASTNode): ASTNode[] {
  const ancestors: ASTNode[] = [];
  let current: ASTNode | undefined = getParent(node);

  while (current) {
    ancestors.push(current);
    current = getParent(current);
  }

  return ancestors;
}

/**
 * Get the direct children of a node.
 *
 * Does NOT include grandchildren — only immediate children in the AST.
 */
export function getChildren(node: ASTNode): ASTNode[] {
  return (node._internal as Node).getChildren().map((child) => ({
    _internal: child as unknown,
  }));
}

// ---------------------------------------------------------------------------
// Traversal (walking the tree)
// ---------------------------------------------------------------------------

/**
 * Visit the direct children of a node.
 *
 * The callback is invoked for each immediate child. Does NOT recurse
 * into grandchildren.
 *
 * @param node - The node whose children to visit.
 * @param callback - Called for each child. Return `false` to stop iteration.
 */
export function visitChildren(
  node: ASTNode,
  callback: (child: ASTNode, index: number) => void | false,
): void {
  let i = 0;
  let stopped = false;
  (node._internal as Node).forEachChild((child) => {
    if (stopped) return;
    const result = callback({ _internal: child as unknown }, i++);
    if (result === false) stopped = true;
  });
}

/**
 * Visit all descendants of a node (depth-first).
 *
 * This is a full recursive walk. The callback receives every descendant
 * node in the subtree. Use `findNodes` instead if you only care about
 * nodes of a specific SyntaxKind — it's more efficient.
 *
 * @param node - The root of the subtree to traverse.
 * @param callback - Called for each descendant. Return `false` to skip
 *   that node's children (prune the subtree).
 */
export function visitDescendants(
  node: ASTNode,
  callback: (descendant: ASTNode, depth: number) => void | false,
): void {
  function walk(current: ASTNode, depth: number): void {
    const shouldRecurse = callback(current, depth);

    if (shouldRecurse === false) {
      return; // Callback pruned this subtree
    }

    for (const child of getChildren(current)) {
      walk(child, depth + 1);
    }
  }

  // Start from children (don't invoke callback for the root node itself)
  for (const child of getChildren(node)) {
    walk(child, 1);
  }
}

// ---------------------------------------------------------------------------
// Node finding
// ---------------------------------------------------------------------------

/**
 * Find all descendant nodes of a given SyntaxKind.
 *
 * This is the most commonly used function in rules. It efficiently
 * finds all nodes of a specific type without visiting every node
 * (it checks kind before recursing).
 *
 * @example
 * ```typescript
 * // Find all JSX elements in a file
 * const jsxElements = findNodes(sourceFile.getRoot(), SyntaxKind.JsxElement);
 * const jsxSelfClosing = findNodes(sourceFile.getRoot(), SyntaxKind.JsxSelfClosingElement);
 * ```
 *
 * @param node - The root to search from.
 * @param kind - The SyntaxKind to match.
 * @returns All matching descendant nodes, in depth-first order.
 */
export function findNodes(node: ASTNode, kind: SyntaxKind): ASTNode[] {
  const results: ASTNode[] = [];

  visitDescendants(node, (descendant) => {
    if (getKind(descendant) === kind) {
      results.push(descendant);
    }
    return undefined; // Continue recursing
  });

  return results;
}

/**
 * Find all descendant nodes matching any of the given SyntaxKinds.
 *
 * More efficient than calling `findNodes` multiple times and merging,
 * because the tree is walked only once.
 *
 * @param node - The root to search from.
 * @param kinds - The SyntaxKind values to match.
 * @returns All matching descendant nodes, in depth-first order.
 */
export function findNodesByKinds(node: ASTNode, kinds: SyntaxKind[]): ASTNode[] {
  const kindSet = new Set(kinds);
  const results: ASTNode[] = [];

  visitDescendants(node, (descendant) => {
    if (kindSet.has(getKind(descendant))) {
      results.push(descendant);
    }
    return undefined;
  });

  return results;
}

/**
 * Find the first descendant node of a given SyntaxKind.
 *
 * Stops traversing as soon as a match is found. Use when you only
 * care about the first occurrence (e.g., "does this file have a
 * default export?").
 *
 * @returns The first matching node, or undefined if none found.
 */
export function findFirst(node: ASTNode, kind: SyntaxKind): ASTNode | undefined {
  const results = findNodes(node, kind);
  return results[0];
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Filter an array of nodes by a predicate.
 *
 * Convenience wrapper. Rules often do:
 * ```typescript
 * const allCalls = findNodes(root, SyntaxKind.CallExpression);
 * const styleCalls = filterNodes(allCalls, (node) => {
 *   return getText(node).startsWith("StyleSheet.create");
 * });
 * ```
 */
export function filterNodes(nodes: ASTNode[], predicate: (node: ASTNode) => boolean): ASTNode[] {
  return nodes.filter(predicate);
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { SyntaxKind };
