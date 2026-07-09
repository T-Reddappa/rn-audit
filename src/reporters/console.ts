/** Grouped, developer-friendly console reporter for audit diagnostics. */

import { performance } from "node:perf_hooks";
import type { ASTSourceFile } from "../ast/types.js";
import type { RuleEngineResult } from "../rules/engine.js";
import { FindingCategory, FindingTag, type Finding } from "../rules/finding.js";
import type { SourceDiscoveryResult } from "../types/file.js";
import type { ProjectModel } from "../types/project.js";

export interface AuditTimings {
  readonly discoveryMs: number;
  readonly scannerMs: number;
  readonly astMs: number;
  readonly rulesMs: number;
  readonly totalMs: number;
}

export interface ConsoleReportInput {
  readonly project: ProjectModel;
  readonly sources: SourceDiscoveryResult;
  readonly parsedFiles: readonly ASTSourceFile[];
  readonly result: RuleEngineResult;
  readonly timings: AuditTimings;
}

export type ConsoleWriter = (line: string) => void;

export interface LocationReport {
  readonly line: number;
  readonly column: number;
}

export interface FileReportGroup {
  readonly path: string;
  readonly locations: readonly LocationReport[];
}

export interface RuleReportGroup {
  readonly ruleId: string;
  readonly displayName: string;
  readonly count: number;
  readonly recommendation: string | undefined;
  readonly files: readonly FileReportGroup[];
}

export interface CategoryReportGroup {
  readonly category: FindingCategory;
  readonly label: string;
  readonly count: number;
  readonly rules: readonly RuleReportGroup[];
}

export interface ReportSummary {
  readonly filesAnalyzed: number;
  readonly rulesExecuted: number;
  readonly totalDiagnostics: number;
  readonly parseErrors: number;
  readonly ruleFailures: number;
  readonly categoryCounts: Readonly<Partial<Record<FindingCategory, number>>>;
  readonly reactNativeIssues: number;
  readonly expoIssues: number;
}

const divider = "━".repeat(42);
const ruleSeparator = "-".repeat(54);

const CATEGORY_ORDER: readonly FindingCategory[] = [
  FindingCategory.Performance,
  FindingCategory.Accessibility,
  FindingCategory.Correctness,
  FindingCategory.Maintainability,
  FindingCategory.Security,
];

const CATEGORY_LABELS: Readonly<Record<FindingCategory, string>> = {
  [FindingCategory.Performance]: "Performance",
  [FindingCategory.Accessibility]: "Accessibility",
  [FindingCategory.Correctness]: "Correctness",
  [FindingCategory.Maintainability]: "Maintainability",
  [FindingCategory.Security]: "Security",
};

const SUMMARY_CATEGORY_LABELS: Readonly<Record<FindingCategory, string>> = {
  [FindingCategory.Performance]: "Performance Issues",
  [FindingCategory.Accessibility]: "Accessibility",
  [FindingCategory.Correctness]: "Correctness Issues",
  [FindingCategory.Maintainability]: "Maintainability Issues",
  [FindingCategory.Security]: "Security Issues",
};

/** Build the grouped Category → Rule → File → Locations report model. */
export function buildConsoleReport(findings: readonly Finding[]): readonly CategoryReportGroup[] {
  const byCategory = new Map<FindingCategory, Map<string, Finding[]>>();

  for (const finding of findings) {
    const byRule = byCategory.get(finding.category) ?? new Map<string, Finding[]>();
    const ruleFindings = byRule.get(finding.origin.ruleId) ?? [];
    ruleFindings.push(finding);
    byRule.set(finding.origin.ruleId, ruleFindings);
    byCategory.set(finding.category, byRule);
  }

  return CATEGORY_ORDER.flatMap((category) => {
    const byRule = byCategory.get(category);
    if (!byRule) return [];

    const rules = [...byRule.entries()]
      .map(([ruleId, ruleFindings]) => buildRuleGroup(ruleId, ruleFindings))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));

    const count = rules.reduce((total, rule) => total + rule.count, 0);
    return [
      {
        category,
        label: CATEGORY_LABELS[category],
        count,
        rules,
      },
    ];
  });
}

/** Build summary counts used by the footer section. */
export function buildReportSummary(
  result: RuleEngineResult,
  parseErrorCount: number,
): ReportSummary {
  const categoryCounts: Partial<Record<FindingCategory, number>> = {};
  let reactNativeIssues = 0;
  let expoIssues = 0;

  for (const finding of result.findings) {
    categoryCounts[finding.category] = (categoryCounts[finding.category] ?? 0) + 1;
    if (finding.tags.includes(FindingTag.ReactNative)) reactNativeIssues += 1;
    if (finding.tags.includes(FindingTag.Expo)) expoIssues += 1;
  }

  return {
    filesAnalyzed: result.summary.parsedFileCount,
    rulesExecuted: result.summary.ruleCount,
    totalDiagnostics: result.summary.findingCount,
    parseErrors: parseErrorCount,
    ruleFailures: result.summary.failureCount,
    categoryCounts,
    reactNativeIssues,
    expoIssues,
  };
}

