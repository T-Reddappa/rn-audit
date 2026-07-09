/**
 * AST Query Helpers
 *
 * Domain-specific helper functions for finding common patterns in
 * React Native source code. These are built on top of the visitor
 * primitives and provide named, documented APIs for the patterns
 * that rules will check.
 *
 * ## Design
 *
 * - **No analysis logic**: These functions FIND nodes; they don't judge
 *   whether the pattern is correct or incorrect. That's the rule engine's job.
 * - **Pure functions**: Input is AST nodes; output is arrays of nodes.
 *   No state, no side effects, no configuration.
 * - **Composable**: Queries return `ASTNode[]` which can be further
 *   filtered, mapped, or composed with other queries.
 *
 * ## Naming convention
 *
 * - `find<Thing>(node)` — find all occurrences of <Thing> in the subtree
 * - `has<Thing>(node)` — boolean presence check (more efficient than `find.length > 0`)
 * - `get<Thing>(node)` — get a single, specific value (e.g., the text of an identifier)
 *
 * @module ast/queries
 */

import { SyntaxKind } from "ts-morph";
import type { ASTNode } from "./types.js";
import {
  getKind,
  getText,
  findNodes,
  findNodesByKinds,
  getParent,
  visitChildren,
} from "./visitors.js";

// ---------------------------------------------------------------------------
// JSX queries
// ---------------------------------------------------------------------------

/**
 * Find all JSX elements in a subtree.
 *
 * JSX elements are the building blocks of React components:
 * `<View>`, `<Text>`, `<FlatList>`, `<Button />`, etc.
 *
 * Returns both opening elements (`<View>`) and self-closing elements
 * (`<Button />`). Does NOT include JSX fragments (`<>...</>`).
 *
 * @example
 * ```typescript
 * const jsxElements = findJSXElements(sourceFile.getRoot());
 * // → [<View>, <Text>, <FlatList>, <Button />, ...]
 * ```
 */
export function findJSXElements(node: ASTNode): ASTNode[] {
  return findNodesByKinds(node, [SyntaxKind.JsxElement, SyntaxKind.JsxSelfClosingElement]);
}

/**
 * Find all JSX attributes on a JSX element.
 *
 * JSX attributes are the props passed to a component:
 * `style={...}`, `keyExtractor={...}`, `data={...}`, etc.
 *
 * Returns the attribute nodes. Each attribute has:
 * - `name`: The attribute name (e.g., `style`, `keyExtractor`)
 * - `initializer`: The attribute value (e.g., `{...}`, `"string"`)
 *
 * @param jsxElement - A JSX element node (from findJSXElements).
 * @returns The JSX attributes on this element.
 */
export function findJSXAttributes(jsxElement: ASTNode): ASTNode[] {
  // JSX attributes live in the opening element or self-closing element.
  // For <View style={...}>, the attributes are children of the opening tag.
  if (
    getKind(jsxElement) === SyntaxKind.JsxElement ||
    getKind(jsxElement) === SyntaxKind.JsxSelfClosingElement
  ) {
    return findNodes(jsxElement, SyntaxKind.JsxAttribute);
  }
  return [];
}

/**
 * Find a specific JSX attribute by name.
 *
 * @example
 * ```typescript
 * const styleAttr = findJSXAttributeByName(jsxElement, "style");
 * if (styleAttr) {
 *   // This element has a style prop
 * }
 * ```
 */
export function findJSXAttributeByName(
  jsxElement: ASTNode,
  attributeName: string,
): ASTNode | undefined {
  const attrs = findJSXAttributes(jsxElement);
  return attrs.find((attr) => getText(attr).startsWith(attributeName));
}

/**
 * Check if a JSX element has a specific attribute.
 *
 * More efficient than `findJSXAttributeByName !== undefined` when
 * you only need a boolean answer, because it stops searching after
 * the first match.
 */
export function hasJSXAttribute(jsxElement: ASTNode, attributeName: string): boolean {
  return findJSXAttributeByName(jsxElement, attributeName) !== undefined;
}

/**
 * Get the tag name of a JSX element.
 *
 * For `<View style={...}>`, returns `"View"`.
 * For `<FlatList data={...}>`, returns `"FlatList"`.
 * For `<MyCustomComponent />`, returns `"MyCustomComponent"`.
 */
