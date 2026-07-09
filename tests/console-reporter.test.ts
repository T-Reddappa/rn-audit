import { describe, expect, it } from "vitest";
import {
  buildConsoleReport,
  buildReportSummary,
  formatSummaryRows,
  formatTimingRows,
  getRuleDisplayName,
  reportAudit,
  type AuditTimings,
  type ConsoleReportInput,
} from "../src/reporters/console.js";
import {
  createFinding,
  FindingCategory,
  FindingSeverity,
  FindingTag,
  PositionEncoding,
} from "../src/rules/finding.js";
import type { RuleEngineResult } from "../src/rules/engine.js";
import type { ProjectModel } from "../src/types/project.js";

function finding(
  overrides: {
    ruleId?: string;
    category?: FindingCategory;
    path?: string;
    line?: number;
    column?: number;
    recommendation?: string;
    tags?: readonly FindingTag[];
  } = {},
) {
  const ruleId = overrides.ruleId ?? "core/inline-style";
  const path = overrides.path ?? "src/Home.tsx";
  const line = overrides.line ?? 1;
  const column = overrides.column ?? 1;

  return createFinding({
    id: `${ruleId}:${path}:${line}`,
    code: ruleId,
    origin: { ruleId },
    message: {
      title: getRuleDisplayName(ruleId),
      description: "Example diagnostic description.",
    },
    severity: FindingSeverity.Warning,
    category: overrides.category ?? FindingCategory.Performance,
    source: {
      uri: `file:///${path}`,
      path,
      language: "typescriptreact",
    },
    location: {
      start: { line, column, offset: line * 10 + column },
      end: { line, column: column + 4, offset: line * 10 + column + 4 },
      encoding: PositionEncoding.Utf16,
    },
    recommendation: overrides.recommendation
      ? { message: overrides.recommendation }
      : { message: "Extract inline style objects into StyleSheet.create()." },
    tags: overrides.tags ?? [FindingTag.Performance, FindingTag.Jsx],
    suggestions: [],
  });
}

function engineResult(findings: ReturnType<typeof finding>[]): RuleEngineResult {
  return {
    findings,
    failures: [],
    summary: {
      ruleCount: 2,
      parsedFileCount: 10,
      findingCount: findings.length,
      failureCount: 0,
      durationMs: 12,
      rules: [],
    },
  };
}

function reportInput(
  findings: ReturnType<typeof finding>[],
  overrides: Partial<ConsoleReportInput> = {},
): ConsoleReportInput {
  return {
    project: { name: "demo-app" } as ProjectModel,
    sources: { files: [], ignored: [], traversalTimeMs: 0, directoriesVisited: 0, warnings: [] },
    parsedFiles: [],
    result: engineResult(findings),
    timings: {
      discoveryMs: 5,
      scannerMs: 41,
      astMs: 920,
      rulesMs: 33,
      totalMs: 996,
    },
    ...overrides,
  };
}

