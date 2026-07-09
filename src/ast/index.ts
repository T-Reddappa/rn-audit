/**
 * AST Engine — Public API
 *
 * The single entry point for the AST subsystem. Provides:
 * - **Project creation**: {@link createASTProject} — wraps source files
 *   in a shared TypeScript program using ts-morph.
 * - **Traversal**: {@link ASTSourceFile.traverse} — visitor-pattern AST walking.
 * - **Primitives**: {@link visitors} — low-level tree navigation and node finding.
 * - **Queries**: {@link queries} — domain-specific pattern search (JSX elements,
 *   imports, hooks, components, call expressions).
 *
 * ## Usage (future Rule Engine)
 *
 * ```typescript
 * import { createASTProject } from "rn-audit/ast";
 * import { findJSXElements, getJSXTagName } from "rn-audit/ast/queries";
 * import { SyntaxKind } from "rn-audit/ast";
 *
 * const project = createASTProject(projectModel, sourceFiles);
 *
 * for (const sourceFile of project.getSourceFiles()) {
 *   sourceFile.traverse({
 *     [SyntaxKind.JsxElement]: (node, ctx) => {
 *       const tagName = getJSXTagName(node);
 *       if (tagName === "ScrollView") {
 *         // Rule: check for nested ScrollViews
 *       }
 *     },
 *   });
 * }
 * ```
 *
 * @module ast
 */

// Project creation
export { createASTProject } from "./project.js";

// AST types (the contracts between subsystems)
export type {
  ASTProject,
  ASTSourceFile,
  ASTNode,
  ASTVisitor,
  VisitorContext,
  ParseError,
  ParseErrorSeverity,
  ASTProjectOptions,
  ASTCacheEntry,
} from "./types.js";

// Source file
export { createASTSourceFile, SyntaxKind } from "./source-file.js";

// Error handling
export { ParseErrorCollector, ParseErrorCode, fromTypeScriptDiagnostic } from "./errors.js";

// Traversal primitives
export {
  getKind,
  getText,
  getFullText,
  getStart,
  getEnd,
  getStartLine,
  getStartColumn,
  getEndLine,
  getEndColumn,
  getParent,
  getAncestors,
  getChildren,
  visitChildren,
  visitDescendants,
  findNodes,
  findNodesByKinds,
  findFirst,
  filterNodes,
} from "./visitors.js";

// Domain queries
export {
  findJSXElements,
  findJSXAttributes,
  findJSXAttributeByName,
  hasJSXAttribute,
  getJSXTagName,
  findImports,
  hasImport,
  findCallExpressions,
  findCallExpressionsByName,
  findComponentDeclarations,
  findHookCalls,
  findObjectLiterals,
  findArrowFunctions,
  findIdentifiers,
  findIdentifiersByName,
} from "./queries.js";
