import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createASTProject } from "../src/ast/project.js";
import { runRuleEngine, type RuleEngineResult } from "../src/rules/engine.js";
import {
  EstimatedImpact,
  FindingCategory,
  FindingSeverity,
  FindingTag,
  PositionEncoding,
} from "../src/rules/finding.js";
import { INLINE_CALLBACK_RULE_ID, InlineCallbackRule } from "../src/rules/inline-callback.js";
import { RuleSeverity } from "../src/rules/types.js";
import type { FileModel } from "../src/types/file.js";
import type { ProjectModel } from "../src/types/project.js";

const fixtureDirectory = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/rules/inline-callback",
);

describe("InlineCallbackRule", () => {
  let directory: string;
  let files: FileModel[];
  let result: RuleEngineResult;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "rn-audit-inline-callback-"));
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
      name: "inline-callback-fixtures",
      version: "1.0.0",
    } as ProjectModel;
    const ast = createASTProject(project, files);
    result = await runRuleEngine({
      project,
      ast,
      files,
      rules: [new InlineCallbackRule()],
      writeSummary: () => undefined,
    });
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it.each([
    ["inline-arrow.tsx", 1],
    ["inline-function.tsx", 1],
    ["render-item.tsx", 1],
    ["key-extractor.tsx", 1],
    ["list-header.tsx", 1],
    ["nested.tsx", 2],
    ["multiple.tsx", 2],
  ])("reports inline callbacks in %s", (fileName, expected) => {
    expect(findingsFor(fileName)).toHaveLength(expected);
  });

  it.each([
    "variable-reference.tsx",
    "props-callback.tsx",
    "member-expression.tsx",
    "outside-jsx.tsx",
    "empty.tsx",
    "invalid.tsx",
  ])("does not report intentionally ignored input in %s", (fileName) => {
    expect(findingsFor(fileName)).toHaveLength(0);
  });

  it("produces canonical metadata, messages, and exact source locations", () => {
    const finding = findingsFor("inline-arrow.tsx")[0];

    expect(finding).toMatchObject({
      code: INLINE_CALLBACK_RULE_ID,
      origin: { ruleId: INLINE_CALLBACK_RULE_ID },
      severity: FindingSeverity.Warning,
      category: FindingCategory.Performance,
      message: { title: "Inline Callback" },
      tags: [
        FindingTag.Rendering,
        FindingTag.Performance,
        FindingTag.Jsx,
        FindingTag.Callbacks,
        FindingTag.React,
      ],
      location: {
        encoding: PositionEncoding.Utf16,
        start: { line: 1 },
        end: { line: 1 },
      },
    });
    expect(finding?.message.description).toContain("Avoid inline callback functions inside JSX.");
    expect(finding?.message.description).toContain("may contribute to unnecessary rerenders");
    expect(finding?.recommendation?.message).toContain("useCallback when appropriate");
    expect(finding?.location.end.offset).toBeGreaterThan(
      finding?.location.start.offset ?? Number.POSITIVE_INFINITY,
    );
  });

  it("declares the requested production rule metadata", () => {
    const metadata = new InlineCallbackRule().meta;
    expect(metadata.id).toBe(INLINE_CALLBACK_RULE_ID);
    expect(metadata.category).toBe(FindingCategory.Performance);
    expect(metadata.defaultSeverity).toBe(RuleSeverity.Warning);
    expect(metadata.supportsAutoFix).toBe(false);
    expect(metadata.tags).toEqual([
      FindingTag.Rendering,
      FindingTag.Performance,
      FindingTag.Jsx,
      FindingTag.Callbacks,
      FindingTag.React,
    ]);
  });

  it("marks list-related props with higher estimated impact", () => {
    expect(findingsFor("render-item.tsx")[0]?.estimatedImpact).toBe(EstimatedImpact.High);
    expect(findingsFor("key-extractor.tsx")[0]?.estimatedImpact).toBe(EstimatedImpact.High);
    expect(findingsFor("list-header.tsx")[0]?.estimatedImpact).toBe(EstimatedImpact.High);
    expect(findingsFor("inline-arrow.tsx")[0]?.estimatedImpact).toBe(EstimatedImpact.Low);
  });

  it("skips the invalid fixture while processing every valid fixture", () => {
    expect(result.failures).toHaveLength(0);
    expect(result.findings).toHaveLength(9);
    expect(result.summary.parsedFileCount).toBe(files.length - 1);
  });

  function findingsFor(fileName: string) {
    return result.findings.filter((finding) => basename(finding.source.path ?? "") === fileName);
  }
});
