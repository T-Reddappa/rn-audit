/** Grouped, developer-friendly console reporter for audit diagnostics. */

import { performance } from "node:perf_hooks";
import chalk from "chalk";
import type { ASTSourceFile } from "../ast/types.js";
import type { RuleEngineResult } from "../rules/engine.js";
import { FindingCategory, FindingTag, type Finding } from "../rules/finding.js";
import type { SourceDiscoveryResult } from "../types/file.js";
import type { ProjectModel } from "../types/project.js";

// ---------------------------------------------------------------------------
// Color helpers — chalk auto-detects TTY, so tests/CI get plain text
// ---------------------------------------------------------------------------

const dim = (s: string) => chalk.dim(s);
const bold = (s: string) => chalk.bold(s);
const green = (s: string) => chalk.green(s);
const yellow = (s: string) => chalk.yellow(s);
const red = (s: string) => chalk.red(s);
const cyan = (s: string) => chalk.cyan(s);

function categoryColor(category: FindingCategory): (s: string) => string {
  switch (category) {
    case FindingCategory.Performance:
      return yellow;
    case FindingCategory.Correctness:
      return red;
    case FindingCategory.Security:
      return red;
    case FindingCategory.Accessibility:
      return chalk.blue;
    case FindingCategory.Maintainability:
      return chalk.magenta;
  }
}

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
  /** When true, show every location and file. Default compact mode truncates. */
  readonly verbose?: boolean;
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

/** Max locations to show per file before collapsing. */
const MAX_LOCATIONS_PER_FILE = 3;
/** Max files to show per rule before collapsing. */
const MAX_FILES_PER_RULE = 8;

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

  write(green(`✓ Project scanned: ${bold(input.project.name)}`));
  write(green(`✓ ${summary.filesAnalyzed} files analyzed`));
  write("");

  if (input.result.findings.length === 0) {
    write(dim(divider));
    write(green("No diagnostics found."));
  } else {
    for (const [index, categoryGroup] of report.entries()) {
      if (index > 0) write("");
      write(dim(divider));
      const issueWord = categoryGroup.count === 1 ? "issue" : "issues";
      write(
        bold(
          `${categoryColor(categoryGroup.category)(categoryGroup.label)} — ${categoryGroup.count} ${issueWord}`,
        ),
      );
      write("");

      for (const [ruleIndex, ruleGroup] of categoryGroup.rules.entries()) {
        if (ruleIndex > 0) {
          write("");
          write(dim(ruleSeparator));
          write("");
        }

        const limitFiles = input.verbose
          ? ruleGroup.files
          : ruleGroup.files.slice(0, MAX_FILES_PER_RULE);
        const hiddenFileCount = ruleGroup.files.length - limitFiles.length;

        write(`${yellow("⚠")} ${bold(ruleGroup.displayName)} ${dim(`(${ruleGroup.count})`)}`);
        write("");

        for (const fileGroup of limitFiles) {
          write(cyan(fileGroup.path));

          const limitLocations = input.verbose
            ? fileGroup.locations
            : fileGroup.locations.slice(0, MAX_LOCATIONS_PER_FILE);
          const hiddenLocCount = fileGroup.locations.length - limitLocations.length;

          for (const location of limitLocations) {
            write(dim(`  ${location.line}:${location.column}`));
          }
          if (hiddenLocCount > 0) {
            write(dim(`  ... and ${hiddenLocCount} more in this file`));
          }
          write("");
        }

        if (hiddenFileCount > 0) {
          write(dim(`  ... and ${hiddenFileCount} more files`));
          write("");
        }

        if (ruleGroup.recommendation) {
          write(green("Recommendation"));
          write("");
          write(ruleGroup.recommendation);
        }
      }
    }
  }

  if (parseFailures.length > 0 || input.result.failures.length > 0) {
    write("");
    write(dim(divider));
    write(bold("Failures"));
    write("");
    if (parseFailures.length > 0) write(red(`  Parse failures: ${parseFailures.length}`));
    if (input.result.failures.length > 0) {
      write(red(`  Rule failures: ${input.result.failures.length}`));
      for (const failure of input.result.failures) {
        write(dim(`  - ${failure.ruleId} (${failure.filePath}): ${failure.error.message}`));
      }
    }
  }

  write("");
  write(dim(divider));
  write(bold("Summary"));
  write("");
  for (const line of formatSummaryRows(summary)) write(dim(line));

  const reporterMs = performance.now() - reporterStart;
  write("");
  for (const line of formatTimingRows(input.timings, reporterMs)) write(dim(line));

  if (input.sources.warnings?.length) {
    write("");
    write(yellow(`Scanner warnings: ${input.sources.warnings.length}`));
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
