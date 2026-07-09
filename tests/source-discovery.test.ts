/**
 * Source Discovery Tests
 *
 * Tests for the file walker, ignore resolver, workspace resolver,
 * and the full source discovery pipeline.
 *
 * Each test creates a temporary project directory with the minimal
 * file structure needed to verify a specific behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import { walkSourceFiles } from "../src/scanner/file-walker.js";
import { createIgnorePredicate } from "../src/scanner/ignore-resolver.js";
import { resolveWorkspaces } from "../src/scanner/workspace-resolver.js";
import { discoverSourceFiles } from "../src/scanner/index.js";
import type { FileModel } from "../src/types/file.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  const name = `rn-audit-scan-${randomBytes(6).toString("hex")}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(dir: string, relativePath: string, content = ""): void {
  const fullPath = join(dir, relativePath);
  const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  if (parentDir) mkdirSync(parentDir, { recursive: true });
  writeFileSync(fullPath, content || "// test file");
}

function cleanup(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** Create a minimal package.json in a directory. */
function writePackageJson(dir: string, overrides: Record<string, unknown> = {}): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "test-project",
        version: "1.0.0",
        dependencies: { "react-native": "0.76.0", react: "18.3.1" },
        ...overrides,
      },
      null,
      2,
    ),
  );
}

/** Count files by type in a FileModel array. */
function countByExtension(files: FileModel[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of files) {
    counts[f.extension] = (counts[f.extension] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// File Walker
// ---------------------------------------------------------------------------

describe("walkSourceFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    writePackageJson(tempDir);
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("discovers TypeScript and JavaScript source files", () => {
    writeFile(tempDir, "src/App.tsx");
    writeFile(tempDir, "src/utils/helpers.ts");
    writeFile(tempDir, "src/components/Button.jsx");
    writeFile(tempDir, "src/legacy/module.js");

    const isIgnored = createIgnorePredicate(tempDir);
    const [files] = walkSourceFiles({ projectRoot: tempDir, isIgnored });

    expect(files.length).toBe(4);
    const byExt = countByExtension(files);
    expect(byExt[".tsx"]).toBe(1);
    expect(byExt[".ts"]).toBe(1);
    expect(byExt[".jsx"]).toBe(1);
    expect(byExt[".js"]).toBe(1);
  });

  it("skips node_modules entirely", () => {
    writeFile(tempDir, "src/App.tsx");
    writeFile(tempDir, "node_modules/some-lib/index.js");
    writeFile(tempDir, "node_modules/other-lib/src/Component.tsx");

    const isIgnored = createIgnorePredicate(tempDir);
    const [files] = walkSourceFiles({ projectRoot: tempDir, isIgnored });

    expect(files.length).toBe(1);
    expect(files[0]!.relativePath).toBe("src/App.tsx");
  });

  it("skips build, dist, and coverage directories", () => {
    writeFile(tempDir, "src/App.tsx");
    writeFile(tempDir, "dist/bundle.js");
    writeFile(tempDir, "build/output.js");
    writeFile(tempDir, "coverage/lcov-report/index.js");

    const isIgnored = createIgnorePredicate(tempDir);
    const [files] = walkSourceFiles({ projectRoot: tempDir, isIgnored });

    expect(files.length).toBe(1);
  });

  it("skips ios and android native directories", () => {
    writeFile(tempDir, "src/App.tsx");
    writeFile(tempDir, "ios/Pods/SomeFile.js");
    writeFile(tempDir, "android/app/src/main/java/com/app/MainApplication.java");

    const isIgnored = createIgnorePredicate(tempDir);
    const [files] = walkSourceFiles({ projectRoot: tempDir, isIgnored });

    expect(files.length).toBe(1);
  });

  it("includes FileModel metadata for each file", () => {
    writeFile(tempDir, "src/App.tsx", "const App = () => null;");

    const isIgnored = createIgnorePredicate(tempDir);
    const [files] = walkSourceFiles({ projectRoot: tempDir, isIgnored });
    const file = files[0]!;

    expect(file.absolutePath).toBe(resolve(tempDir, "src/App.tsx"));
    expect(file.relativePath).toBe("src/App.tsx");
    expect(file.extension).toBe(".tsx");
    expect(file.fileName).toBe("App.tsx");
    expect(file.size).toBeGreaterThan(0);
    expect(file.lastModified).toBeGreaterThan(0);
    expect(file.projectRoot).toBe(tempDir);
    expect(file.ignored).toBe(false);
  });

  it("traverses deeply nested directories", () => {
    writeFile(tempDir, "src/features/auth/screens/login/components/Form.tsx");

    const isIgnored = createIgnorePredicate(tempDir);
    const [files] = walkSourceFiles({ projectRoot: tempDir, isIgnored });

    expect(files.length).toBe(1);
    expect(files[0]!.relativePath).toContain("Form.tsx");
  });

  it("skips files with unsupported extensions", () => {
    writeFile(tempDir, "src/App.tsx");
    writeFile(tempDir, "src/styles.css");
    writeFile(tempDir, "README.md");
    writeFile(tempDir, "src/types.ts");
    writeFile(tempDir, "assets/logo.png");
    writeFile(tempDir, "data.json");

    const isIgnored = createIgnorePredicate(tempDir);
    const [files] = walkSourceFiles({ projectRoot: tempDir, isIgnored });

    expect(files.length).toBe(2); // App.tsx and types.ts
  });
});

// ---------------------------------------------------------------------------
// Ignore Resolver
// ---------------------------------------------------------------------------

describe("createIgnorePredicate", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    writePackageJson(tempDir);
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("ignores files in node_modules", () => {
    const isIgnored = createIgnorePredicate(tempDir);
    const [result] = isIgnored(join(tempDir, "node_modules", "lib", "index.js"));

    expect(result).toBe(true);
  });

  it("respects .gitignore patterns", () => {
    writeFileSync(join(tempDir, ".gitignore"), "*.generated.*\n/dist/\n.env\n");

    const isIgnored = createIgnorePredicate(tempDir);

    const [r1] = isIgnored(join(tempDir, "src", "code.generated.tsx"));
    expect(r1).toBe(true);

    const [r2] = isIgnored(join(tempDir, "src", "normal.tsx"));
    expect(r2).toBe(false);
  });

  it("handles negation patterns in .gitignore", () => {
    writeFileSync(join(tempDir, ".gitignore"), ["*.log", "!important.log"].join("\n"));

    const isIgnored = createIgnorePredicate(tempDir);

    const [r1] = isIgnored(join(tempDir, "debug.log"));
    expect(r1).toBe(true);

    const [r2] = isIgnored(join(tempDir, "important.log"));
    expect(r2).toBe(false);
  });

  it("ignores .expo directory (built-in)", () => {
    const isIgnored = createIgnorePredicate(tempDir);
    const [result] = isIgnored(join(tempDir, ".expo", "cache", "something.js"));

    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Workspace Resolver
// ---------------------------------------------------------------------------

describe("resolveWorkspaces", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("resolves npm workspace packages", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-monorepo",
        workspaces: ["packages/*"],
      }),
    );
    mkdirSync(join(tempDir, "packages", "mobile"), { recursive: true });
    writeFileSync(
      join(tempDir, "packages", "mobile", "package.json"),
      JSON.stringify({ name: "@my-org/mobile" }),
    );
    mkdirSync(join(tempDir, "packages", "web"), { recursive: true });
    writeFileSync(
      join(tempDir, "packages", "web", "package.json"),
      JSON.stringify({ name: "@my-org/web" }),
    );

    const result = resolveWorkspaces(tempDir);

    expect(result.tool).toBe("npm");
    expect(result.packages).toHaveLength(2);
    expect(result.packages[0]!.name).toBe("@my-org/mobile");
    expect(result.packages[1]!.name).toBe("@my-org/web");
  });

  it("returns empty packages for single-package projects", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "single-app", dependencies: { "react-native": "0.76.0" } }),
    );

    const result = resolveWorkspaces(tempDir);

    expect(result.tool).toBeNull();
    expect(result.packages).toHaveLength(0);
  });

  it("detects pnpm workspace from pnpm-workspace.yaml", () => {
    writeFileSync(
      join(tempDir, "pnpm-workspace.yaml"),
      "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
    );
    mkdirSync(join(tempDir, "apps", "mobile"), { recursive: true });
    writeFileSync(
      join(tempDir, "apps", "mobile", "package.json"),
      JSON.stringify({ name: "mobile" }),
    );

    const result = resolveWorkspaces(tempDir);

    expect(result.tool).toBe("pnpm");
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]!.name).toBe("mobile");
  });
});