export function getJSXTagName(jsxElement: ASTNode): string | undefined {
  const kind = getKind(jsxElement);

  if (kind === SyntaxKind.JsxElement || kind === SyntaxKind.JsxSelfClosingElement) {
    if (kind === SyntaxKind.JsxSelfClosingElement) {
      const tagNameNode = findFirst(jsxElement, SyntaxKind.Identifier);
      return tagNameNode ? getText(tagNameNode) : undefined;
    }

    // The tag name is in the opening element's tag name expression
    const opening = findNodesByKinds(jsxElement, [
      SyntaxKind.JsxOpeningElement,
      SyntaxKind.JsxSelfClosingElement,
    ]);
    if (opening.length > 0) {
      const tagNameNode = findFirst(opening[0]!, SyntaxKind.Identifier);
      if (tagNameNode) {
        return getText(tagNameNode);
      }
    }
  }

  return undefined;
}

/**
 * Find the first node of a given SyntaxKind in a subtree.
 * Helper used internally but re-exported for convenience.
 */
function findFirst(node: ASTNode, kind: SyntaxKind): ASTNode | undefined {
  const results = findNodes(node, kind);
  return results[0];
}

// ---------------------------------------------------------------------------
// Import queries
// ---------------------------------------------------------------------------

/**
 * Find all import declarations in a source file.
 *
 * Returns import statement nodes. Each import node contains:
 * - Module specifier (the package name or path)
 * - Import clauses (default, named, namespace imports)
 *
 * @example
 * ```typescript
 * const imports = findImports(sourceFile.getRoot());
 * // → [import React from 'react', import { View } from 'react-native', ...]
 * ```
 */
export function findImports(node: ASTNode): ASTNode[] {
  return findNodes(node, SyntaxKind.ImportDeclaration);
}

/**
 * Check if a source file imports a specific module.
 *
 * @example
 * ```typescript
 * if (hasImport(sourceFile.getRoot(), "react-native")) {
 *   // This file uses React Native APIs
 * }
 * ```
 */