/** Format aligned summary rows for deterministic testing. */
export function formatSummaryRows(summary: ReportSummary): readonly string[] {
  const rows: Array<{ label: string; value: string | number }> = [
    { label: "Files analyzed", value: summary.filesAnalyzed },
    { label: "Rules executed", value: summary.rulesExecuted },
  ];

  for (const category of CATEGORY_ORDER) {
    const count = summary.categoryCounts[category];
    if (count) rows.push({ label: SUMMARY_CATEGORY_LABELS[category], value: count });
  }

  if (summary.reactNativeIssues > 0) {
    rows.push({ label: "React Native Issues", value: summary.reactNativeIssues });
  }
  if (summary.expoIssues > 0) {
    rows.push({ label: "Expo Issues", value: summary.expoIssues });
  }

  rows.push({ label: "Total Diagnostics", value: summary.totalDiagnostics });

  if (summary.parseErrors > 0) {
    rows.push({ label: "Parse errors", value: summary.parseErrors });
  }
  if (summary.ruleFailures > 0) {
    rows.push({ label: "Rule failures", value: summary.ruleFailures });
  }

  const labelWidth = Math.max(...rows.map((row) => row.label.length)) + 2;
  return rows.map((row) => `${row.label.padEnd(labelWidth)}${row.value}`);
}

/** Format aligned timing rows for deterministic testing. */
export function formatTimingRows(timings: AuditTimings, reporterMs: number): readonly string[] {
  const totalMs = timings.scannerMs + timings.astMs + timings.rulesMs + reporterMs;
  const rows = [
    { label: "Scanner", value: formatMs(timings.scannerMs) },
    { label: "AST", value: formatMs(timings.astMs) },
    { label: "Rules", value: formatMs(timings.rulesMs) },
    { label: "Reporter", value: formatMs(reporterMs) },
    { label: "Total", value: formatMs(totalMs) },
  ];
  const labelWidth = Math.max(...rows.map((row) => row.label.length)) + 2;
  return rows.map((row) => `${row.label.padEnd(labelWidth)}${row.value}`);
}

export function getRuleDisplayName(ruleId: string): string {
  const localName = ruleId.split("/").pop() ?? ruleId;
  return localName
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function reportAudit(input: ConsoleReportInput, write: ConsoleWriter = console.log): void {
  const reporterStart = performance.now();
  const parseFailures = input.parsedFiles.filter((file) => !file.isParsed);
  const report = buildConsoleReport(input.result.findings);
  const summary = buildReportSummary(input.result, parseFailures.length);

  write(`✓ Project scanned: ${input.project.name}`);
  write(`✓ ${summary.filesAnalyzed} files analyzed`);
  write("");

  if (input.result.findings.length === 0) {
    write(divider);
    write("No diagnostics found.");
  } else {
    for (const [index, categoryGroup] of report.entries()) {
      if (index > 0) write("");
      write(divider);
      write(`${categoryGroup.label} (${categoryGroup.count})`);
      write("");

      for (const [ruleIndex, ruleGroup] of categoryGroup.rules.entries()) {
        if (ruleIndex > 0) {
          write("");
          write(ruleSeparator);
          write("");
        }

        write(`⚠ ${ruleGroup.displayName} (${ruleGroup.count})`);
        write("");

        for (const fileGroup of ruleGroup.files) {
          write(fileGroup.path);
          for (const location of fileGroup.locations) {
            write(`  ${location.line}:${location.column}`);
          }
          write("");
        }

        if (ruleGroup.recommendation) {
          write("Recommendation");
          write("");
          write(ruleGroup.recommendation);
        }
      }
    }
  }

  if (parseFailures.length > 0 || input.result.failures.length > 0) {
    write("");
    write(divider);
    write("Failures");
    write("");
    if (parseFailures.length > 0) write(`  Parse failures: ${parseFailures.length}`);
    if (input.result.failures.length > 0) {
      write(`  Rule failures: ${input.result.failures.length}`);
      for (const failure of input.result.failures) {
        write(`  - ${failure.ruleId} (${failure.filePath}): ${failure.error.message}`);
      }
    }
  }

  write("");
  write(divider);
  write("Summary");
  write("");
  for (const line of formatSummaryRows(summary)) write(line);

  const reporterMs = performance.now() - reporterStart;
  write("");
  for (const line of formatTimingRows(input.timings, reporterMs)) write(line);

  if (input.sources.warnings?.length) {
    write("");
    write(`Scanner warnings: ${input.sources.warnings.length}`);
  }
}

function buildRuleGroup(ruleId: string, findings: Finding[]): RuleReportGroup {
  const sortedFindings = [...findings].sort(compareFindings);
  const byFile = new Map<string, LocationReport[]>();

  for (const finding of sortedFindings) {
    const path = finding.source.path ?? finding.source.uri;
    const locations = byFile.get(path) ?? [];
    locations.push({
      line: finding.location.start.line,
      column: finding.location.start.column,
    });
    byFile.set(path, locations);
  }

  const files = [...byFile.entries()]
    .map(([path, locations]) => ({ path, locations }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const recommendation = sortedFindings.find((finding) => finding.recommendation)?.recommendation
    ?.message;

  return {
    ruleId,
    displayName: getRuleDisplayName(ruleId),
    count: findings.length,
    recommendation,
    files,
  };
}

function compareFindings(left: Finding, right: Finding): number {
  const leftPath = left.source.path ?? left.source.uri;
  const rightPath = right.source.path ?? right.source.uri;
  const pathCompare = leftPath.localeCompare(rightPath);
  if (pathCompare !== 0) return pathCompare;

  const lineCompare = left.location.start.line - right.location.start.line;
  if (lineCompare !== 0) return lineCompare;

  return left.location.start.column - right.location.start.column;
}

function formatMs(duration: number): string {
  return `${Math.round(duration)} ms`;
}