// ---------------------------------------------------------------------------
// Full Pipeline (discoverSourceFiles)
// ---------------------------------------------------------------------------

describe("discoverSourceFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    writePackageJson(tempDir);
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("discovers source files in a basic React Native project", () => {
    writeFile(tempDir, "src/App.tsx");
    writeFile(tempDir, "src/components/Button.tsx");
    writeFile(tempDir, "src/utils/api.ts");
    writeFile(tempDir, "node_modules/lib/index.js");

    const project = {
      root: tempDir,
      name: "test-app",
      version: "1.0.0",
    } as Parameters<typeof discoverSourceFiles>[0];

    const result = discoverSourceFiles(project);

    expect(result.files).toHaveLength(3);
    expect(result.ignored).toHaveLength(0);
    expect(result.traversalTimeMs).toBeGreaterThan(0);
  });

  it("separates filee into active and ignored buckets", () => {
    writeFileSync(join(tempDir, ".gitignore"), "*.generated.*\n");
    writeFile(tempDir, "src/App.tsx");
    writeFile(tempDir, "src/code.generated.tsx");
    writeFile(tempDir, "src/types.generated.ts");

    const project = {
      root: tempDir,
      name: "test-app",
      version: "1.0.0",
    } as Parameters<typeof discoverSourceFiles>[0];

    const result = discoverSourceFiles(project);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.fileName).toBe("App.tsx");
    expect(result.ignored).toHaveLength(2);
  });

  it("handles monorepo workspaces", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "monorepo",
        workspaces: ["apps/*"],
      }),
    );
    writeFileSync(join(tempDir, ".gitignore"), "node_modules\n");

    // Workspace package: mobile app
    mkdirSync(join(tempDir, "apps", "mobile", "src"), { recursive: true });
    writeFileSync(
      join(tempDir, "apps", "mobile", "package.json"),
      JSON.stringify({ name: "@org/mobile", dependencies: { "react-native": "0.76.0" } }),
    );
    writeFile(tempDir, "apps/mobile/src/App.tsx");

    const project = {
      root: tempDir,
      name: "monorepo",
      version: "1.0.0",
    } as Parameters<typeof discoverSourceFiles>[0];

    const result = discoverSourceFiles(project);

    // Should find the mobile app's source file
    expect(result.files.length).toBeGreaterThanOrEqual(1);
    const mobileFiles = result.files.filter((f) => f.absolutePath.includes("apps/mobile"));
    expect(mobileFiles.length).toBe(1);
  });
});
