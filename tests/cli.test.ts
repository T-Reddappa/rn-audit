/**
 * CLI Smoke Tests
 *
 * Verifies the CLI entry point can be executed and handles basic
 * commands correctly. Uses a temporary React Native project so
 * the discovery pipeline succeeds.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const cliPath = resolve(projectRoot, "dist", "cli.js");

/** Create a unique temp directory with a minimal RN project inside. */
function createTempProject(): string {
  const name = `rn-audit-cli-test-${randomBytes(6).toString("hex")}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });

  const pkg = {
    name: "cli-test-app",
    version: "1.0.0",
    dependencies: {
      "react-native": "0.76.0",
      react: "18.3.1",
    },
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({}));

  return dir;
}

function cleanup(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("CLI", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  function run(args: string[] = []): { stdout: string; exitCode: number } {
    try {
      const stdout = execSync(`node ${cliPath} ${args.join(" ")}`, {
        encoding: "utf8",
        cwd: tempDir,
      });
      return { stdout: stdout.trim(), exitCode: 0 };
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: ((execError.stdout ?? "") + (execError.stderr ?? "")).trim(),
        exitCode: execError.status ?? 1,
      };
    }
  }

  it("discovers a React Native project and prints its details", () => {
    const { stdout, exitCode } = run();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("rn-audit initialized successfully.");
    expect(stdout).toContain("cli-test-app");
    expect(stdout).toContain("react-native-cli");
  });

  it("prints version when invoked with --version", () => {
    const { stdout, exitCode } = run(["--version"]);

    expect(exitCode).toBe(0);
    expect(stdout).toBeTruthy();
  });

  it("prints help when invoked with --help", () => {
    const { stdout, exitCode } = run(["--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("rn-audit");
    expect(stdout).toContain("Static analysis");
  });

  it("prints an error and exits 2 when not in an RN project", () => {
    // Run from /tmp (not an RN project)
    try {
      execSync(`node ${cliPath}`, {
        encoding: "utf8",
        cwd: tmpdir(),
      });
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; status?: number };
      const output = ((execError.stdout ?? "") + (execError.stderr ?? "")).trim();

      expect(execError.status).toBe(2);
      expect(output).toContain("Error");
    }
  });
});