export function hasImport(node: ASTNode, moduleName: string): boolean {
  const imports = findImports(node);
  return imports.some((imp) => {
    const moduleSpecifier = findFirst(imp, SyntaxKind.StringLiteral);
    if (moduleSpecifier) {
      // Strip quotes from the string literal
      const text = getText(moduleSpecifier).replace(/^['"]|['"]$/g, "");
      return text === moduleName;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Call expression queries
// ---------------------------------------------------------------------------

/**
 * Find all call expressions (function calls) in a subtree.
 *
 * Call expressions include:
 * - `useState(false)` — React hooks
 * - `StyleSheet.create({...})` — StyleSheet API
 * - `navigation.navigate("Screen")` — React Navigation
 * - `console.log("debug")` — logging
 *
 * @example
 * ```typescript
 * const allCalls = findCallExpressions(sourceFile.getRoot());
 * ```
 */
export function findCallExpressions(node: ASTNode): ASTNode[] {
  return findNodes(node, SyntaxKind.CallExpression);
}

/**
 * Find call expressions where the function name matches.
 *
 * Matches:
 * - `useState(...)` when searching for `"useState"`
 * - `React.useState(...)` when searching for `"useState"` (property access)
 * - `obj.method(...)` when searching for `"method"`
 *
 * @param node - The root to search from.
 * @param name - The function name to match (case-sensitive).
 * @returns Call expressions matching the name.
 *
 * @example
 * ```typescript
 * const useStateCalls = findCallExpressionsByName(root, "useState");
 * const styleSheetCalls = findCallExpressionsByName(root, "create");
 * ```
 */
export function findCallExpressionsByName(node: ASTNode, name: string): ASTNode[] {
  const allCalls = findCallExpressions(node);

  return allCalls.filter((call) => {
    // The expression being called is the first child
    let calledExpression: ASTNode | undefined;
    visitChildren(call, (child) => {
      calledExpression = child;
      return false; // Stop after first child
    });

    if (!calledExpression) return false;

    const kind = getKind(calledExpression);

    // Direct call: useState()
    if (kind === SyntaxKind.Identifier) {
      return getText(calledExpression) === name;
    }

    // Property access: React.useState() or obj.method()
    if (kind === SyntaxKind.PropertyAccessExpression) {
      // The property name is the last child
      const children = findNodes(calledExpression, SyntaxKind.Identifier);
      const lastName = children[children.length - 1];
      return lastName ? getText(lastName) === name : false;
    }

    return false;
  });
}

// ---------------------------------------------------------------------------
// Component queries
// ---------------------------------------------------------------------------

/**
 * Find React component declarations in a source file.
 *
 * A component is:
 * - A function declaration that returns JSX
 * - An arrow function (const or let) that returns JSX
 * - A function expression assigned to a variable that returns JSX
 *
 * Note: This is a heuristic — it finds functions that LOOK like
 * components. It does NOT verify that they actually return JSX or
 * are used as components. That verification is the rule engine's job.
 *
 * @returns Function/arrow declarations that could be components.
 */
export function findComponentDeclarations(node: ASTNode): ASTNode[] {
  const components: ASTNode[] = [];

  // Function declarations: function Button() { return <View/>; }
  const functionDeclarations = findNodes(node, SyntaxKind.FunctionDeclaration);
  components.push(...functionDeclarations);

  // Arrow functions assigned to variables: const Button = () => <View/>;
  const arrowFunctions = findNodes(node, SyntaxKind.ArrowFunction);
  for (const arrow of arrowFunctions) {
    const parent = getParent(arrow);
    if (parent && getKind(parent) === SyntaxKind.VariableDeclaration) {
      // First character is uppercase → likely a component
      const name = getText(parent).split(":")[0]?.split("=")[0]?.trim();
      if (name && name[0] === name[0]?.toUpperCase()) {
        components.push(arrow);
      }
    }
  }

  return components;
}

// ---------------------------------------------------------------------------
// React Hook queries
// ---------------------------------------------------------------------------

/**
 * Find all React hook calls in a subtree.
 *
 * Hook names are matched by prefix (`use`), not by an exhaustive list.
 * This catches built-in hooks (useState, useEffect, useMemo, useCallback)
 * and custom hooks (useAuth, useProducts, useNavigation).
 *
 * @example
 * ```typescript
 * const hooks = findHookCalls(sourceFile.getRoot());
 * // → [useState(false), useEffect(() => {...}, []), useAuth()]
 * ```
 */
export function findHookCalls(node: ASTNode): ASTNode[] {
  const allCalls = findCallExpressions(node);

  return allCalls.filter((call) => {
    let calledExpression: ASTNode | undefined;
    visitChildren(call, (child) => {
      calledExpression = child;
      return false;
    });

    if (!calledExpression) return false;

    const text = getText(calledExpression);
    // Hooks start with "use" followed by an uppercase letter
    // (useState, useEffect, useAuth) but not "user" or "useful"
    return /^use[A-Z]/.test(text);
  });
}

// ---------------------------------------------------------------------------
// Object literal queries
// ---------------------------------------------------------------------------

/**
 * Find all object literal expressions in a subtree.
 *
 * Object literals appear in:
 * - StyleSheet.create({ ... })
 * - Inline styles: style={{ flex: 1 }}
 * - Component props: options={{ ... }}
 * - Configuration objects
 */
export function findObjectLiterals(node: ASTNode): ASTNode[] {
  return findNodes(node, SyntaxKind.ObjectLiteralExpression);
}

// ---------------------------------------------------------------------------
// Arrow function queries
// ---------------------------------------------------------------------------

/**
 * Find all arrow function expressions in a subtree.
 *
 * Arrow functions appear as:
 * - Event handlers: onPress={() => {...}}
 * - Inline callbacks: renderItem={({item}) => <Card/>}
 * - Component definitions: const App = () => <View/>
 * - Hook callbacks: useEffect(() => {...}, [])
 */
export function findArrowFunctions(node: ASTNode): ASTNode[] {
  return findNodes(node, SyntaxKind.ArrowFunction);
}

// ---------------------------------------------------------------------------
// Identifier queries
// ---------------------------------------------------------------------------

/**
 * Find all identifier nodes in a subtree.
 *
 * Identifiers are variable names, function names, property names —
 * any named reference in the code.
 */
export function findIdentifiers(node: ASTNode): ASTNode[] {
  return findNodes(node, SyntaxKind.Identifier);
}

/**
 * Find identifiers with a specific name.
 *
 * More efficient than `findIdentifiers` + filter because it checks
 * the name during traversal and stops early if possible.
 */
export function findIdentifiersByName(node: ASTNode, name: string): ASTNode[] {
  const allIdentifiers = findIdentifiers(node);
  return allIdentifiers.filter((id) => getText(id) === name);
}
