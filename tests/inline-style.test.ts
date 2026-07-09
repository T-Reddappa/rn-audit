import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createASTProject } from "../src/ast/project.js";
import { runRuleEngine, type RuleEngineResult } from "../src/rules/engine.js";
import {
  FindingCategory,
  FindingSeverity,
  FindingTag,
  PositionEncoding,
} from "../src/rules/finding.js";
import { INLINE_STYLE_RULE_ID, InlineStyleRule } from "../src/rules/inline-style.js";
import { RuleSeverity } from "../src/rules/types.js";
import type { FileModel } from "../src/types/file.js";
import type { ProjectModel } from "../src/types/project.js";

const fixtureDirectory = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/rules/inline-style",
);

describe("InlineStyleRule", () => {
  let directory: string;
  let files: FileModel[];
  let result: RuleEngineResult;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "rn-audit-inline-style-"));
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx: "preserve", target: "ES2022" } }),
    );

    files = readdirSync(fixtureDirectory)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => {
        const content = readFileSync(join(fixtureDirectory, name), "utf8");
        const absolutePath = join(directory, name);
        writeFileSync(absolutePath, content);
        return {
          absolutePath,
          relativePath: name,
          fileName: name,
          extension: ".tsx" as const,
          size: content.length,
          lastModified: Date.now(),
          projectRoot: directory,
          ignored: false,
        };
      });

    const project = {
      root: directory,
      name: "inline-style-fixtures",
      version: "1.0.0",
    } as ProjectModel;
    const ast = createASTProject(project, files);
    result = await runRuleEngine({
      project,
      ast,
      files,
      rules: [new InlineStyleRule()],
      writeSummary: () => undefined,
    });
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it.each([
    ["simple.tsx", 1],
    ["multi-property.tsx", 1],
    ["nested.tsx", 1],
    ["multiple.tsx", 2],
  ])("reports inline object literals in %s", (fileName, expected) => {
    expect(findingsFor(fileName)).toHaveLength(expected);
  });

  it.each([
    "references.tsx",
    "function-call.tsx",
    "dynamic-expression.tsx",
    "empty.tsx",
    "invalid.tsx",
  ])("does not report intentionally ignored input in %s", (fileName) => {
    expect(findingsFor(fileName)).toHaveLength(0);
  });

  it("produces canonical metadata, messages, and exact source locations", () => {
    const finding = findingsFor("simple.tsx")[0];

    expect(finding).toMatchObject({
      code: INLINE_STYLE_RULE_ID,
      origin: { ruleId: INLINE_STYLE_RULE_ID },
      severity: FindingSeverity.Warning,
      category: FindingCategory.Performance,
      message: { title: "Avoid inline style objects." },
      tags: [FindingTag.Jsx, FindingTag.Styles, FindingTag.Performance, FindingTag.ReactNative],
      location: {
        encoding: PositionEncoding.Utf16,
        start: { line: 1 },
        end: { line: 1 },
      },
    });
    expect(finding?.message.description).toContain("StyleSheet.create()");
    expect(finding?.location.end.offset).toBeGreaterThan(
      finding?.location.start.offset ?? Number.POSITIVE_INFINITY,
    );
  });

  it("declares the requested production rule metadata", () => {
    const metadata = new InlineStyleRule().meta;
    expect(metadata.category).toBe(FindingCategory.Performance);
    expect(metadata.defaultSeverity).toBe(RuleSeverity.Warning);
    expect(metadata.supportsAutoFix).toBe(false);
    expect(metadata.tags).toEqual([
      FindingTag.Jsx,
      FindingTag.Styles,
      FindingTag.Performance,
      FindingTag.ReactNative,
    ]);
  });

  it("skips the invalid fixture while processing every valid fixture", () => {
    expect(result.failures).toHaveLength(0);
    expect(result.findings).toHaveLength(5);
    expect(result.summary.parsedFileCount).toBe(files.length - 1);
  });

  function findingsFor(fileName: string) {
    return result.findings.filter((finding) => basename(finding.source.path ?? "") === fileName);
  }
});
