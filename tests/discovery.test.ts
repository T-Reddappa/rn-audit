/**
 * Discovery Subsystem Tests
 *
 * Tests for the project discovery pipeline: root finding, validation,
 * type detection, config file discovery, and metadata extraction.
 *
 * Each test creates a temporary directory with the minimal files needed
 * to simulate a real project. This avoids depending on a real React Native
 * project being checked into the repository.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import { discoverProject } from "../src/discovery/index.js";
import { findProjectRoot } from "../src/discovery/root-finder.js";
import { validateProject } from "../src/discovery/validator.js";
import { detectProjectType } from "../src/discovery/type-detector.js";
import { discoverConfigFiles } from "../src/discovery/config-finder.js";
import { extractMetadata } from "../src/discovery/metadata.js";
import { ProjectFramework, ExpoWorkflow, PackageManager } from "../src/types/project.js";
import {
  DiscoveryError,
  NoPackageJsonError,
  NotReactNativeProjectError,
} from "../src/discovery/errors.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a unique temp directory for a test fixture. */
function createTempDir(): string {
  const name = `rn-audit-test-${randomBytes(6).toString("hex")}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a minimal package.json for a React Native project. */
function writePackageJson(dir: string, overrides: Record<string, unknown> = {}): void {
  const pkg = {
    name: "test-app",
    version: "1.0.0",
    dependencies: {
      "react-native": "0.76.0",
      react: "18.3.1",
    },
    devDependencies: {
      typescript: "~5.8.0",
    },
    ...overrides,
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
}

/** Write a package-lock.json (empty object is sufficient for PM detection). */
function writeLockFile(dir: string, name: string): void {
  writeFileSync(join(dir, name), JSON.stringify({}));
}

/** Clean up a temp directory after a test. */
function cleanup(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Root Finder
// ---------------------------------------------------------------------------

describe("findProjectRoot", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("finds the project root from the project directory itself", () => {
    writePackageJson(tempDir);

    const result = findProjectRoot(tempDir);

    expect(result.root).toBe(tempDir);
    expect(result.explicit).toBe(false);
  });

  it("finds the project root from a nested subdirectory", () => {
    writePackageJson(tempDir);
    const nestedDir = join(tempDir, "src", "components", "deeply", "nested");
    mkdirSync(nestedDir, { recursive: true });

    const result = findProjectRoot(nestedDir);

    expect(result.root).toBe(tempDir);
  });

  it("detects Expo projects (expo in dependencies)", () => {
    writePackageJson(tempDir, {
      dependencies: {
        expo: "~52.0.0",
        "react-native": "0.76.0",
        react: "18.3.1",
      },
    });

    const result = findProjectRoot(tempDir);

    expect(result.root).toBe(tempDir);
  });

  it("detects projects with react-native in devDependencies", () => {
    writePackageJson(tempDir, {
      dependencies: { react: "18.3.1" },
      devDependencies: { "react-native": "0.76.0" },
    });

    const result = findProjectRoot(tempDir);

    expect(result.root).toBe(tempDir);
  });

  it("throws NoPackageJsonError when no package.json exists", () => {
    // tempDir is empty — no package.json

    expect(() => findProjectRoot(tempDir)).toThrow(NoPackageJsonError);
  });

  it("throws NoPackageJsonError when package.json lacks RN deps", () => {
    writePackageJson(tempDir, {
      dependencies: { lodash: "4.0.0" },
    });
    // Remove the default react-native dep
    const pkgPath = join(tempDir, "package.json");
    const pkg = { name: "not-rn", version: "1.0.0", dependencies: { lodash: "4.0.0" } };
    writeFileSync(pkgPath, JSON.stringify(pkg));

    expect(() => findProjectRoot(tempDir)).toThrow(NoPackageJsonError);
  });
});

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

describe("validateProject", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("validates a basic React Native project", () => {
    writePackageJson(tempDir);

    const result = validateProject(tempDir);

    expect(result.isSupported).toBe(true);
  });

  it("validates an Expo managed project", () => {
    writePackageJson(tempDir, {
      dependencies: {
        expo: "~52.0.0",
        "react-native": "0.76.0",
        react: "18.3.1",
      },
    });

    const result = validateProject(tempDir);

    expect(result.isSupported).toBe(true);
  });

  it("rejects Next.js projects (non-RN framework)", () => {
    writePackageJson(tempDir, {
      dependencies: {
        next: "14.0.0",
        "react-native": "0.76.0",
        react: "18.3.1",
      },
    });

    const result = validateProject(tempDir);

    expect(result.isSupported).toBe(false);
    expect(result.reason).toContain("web framework");
  });

  it("rejects very old React Native versions", () => {
    writePackageJson(tempDir, {
      dependencies: {
        "react-native": "0.60.0",
        react: "16.9.0",
      },
    });

    const result = validateProject(tempDir);

    expect(result.isSupported).toBe(false);
    expect(result.reason).toContain("0.60");
  });

  it("throws NotReactNativeProjectError for non-RN projects", () => {
    const pkg = {
      name: "not-rn",
      version: "1.0.0",
      dependencies: { lodash: "4.0.0" },
    };
    writeFileSync(join(tempDir, "package.json"), JSON.stringify(pkg));

    expect(() => validateProject(tempDir)).toThrow(NotReactNativeProjectError);
  });
});

// ---------------------------------------------------------------------------
// Type Detector
// ---------------------------------------------------------------------------

describe("detectProjectType", () => {
  it("detects Expo managed workflow", () => {
    const result = detectProjectType(
      "/fake/expo-managed",
      { expo: "~52.0.0", react: "18.3.1" },
      { typescript: "~5.8.0" },
    );

    expect(result.framework).toBe(ProjectFramework.Expo);
    expect(result.workflow).toBe(ExpoWorkflow.Managed);
    expect(result.hasExpoRouter).toBe(false);
  });

  it("detects React Native CLI project", () => {
    const result = detectProjectType(
      "/fake/rn-cli",
      { "react-native": "0.76.0", react: "18.3.1" },
      {},
    );

    expect(result.framework).toBe(ProjectFramework.ReactNativeCLI);
    expect(result.workflow).toBeUndefined();
  });

  it("detects Expo Router usage", () => {
    const result = detectProjectType(
      "/fake/expo-router",
      {
        expo: "~52.0.0",
        "expo-router": "~4.0.0",
        react: "18.3.1",
      },
      {},
    );

    expect(result.hasExpoRouter).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Config File Discovery
// ---------------------------------------------------------------------------

describe("discoverConfigFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("discovers package.json (always present)", () => {
    writePackageJson(tempDir);

    const config = discoverConfigFiles(tempDir);

    expect(config.packageJson).toBe(resolve(tempDir, "package.json"));
  });

  it("returns null for non-existent config files", () => {
    writePackageJson(tempDir);

    const config = discoverConfigFiles(tempDir);

    // No tsconfig, babel config, etc. should have been created
    expect(config.tsconfig).toBeNull();
    expect(config.babelConfig).toBeNull();
    expect(config.metroConfig).toBeNull();
  });

  it("discovers tsconfig.json when present", () => {
    writePackageJson(tempDir);
    writeFileSync(join(tempDir, "tsconfig.json"), JSON.stringify({}));

    const config = discoverConfigFiles(tempDir);

    expect(config.tsconfig).toBe(resolve(tempDir, "tsconfig.json"));
  });

  it("discovers app.json for Expo projects", () => {
    writePackageJson(tempDir);
    writeFileSync(join(tempDir, "app.json"), JSON.stringify({ expo: {} }));

    const config = discoverConfigFiles(tempDir);

    expect(config.appJson).toBe(resolve(tempDir, "app.json"));
  });

  it("prioritizes babel.config.js over .babelrc", () => {
    writePackageJson(tempDir);
    writeFileSync(join(tempDir, "babel.config.js"), "module.exports = {};");
    writeFileSync(join(tempDir, ".babelrc"), JSON.stringify({}));

    const config = discoverConfigFiles(tempDir);

    expect(config.babelConfig).toBe(resolve(tempDir, "babel.config.js"));
  });
});

// ---------------------------------------------------------------------------
// Metadata Extraction
// ---------------------------------------------------------------------------

describe("extractMetadata", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("extracts basic metadata from package.json", () => {
    writePackageJson(tempDir);

    const meta = extractMetadata(tempDir);

    expect(meta.name).toBe("test-app");
    expect(meta.version).toBe("1.0.0");
    expect(meta.reactNativeVersion).toBe("0.76.0");
    expect(meta.reactVersion).toBe("18.3.1");
    expect(meta.typescriptVersion).toBe("5.8.0");
  });

  it("cleans semver ranges from version numbers", () => {
    writePackageJson(tempDir, {
      dependencies: {
        "react-native": "^0.76.0",
        react: "~18.3.1",
      },
      devDependencies: {
        typescript: ">=5.0.0",
      },
    });

    const meta = extractMetadata(tempDir);

    expect(meta.reactNativeVersion).toBe("0.76.0");
    expect(meta.reactVersion).toBe("18.3.1");
    expect(meta.typescriptVersion).toBe("5.0.0");
  });

  it("detects npm from package-lock.json", () => {
    writePackageJson(tempDir);
    writeLockFile(tempDir, "package-lock.json");

    const meta = extractMetadata(tempDir);

    expect(meta.packageManager).toBe(PackageManager.Npm);
  });

  it("detects yarn from yarn.lock", () => {
    writePackageJson(tempDir);
    writeLockFile(tempDir, "yarn.lock");

    const meta = extractMetadata(tempDir);

    expect(meta.packageManager).toBe(PackageManager.Yarn);
  });

  it("detects pnpm from pnpm-lock.yaml", () => {
    writePackageJson(tempDir);
    writeLockFile(tempDir, "pnpm-lock.yaml");

    const meta = extractMetadata(tempDir);

    expect(meta.packageManager).toBe(PackageManager.Pnpm);
  });

  it("handles workspace: protocol gracefully", () => {
    writePackageJson(tempDir, {
      dependencies: {
        "react-native": "workspace:*",
        react: "18.3.1",
      },
    });

    const meta = extractMetadata(tempDir);

    expect(meta.reactNativeVersion).toBeNull();
    expect(meta.reactVersion).toBe("18.3.1");
  });

  it("extracts Node engine requirement", () => {
    writePackageJson(tempDir, {
      dependencies: { "react-native": "0.76.0", react: "18.3.1" },
      engines: { node: ">=18" },
    });

    const meta = extractMetadata(tempDir);

    expect(meta.nodeEngine).toBe(">=18");
  });
});

// ---------------------------------------------------------------------------
// Full Pipeline Integration
// ---------------------------------------------------------------------------

describe("discoverProject (integration)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("discovers a complete React Native project end-to-end", () => {
    writePackageJson(tempDir);
    writeLockFile(tempDir, "package-lock.json");
    writeFileSync(join(tempDir, "tsconfig.json"), JSON.stringify({}));
    writeFileSync(
      join(tempDir, "babel.config.js"),
      "module.exports = { presets: ['module:@react-native/babel-preset'] };",
    );

    const project = discoverProject({ cwd: tempDir });

    expect(project.root).toBe(tempDir);
    expect(project.name).toBe("test-app");
    expect(project.framework).toBe(ProjectFramework.ReactNativeCLI);
    expect(project.isSupported).toBe(true);
    expect(project.reactNativeVersion).toBe("0.76.0");
    expect(project.packageManager).toBe(PackageManager.Npm);
    expect(project.configFiles.tsconfig).not.toBeNull();
    expect(project.configFiles.babelConfig).not.toBeNull();
    expect(project.dependencies).toHaveProperty("react-native");
    expect(project.discoveredAt).toBeTruthy();
  });

  it("discovers an Expo project end-to-end", () => {
    writePackageJson(tempDir, {
      dependencies: {
        expo: "~52.0.0",
        "react-native": "0.76.0",
        react: "18.3.1",
      },
    });
    writeLockFile(tempDir, "yarn.lock");
    writeFileSync(join(tempDir, "app.json"), JSON.stringify({ expo: { name: "test" } }));

    const project = discoverProject({ cwd: tempDir });

    expect(project.framework).toBe(ProjectFramework.Expo);
    expect(project.workflow).toBe(ExpoWorkflow.Managed);
    expect(project.expoVersion).toBe("52.0.0");
    expect(project.packageManager).toBe(PackageManager.Yarn);
    expect(project.configFiles.appJson).not.toBeNull();
  });

  it("throws DiscoveryError for unsupported projects", () => {
    writePackageJson(tempDir, {
      dependencies: {
        next: "14.0.0",
        "react-native": "0.76.0",
        react: "18.3.1",
      },
    });

    expect(() => discoverProject({ cwd: tempDir })).toThrow(DiscoveryError);
  });
});
