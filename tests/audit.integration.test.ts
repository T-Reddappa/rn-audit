import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("end-to-end audit", () => {
  it("analyzes multiple files, reports three inline styles, and survives invalid syntax", async () => {
    const directory = createProject({
      "Home.tsx": `
        const Home = () => (
          <View style={{ padding: 16 }}>
            <Text style={{ color: "red" }}>Home</Text>
          </View>
        );
      `,
      "Profile.tsx": `const Profile = () => <View style={{ flex: 1 }} />;`,
      "Clean.tsx": `const Clean = () => <View style={styles.container} />;`,
      "Invalid.tsx": `const Invalid = () => <View style={{ padding: 8 }}`,
    });
    const lines: string[] = [];

    const result = await runAudit({ cwd: directory, write: (line) => lines.push(line) });
    const output = lines.join("\n");

    expect(result.exitCode).toBe(2);
    expect(result.analysis.findings).toHaveLength(3);
    expect(result.analysis.summary.parsedFileCount).toBe(3);
    expect(output).toContain("✓ Project scanned: integration-app");
    expect(output).toContain("Performance — 3 issues");
    expect(output).toContain("⚠ Inline Style (3)");
    expect(output).toContain("StyleSheet.create()");
    expect(output).toMatch(/Total Diagnostics\s+3/);
    expect(output).toMatch(/Parse errors\s+1/);
    expect(output).toMatch(/Scanner\s+\d+ ms/);
    expect(output).toMatch(/AST\s+\d+ ms/);
    expect(output).toMatch(/Rules\s+\d+ ms/);
    expect(output).toMatch(/Reporter\s+\d+ ms/);
    expect(output).toMatch(/Total\s+\d+ ms/);
  });

  it("returns exit code zero for a clean project", async () => {
    const directory = createProject({
      "Clean.tsx": `const Clean = () => <View style={styles.container} />;`,
      "Other.ts": `export const value = 1;`,
    });
    const lines: string[] = [];

    const result = await runAudit({ cwd: directory, write: (line) => lines.push(line) });

    expect(result.exitCode).toBe(0);
    expect(result.analysis.findings).toHaveLength(0);
    expect(lines.join("\n")).toContain("No diagnostics found.");
  });

  it("handles a large fixture without changing summary correctness", async () => {
    const sources: Record<string, string> = {};
    for (let index = 0; index < 200; index += 1) {
      sources[`src-${index}.ts`] = `export const value${index} = ${index};`;
    }
    sources["Issue.tsx"] = `const Issue = () => <View style={{ margin: 4 }} />;`;
    const directory = createProject(sources);

    const result = await runAudit({ cwd: directory, write: () => undefined });

    expect(result.exitCode).toBe(1);
    expect(result.analysis.summary.parsedFileCount).toBe(201);
    expect(result.analysis.summary.ruleCount).toBe(2);
    expect(result.analysis.findings).toHaveLength(1);
  });
});

function createProject(sources: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), "rn-audit-integration-"));
  directories.push(directory);
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "integration-app",
      version: "1.0.0",
      dependencies: { react: "18.3.1", "react-native": "0.76.0" },
    }),
  );
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { jsx: "preserve", target: "ES2022" } }),
  );
  for (const [name, source] of Object.entries(sources)) {
    writeFileSync(join(directory, name), source);
  }
  return directory;
}
