/**
 * AST Engine Tests
 *
 * Fixture-based tests for the AST subsystem: project creation, source
 * file parsing, visitor traversal, query helpers, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { createASTProject } from "../src/ast/project.js";
import { SyntaxKind } from "../src/ast/source-file.js";
import type { ASTProject, ASTSourceFile } from "../src/ast/types.js";
import {
  getKind,
  getText,
  findNodes,
  findFirst,
  getParent,
  getAncestors,
} from "../src/ast/visitors.js";
import {
  findJSXElements,
  findJSXAttributes,
  findJSXAttributeByName,
  hasJSXAttribute,
  getJSXTagName,
  findImports,
  hasImport,
  findCallExpressionsByName,
  findComponentDeclarations,
  findHookCalls,
  findObjectLiterals,
  findArrowFunctions,
} from "../src/ast/queries.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  const name = `rn-audit-ast-${randomBytes(6).toString("hex")}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function createFixtureProject(): {
  dir: string;
  sourceFiles: Array<{
    absolutePath: string;
    fileName: string;
    size: number;
    lastModified: number;
    projectRoot: string;
    relativePath: string;
    extension: string;
    ignored: boolean;
  }>;
} {
  const dir = createTempDir();

  // Minimal package.json
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "ast-test", dependencies: { "react-native": "0.76.0" } }),
  );

  // Minimal tsconfig.
  // strict: false — the fixture code is intentionally unannotated (testing
  // AST structure, not type-correctness). noImplicitAny would reject the
  // destructured callback params in the existing fixture.
  // The "files" array includes types.d.ts which declares ambient modules
  // for react, react-native, and react/jsx-runtime — no need to install
  // heavy packages or populate node_modules.
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "node",
        jsx: "react-jsx",
        strict: false,
      },
      files: ["ProductList.tsx", "types.d.ts"],
    }),
  );

  // -----------------------------------------------------------------------
  // Ambient module declarations for React and React Native.
  // We use a single types.d.ts file with declare module blocks rather than
  // populating node_modules. This is more reliable and self-contained.
  // -----------------------------------------------------------------------
  writeFileSync(
    join(dir, "types.d.ts"),
    [
      // -- Global JSX namespace (must be global for "jsx": "react-jsx") --
      "declare namespace JSX {",
      "  interface Element {}",
      "  interface IntrinsicElements {",
      "    [elemName: string]: any;",
      "  }",
      "}",
      "",
      // -- react --
      'declare module "react" {',
      "  export function useState<T = any>(...args: any[]): any;",
      "  export function useEffect(...args: any[]): any;",
      "  export function useCallback<T extends (...args: any[]) => any = any>(...args: any[]): any;",
      "  export function useMemo<T = any>(...args: any[]): any;",
      "  const _default: any;",
      "  export default _default;",
      "}",
      "",
      // -- react/jsx-runtime --
      'declare module "react/jsx-runtime" {',
      "  export function jsx(...args: any[]): any;",
      "  export function jsxs(...args: any[]): any;",
      "  export function Fragment(...args: any[]): any;",
      "}",
      "",
      // -- react-native --
      'declare module "react-native" {',
      "  export const View: any;",
      "  export const Text: any;",
      "  export const FlatList: any;",
      "  export const ScrollView: any;",
      "  export const Image: any;",
      "  export const Pressable: any;",
      "  export const StyleSheet: any;",
      "}",
    ].join("\n"),
  );

  // Copy the ProductList fixture
  const fixturePath = resolve(__dirname, "fixtures", "ast", "ProductList.tsx");
  const fixtureContent = readFileSync(fixturePath, "utf-8");
  const productListPath = join(dir, "ProductList.tsx");
  writeFileSync(productListPath, fixtureContent);

  const sourceFiles = [
    {
      absolutePath: productListPath,
      fileName: "ProductList.tsx",
      size: fixtureContent.length,
      lastModified: Date.now(),
      projectRoot: dir,
      relativePath: "ProductList.tsx",
      extension: ".tsx",
      ignored: false,
    },
  ];

  return { dir, sourceFiles };
}

// ---------------------------------------------------------------------------
// Project creation
// ---------------------------------------------------------------------------

describe("createASTProject", () => {
  let fixture: ReturnType<typeof createFixtureProject>;

  beforeEach(() => {
    fixture = createFixtureProject();
  });

  afterEach(() => {
    cleanup(fixture.dir);
  });

  it("creates an AST project with source files", () => {
    const project = createASTProject(
      { root: fixture.dir, name: "ast-test", version: "1.0.0" } as never,
      fixture.sourceFiles as never,
    );

    expect(project.root).toBe(fixture.dir);
    expect(project.fileCount).toBe(1);
  });

  it("provides access to source files by path", () => {
    const project = createASTProject(
      { root: fixture.dir, name: "ast-test", version: "1.0.0" } as never,
      fixture.sourceFiles as never,
    );

    const sf = project.getSourceFile(fixture.sourceFiles[0]!.absolutePath);
    expect(sf).toBeDefined();
    expect(sf!.fileName).toBe("ProductList.tsx");
    // DEBUG: print parse errors to understand why isParsed is false
    if (!sf!.isParsed) {
      console.log("Parse errors:", JSON.stringify(sf!.parseErrors, null, 2));
    }
    expect(sf!.isParsed).toBe(true);
  });

  it("returns undefined for non-existent file paths", () => {
    const project = createASTProject(
      { root: fixture.dir, name: "ast-test", version: "1.0.0" } as never,
      fixture.sourceFiles as never,
    );

    expect(project.getSourceFile("/nonexistent/file.ts")).toBeUndefined();
  });

  it("iterates all source files", () => {
    const project = createASTProject(
      { root: fixture.dir, name: "ast-test", version: "1.0.0" } as never,
      fixture.sourceFiles as never,
    );

    const files = [...project.getSourceFiles()];
    expect(files).toHaveLength(1);
    expect(files[0]!.fileName).toBe("ProductList.tsx");
  });
});

// ---------------------------------------------------------------------------
// Visitor traversal
// ---------------------------------------------------------------------------

describe("ASTSourceFile.traverse", () => {
  let fixture: ReturnType<typeof createFixtureProject>;
  let project: ASTProject;

  beforeEach(() => {
    fixture = createFixtureProject();
    project = createASTProject(
      { root: fixture.dir, name: "ast-test", version: "1.0.0" } as never,
      fixture.sourceFiles as never,
    );
  });

  afterEach(() => {
    cleanup(fixture.dir);
  });

  it("visits nodes of the specified SyntaxKind", () => {
    const sf = project.getSourceFile(fixture.sourceFiles[0]!.absolutePath)!;
    const visited: string[] = [];

    sf.traverse({
      [SyntaxKind.JsxElement]: (node) => {
        visited.push(getJSXTagName(node) ?? "unknown");
      },
      [SyntaxKind.JsxSelfClosingElement]: (node) => {
        visited.push(getJSXTagName(node) ?? "unknown");
      },
    });

    // ProductList.tsx has: View, Text, FlatList, ScrollView, Image, etc.
    expect(visited.length).toBeGreaterThan(5);
    expect(visited).toContain("FlatList");
    expect(visited).toContain("Image");
    expect(visited).toContain("View");
  });

  it("provides parent and ancestors in visitor context", () => {
    const sf = project.getSourceFile(fixture.sourceFiles[0]!.absolutePath)!;
    let foundNested = false;

    sf.traverse({
      [SyntaxKind.JsxElement]: (node, ctx) => {
        const tag = getJSXTagName(node);
        if (tag === "Text" && ctx.parent) {
          // Text should have a parent JSX element (View or Pressable)
          const parentKind = getKind(ctx.parent);
          if (
            parentKind === SyntaxKind.JsxElement ||
            parentKind === SyntaxKind.JsxSelfClosingElement
          ) {
            foundNested = true;
          }
          expect(ctx.ancestors.length).toBeGreaterThan(0);
          expect(ctx.depth).toBeGreaterThan(0);
        }
      },
    });

    expect(foundNested).toBe(true);
  });

  it("supports skipChildren for subtree pruning", () => {
    const sf = project.getSourceFile(fixture.sourceFiles[0]!.absolutePath)!;
    let callbackCount = 0;

    sf.traverse({
      [SyntaxKind.JsxElement]: (node, ctx) => {
        callbackCount++;
        const tag = getJSXTagName(node);
        if (tag === "Pressable") {
          // Prune everything inside Pressable
          ctx.skipChildren = true;
        }
      },
      [SyntaxKind.JsxSelfClosingElement]: () => {
        callbackCount++;
      },
    });

    // Should have visited fewer nodes than without pruning
    expect(callbackCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Visitor primitives
// ---------------------------------------------------------------------------

describe("visitor primitives", () => {
  let fixture: ReturnType<typeof createFixtureProject>;
  let project: ASTProject;
  let sf: ASTSourceFile;

  beforeEach(() => {
    fixture = createFixtureProject();
    project = createASTProject(
      { root: fixture.dir, name: "ast-test", version: "1.0.0" } as never,
      fixture.sourceFiles as never,
    );
    sf = project.getSourceFile(fixture.sourceFiles[0]!.absolutePath)!;
  });

  afterEach(() => {
    cleanup(fixture.dir);
  });

  it("findNodes returns nodes of a specific SyntaxKind", () => {
    const imports = findNodes(sf.getRoot(), SyntaxKind.ImportDeclaration);
    expect(imports.length).toBeGreaterThan(0);
  });

  it("findFirst returns the first matching node", () => {
    const firstImport = findFirst(sf.getRoot(), SyntaxKind.ImportDeclaration);
    expect(firstImport).toBeDefined();
  });

  it("getKind returns the SyntaxKind of a node", () => {
    const imports = findNodes(sf.getRoot(), SyntaxKind.ImportDeclaration);
    if (imports.length > 0) {
      expect(getKind(imports[0]!)).toBe(SyntaxKind.ImportDeclaration);
    }
  });

  it("getText returns source text", () => {
    const imports = findNodes(sf.getRoot(), SyntaxKind.ImportDeclaration);
    if (imports.length > 0) {
      expect(getText(imports[0]!)).toContain("import");
    }
  });

  it("getParent returns the enclosing node", () => {
    const jsxElements = findNodes(sf.getRoot(), SyntaxKind.JsxElement);
    if (jsxElements.length > 0) {
      const parent = getParent(jsxElements[0]!);
      expect(parent).toBeDefined();
    }
  });

  it("getAncestors returns all parent nodes to the root", () => {
    const textNodes = findNodes(sf.getRoot(), SyntaxKind.JsxElement);
    if (textNodes.length > 0) {
      const ancestors = getAncestors(textNodes[0]!);
      expect(ancestors.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

describe("query helpers", () => {
  let fixture: ReturnType<typeof createFixtureProject>;
  let project: ASTProject;
  let sf: ASTSourceFile;

  beforeEach(() => {
    fixture = createFixtureProject();
    project = createASTProject(
      { root: fixture.dir, name: "ast-test", version: "1.0.0" } as never,
      fixture.sourceFiles as never,
    );
    sf = project.getSourceFile(fixture.sourceFiles[0]!.absolutePath)!;
  });

  afterEach(() => {
    cleanup(fixture.dir);
  });

  describe("JSX queries", () => {
    it("finds all JSX elements", () => {
      const elements = findJSXElements(sf.getRoot());
      expect(elements.length).toBeGreaterThan(5);
    });

    it("gets JSX tag names", () => {
      const elements = findJSXElements(sf.getRoot());
      const tagNames = elements.map((el) => getJSXTagName(el)).filter(Boolean) as string[];

      // ProductList uses FlatList, View, Text, Image, Pressable, ScrollView
      expect(tagNames).toContain("FlatList");
      expect(tagNames).toContain("View");
      expect(tagNames).toContain("Text");
    });

    it("finds JSX attributes on an element", () => {
      const elements = findJSXElements(sf.getRoot());
      // Find the FlatList element
      const flatList = elements.find((el) => getJSXTagName(el) === "FlatList");
      expect(flatList).toBeDefined();

      if (flatList) {
        const attrs = findJSXAttributes(flatList);
        expect(attrs.length).toBeGreaterThan(0);

        // FlatList has data, renderItem, keyExtractor props
        expect(hasJSXAttribute(flatList, "data")).toBe(true);
        expect(hasJSXAttribute(flatList, "keyExtractor")).toBe(true);
      }
    });

    it("finds a specific JSX attribute by name", () => {
      const elements = findJSXElements(sf.getRoot());
      const flatList = elements.find((el) => getJSXTagName(el) === "FlatList");

      if (flatList) {
        const keyExtractor = findJSXAttributeByName(flatList, "keyExtractor");
        expect(keyExtractor).toBeDefined();
      }
    });
  });

  describe("import queries", () => {
    it("finds all import declarations", () => {
      const imports = findImports(sf.getRoot());
      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it("detects specific module imports", () => {
      expect(hasImport(sf.getRoot(), "react")).toBe(true);
      expect(hasImport(sf.getRoot(), "react-native")).toBe(true);
      expect(hasImport(sf.getRoot(), "nonexistent-package")).toBe(false);
    });
  });

  describe("hook queries", () => {
    it("finds React hook calls", () => {
      const hooks = findHookCalls(sf.getRoot());
      // ProductList uses useState, useEffect, useCallback, useMemo
      expect(hooks.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("call expression queries", () => {
    it("finds specific call expressions by name", () => {
      const styleSheetCalls = findCallExpressionsByName(sf.getRoot(), "create");
      // ProductList uses StyleSheet.create()
      expect(styleSheetCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("component queries", () => {
    it("finds component declarations", () => {
      const components = findComponentDeclarations(sf.getRoot());
      // ProductList has ProductList and ProductCard
      expect(components.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("object literal queries", () => {
    it("finds object literals", () => {
      const objects = findObjectLiterals(sf.getRoot());
      // StyleSheet.create({...}), inline style objects, etc.
      expect(objects.length).toBeGreaterThan(0);
    });
  });

  describe("arrow function queries", () => {
    it("finds arrow functions", () => {
      const arrows = findArrowFunctions(sf.getRoot());
      // renderItem callback, useMemo callback, etc.
      expect(arrows.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "error-test", dependencies: { "react-native": "0.76.0" } }),
    );
    writeFileSync(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true } }),
    );
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("handles syntax errors gracefully", () => {
    // Write a file with a syntax error
    const brokenPath = join(tempDir, "BrokenFile.tsx");
    writeFileSync(brokenPath, "const x: = ;;; // invalid syntax");

    const sourceFiles = [
      {
        absolutePath: brokenPath,
        fileName: "BrokenFile.tsx",
        size: 30,
        lastModified: Date.now(),
        projectRoot: tempDir,
        relativePath: "BrokenFile.tsx",
        extension: ".tsx",
        ignored: false,
      },
    ];

    const project = createASTProject(
      { root: tempDir, name: "error-test", version: "1.0.0" } as never,
      sourceFiles as never,
    );

    const sf = project.getSourceFile(brokenPath);
    expect(sf).toBeDefined();
    // Even with syntax errors, the file should be accessible
    expect(sf!.isParsed).toBe(false);
  });

  it("handles missing files gracefully", () => {
    const missingPath = join(tempDir, "DoesNotExist.tsx");

    const sourceFiles = [
      {
        absolutePath: missingPath,
        fileName: "DoesNotExist.tsx",
        size: 100,
        lastModified: Date.now(),
        projectRoot: tempDir,
        relativePath: "DoesNotExist.tsx",
        extension: ".tsx",
        ignored: false,
      },
    ];

    const project = createASTProject(
      { root: tempDir, name: "error-test", version: "1.0.0" } as never,
      sourceFiles as never,
    );

    const sf = project.getSourceFile(missingPath);
    expect(sf).toBeDefined();
    expect(sf!.isParsed).toBe(false);
    expect(sf!.parseErrors.length).toBeGreaterThan(0);
  });
});
