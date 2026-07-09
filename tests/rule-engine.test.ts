import { describe, expect, it, vi } from "vitest";
import type { ASTProject, ASTSourceFile } from "../src/ast/types.js";
import { runRuleEngine } from "../src/rules/engine.js";
import { FindingCategory, FindingTag, type Finding } from "../src/rules/finding.js";
import { RuleSeverity, type Rule, type RuleMetadata } from "../src/rules/types.js";
import type { FileModel } from "../src/types/file.js";
import type { ProjectModel } from "../src/types/project.js";

function metadata(id: string): RuleMetadata {
  return {
    id,
    name: id,
    description: `Test rule ${id}`,
    category: FindingCategory.Correctness,
    defaultSeverity: RuleSeverity.Warning,
    recommended: true,
    requiresTypeInformation: false,
    requiresJSX: false,
    tags: [FindingTag.BestPractice],
    supportsAutoFix: false,
    supportsSuggestions: false,
    introducedVersion: "1.0.0",
  };
}

function file(name: string): FileModel {
  return {
    absolutePath: `/project/${name}`,
    relativePath: name,
    fileName: name,
    extension: ".ts",
    size: 10,
    lastModified: 1,
    projectRoot: "/project",
    ignored: false,
  };
}

function sourceFile(path: string, isParsed = true): ASTSourceFile {
  return {
    filePath: path,
    fileName: path.split("/").at(-1) ?? path,
    isParsed,
    parseErrors: [],
    traverse: () => undefined,
    getRoot: () => ({ _internal: {} }),
  };
}

function setup(files: readonly FileModel[], unparsed = new Set<string>()): ASTProject {
  const sources = new Map(
    files.map((entry) => [
      entry.absolutePath,
      sourceFile(entry.absolutePath, !unparsed.has(entry.absolutePath)),
    ]),
  );
  return {
    root: "/project",
    fileCount: sources.size,
    getSourceFile: (path) => sources.get(path),
    getSourceFiles: () => sources.values(),
  };
}

const project = { root: "/project", name: "test", version: "1.0.0" } as ProjectModel;
const finding = { id: "finding-1" } as unknown as Finding;

describe("runRuleEngine", () => {
  it("executes every rule against every parsed source file", async () => {
    const files = [file("a.ts"), file("b.ts")];
    const firstAnalyze = vi.fn(() => [finding]);
    const secondAnalyze = vi.fn(() => []);
    const rules: Rule[] = [
      { meta: metadata("core/first"), analyze: firstAnalyze },
      { meta: metadata("core/second"), analyze: secondAnalyze },
    ];

    const result = await runRuleEngine({
      project,
      ast: setup(files),
      files,
      rules,
      writeSummary: () => undefined,
    });

    expect(firstAnalyze).toHaveBeenCalledTimes(2);
    expect(secondAnalyze).toHaveBeenCalledTimes(2);
    expect(result.findings).toEqual([finding, finding]);
    expect(result.summary.parsedFileCount).toBe(2);
  });

  it("skips source files that did not parse", async () => {
    const files = [file("valid.ts"), file("invalid.ts")];
    const analyze = vi.fn(() => []);

    const result = await runRuleEngine({
      project,
      ast: setup(files, new Set(["/project/invalid.ts"])),
      files,
      rules: [{ meta: metadata("core/example"), analyze }],
      writeSummary: () => undefined,
    });

    expect(analyze).toHaveBeenCalledOnce();
    expect(result.summary.parsedFileCount).toBe(1);
  });

  it("continues with other files and rules after a rule failure", async () => {
    const files = [file("a.ts"), file("b.ts")];
    const failing: Rule = {
      meta: metadata("core/failing"),
      analyze: (context) => {
        if (context.file.fileName === "a.ts") throw new Error("boom");
        return [];
      },
    };
    const healthyAnalyze = vi.fn(() => [finding]);

    const result = await runRuleEngine({
      project,
      ast: setup(files),
      files,
      rules: [failing, { meta: metadata("core/healthy"), analyze: healthyAnalyze }],
      writeSummary: () => undefined,
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ ruleId: "core/failing", filePath: "/project/a.ts" });
    expect(healthyAnalyze).toHaveBeenCalledTimes(2);
    expect(result.findings).toHaveLength(2);
  });

  it("supports asynchronous rules and records per-rule execution time", async () => {
    const files = [file("a.ts")];
    const rule: Rule = {
      meta: metadata("core/async"),
      analyze: async () => [finding],
    };

    const result = await runRuleEngine({
      project,
      ast: setup(files),
      files,
      rules: [rule],
      writeSummary: () => undefined,
    });

    expect(result.summary.rules[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("prints a final summary through the configured writer", async () => {
    const files = [file("a.ts")];
    const writeSummary = vi.fn();

    await runRuleEngine({
      project,
      ast: setup(files),
      files,
      rules: [{ meta: metadata("core/example"), analyze: () => [finding] }],
      writeSummary,
    });

    expect(writeSummary).toHaveBeenCalledOnce();
    expect(writeSummary.mock.calls[0]?.[0]).toContain(
      "1 rules · 1 parsed files · 1 findings · 0 failures",
    );
    expect(writeSummary.mock.calls[0]?.[0]).toContain("core/example:");
  });

  it("returns immutable result collections", async () => {
    const files = [file("a.ts")];
    const result = await runRuleEngine({
      project,
      ast: setup(files),
      files,
      rules: [],
      writeSummary: () => undefined,
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.findings)).toBe(true);
    expect(Object.isFrozen(result.summary.rules)).toBe(true);
  });
});