describe("console reporter grouping", () => {
  it("groups findings by category, rule, file, and locations", () => {
    const report = buildConsoleReport([
      finding({ path: "src/app/index.tsx", line: 9, column: 24 }),
      finding({ path: "src/app/index.tsx", line: 10, column: 28 }),
      finding({ path: "src/components/ui/collapsible.tsx", line: 26, column: 20 }),
    ]);

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      label: "Performance",
      count: 3,
      rules: [
        {
          displayName: "Inline Style",
          count: 3,
          files: [
            {
              path: "src/app/index.tsx",
              locations: [
                { line: 9, column: 24 },
                { line: 10, column: 28 },
              ],
            },
            {
              path: "src/components/ui/collapsible.tsx",
              locations: [{ line: 26, column: 20 }],
            },
          ],
        },
      ],
    });
  });

  it("sorts rules, files, and locations deterministically", () => {
    const report = buildConsoleReport([
      finding({
        ruleId: "performance/inline-callback",
        path: "src/z-last.tsx",
        line: 44,
        column: 18,
        recommendation: "Consider extracting callbacks or using useCallback when appropriate.",
      }),
      finding({
        ruleId: "performance/inline-callback",
        path: "src/a-first.tsx",
        line: 18,
        column: 12,
        recommendation: "Consider extracting callbacks or using useCallback when appropriate.",
      }),
      finding({
        ruleId: "core/inline-style",
        path: "src/Home.tsx",
        line: 42,
        column: 20,
      }),
      finding({
        ruleId: "core/inline-style",
        path: "src/Home.tsx",
        line: 12,
        column: 8,
      }),
      finding({
        ruleId: "core/inline-style",
        path: "src/Profile.tsx",
        line: 9,
        column: 14,
      }),
    ]);

    expect(report[0]?.rules.map((rule) => rule.displayName)).toEqual([
      "Inline Callback",
      "Inline Style",
    ]);
    expect(report[0]?.rules[1]?.files.map((file) => file.path)).toEqual([
      "src/Home.tsx",
      "src/Profile.tsx",
    ]);
    expect(report[0]?.rules[1]?.files[0]?.locations).toEqual([
      { line: 12, column: 8 },
      { line: 42, column: 20 },
    ]);
  });

  it("deduplicates recommendations to one entry per rule group", () => {
    const lines: string[] = [];
    reportAudit(
      reportInput([
        finding({ path: "src/a.tsx", line: 1, column: 1 }),
        finding({ path: "src/b.tsx", line: 2, column: 2 }),
      ]),
      (line) => lines.push(line),
    );

    const output = lines.join("\n");
    const recommendationCount = output
      .split("\n")
      .filter((line) => line === "Extract inline style objects into StyleSheet.create().").length;

    expect(recommendationCount).toBe(1);
    expect(output).toContain("Recommendation");
  });

  it("prints category and rule counts", () => {
    const lines: string[] = [];
    reportAudit(
      reportInput([
        finding({ path: "src/a.tsx", line: 1, column: 1 }),
        finding({ path: "src/b.tsx", line: 2, column: 2 }),
        finding({
          ruleId: "performance/inline-callback",
          path: "src/c.tsx",
          line: 3,
          column: 3,
          recommendation: "Consider extracting callbacks or using useCallback when appropriate.",
        }),
      ]),
      (line) => lines.push(line),
    );

    const output = lines.join("\n");
    expect(output).toContain("Performance — 3 issues");
    expect(output).toContain("⚠ Inline Style (2)");
    expect(output).toContain("⚠ Inline Callback (1)");
  });

  it("formats summary rows with aligned counts", () => {
    const summary = buildReportSummary(
      engineResult([
        finding({ category: FindingCategory.Performance }),
        finding({ category: FindingCategory.Performance, tags: [FindingTag.ReactNative] }),
        finding({ category: FindingCategory.Accessibility }),
        finding({ category: FindingCategory.Accessibility, tags: [FindingTag.Expo] }),
      ]),
      1,
    );

    const rows = formatSummaryRows(summary);
    expect(rows[0]).toMatch(/^Files analyzed\s+10$/);
    expect(rows).toContain("Rules executed       2");
    expect(rows).toContain("Performance Issues   2");
    expect(rows).toContain("Accessibility        2");
    expect(rows).toContain("React Native Issues  1");
    expect(rows).toContain("Expo Issues          1");
    expect(rows).toContain("Total Diagnostics    4");
    expect(rows).toContain("Parse errors         1");
  });

  it("formats timing rows in a compact table", () => {
    const timings: AuditTimings = {
      discoveryMs: 5,
      scannerMs: 41,
      astMs: 920,
      rulesMs: 33,
      totalMs: 996,
    };

    const rows = formatTimingRows(timings, 2);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatch(/^Scanner\s+41 ms$/);
    expect(rows[1]).toMatch(/^AST\s+920 ms$/);
    expect(rows[2]).toMatch(/^Rules\s+33 ms$/);
    expect(rows[3]).toMatch(/^Reporter\s+2 ms$/);
    expect(rows[4]).toMatch(/^Total\s+996 ms$/);
  });

  it("renders multiple categories separately", () => {
    const report = buildConsoleReport([
      finding({ category: FindingCategory.Performance }),
      finding({ category: FindingCategory.Accessibility, ruleId: "accessibility/label" }),
    ]);

    expect(report.map((group) => group.label)).toEqual(["Performance", "Accessibility"]);
    expect(report[0]?.count).toBe(1);
    expect(report[1]?.count).toBe(1);
  });

  it("renders grouped output for multiple files and rules", () => {
    const lines: string[] = [];
    reportAudit(
      reportInput([
        finding({ path: "src/app/index.tsx", line: 9, column: 24 }),
        finding({ path: "src/app/index.tsx", line: 10, column: 28 }),
        finding({
          ruleId: "performance/inline-callback",
          path: "src/app/home.tsx",
          line: 18,
          column: 12,
          recommendation: "Consider extracting callbacks or using useCallback when appropriate.",
        }),
        finding({
          ruleId: "performance/inline-callback",
          path: "src/app/home.tsx",
          line: 44,
          column: 18,
          recommendation: "Consider extracting callbacks or using useCallback when appropriate.",
        }),
      ]),
      (line) => lines.push(line),
    );

    const output = lines.join("\n");
    expect(output).toContain("src/app/index.tsx");
    expect(output).toContain("  9:24");
    expect(output).toContain("  10:28");
    expect(output).toContain("src/app/home.tsx");
    expect(output).toContain("  18:12");
    expect(output).toContain("  44:18");
    expect(output).toContain(
      "Consider extracting callbacks or using useCallback when appropriate.",
    );
    expect(output).toContain("Scanner");
    expect(output).toContain("Reporter");
    expect(output).toContain("Total Diagnostics");
  });
});
