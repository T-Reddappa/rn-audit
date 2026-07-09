/**
 * Simple Rule Engine
 *
 * Executes rules sequentially against every parsed source file. This engine is
 * intentionally small: it owns context construction, failure isolation,
 * collection, timing, and a final human-readable summary—nothing else.
 *
 * @module rules/engine
 */

import { performance } from "node:perf_hooks";
import type { ASTProject, ASTSourceFile } from "../ast/types.js";
import type { FileModel } from "../types/file.js";
import type { ProjectModel } from "../types/project.js";
import type { Finding } from "./finding.js";
import {
  type Rule,
  type RuleConfiguration,
  type RuleContext,
  type RuleLogger,
  type RuleOptions,
  type RuleServices,
} from "./types.js";

export interface RuleEngineFailure {
  readonly ruleId: string;
  readonly filePath: string;
  readonly error: Error;
}

export interface RuleExecutionSummary {
  readonly ruleId: string;
  readonly filesAnalyzed: number;
  readonly findingCount: number;
  readonly failureCount: number;
  readonly durationMs: number;
}

export interface RuleEngineSummary {
  readonly ruleCount: number;
  readonly parsedFileCount: number;
  readonly findingCount: number;
  readonly failureCount: number;
  readonly durationMs: number;
  readonly rules: readonly RuleExecutionSummary[];
}

export interface RuleEngineResult {
  readonly findings: readonly Finding[];
  readonly failures: readonly RuleEngineFailure[];
  readonly summary: RuleEngineSummary;
}

export interface RuleEngineOptions {
  readonly project: ProjectModel;
  readonly ast: ASTProject;
  readonly files: readonly FileModel[];
  readonly rules: readonly Rule[];
  readonly logger?: RuleLogger;
  readonly services?: RuleServices;
  readonly signal?: AbortSignal;
  /** Override resolved rule configuration by rule ID. */
  readonly configurations?: Readonly<Record<string, RuleConfiguration>>;
  /** Defaults to printing the formatted summary with `console.log`. */
  readonly writeSummary?: (summary: string) => void;
  /** Called as each rule begins executing so callers can update a progress indicator. */
  readonly onProgress?: (label: string) => void;
}

const silentLogger: RuleLogger = Object.freeze({
  debug: () => undefined,
  warn: () => undefined,
});

const emptyServices: RuleServices = Object.freeze({
  get: () => undefined,
});

/** Execute every rule against every successfully parsed source file. */
export async function runRuleEngine(options: RuleEngineOptions): Promise<RuleEngineResult> {
  const engineStart = performance.now();
  const findings: Finding[] = [];
  const failures: RuleEngineFailure[] = [];
  const ruleSummaries: RuleExecutionSummary[] = [];
  const parsedFiles = collectParsedFiles(options.ast, options.files);
  const signal = options.signal ?? new AbortController().signal;
  const logger = options.logger ?? silentLogger;
  const services = options.services ?? emptyServices;

  const ruleCount = options.rules.length;
  let ruleIndex = 0;

  for (const rule of options.rules) {
    ruleIndex++;
    const ruleStart = performance.now();
    let filesAnalyzed = 0;
    let ruleFindingCount = 0;
    let ruleFailureCount = 0;

    options.onProgress?.(`Running rule ${ruleIndex}/${ruleCount}: ${rule.meta.id}`);

    for (const { file, sourceFile } of parsedFiles) {
      if (signal.aborted) break;

      const context: RuleContext = {
        project: options.project,
        ast: options.ast,
        file,
        sourceFile,
        configuration: resolveConfiguration(rule, options.configurations),
        logger,
        services,
        signal,
      };
      filesAnalyzed += 1;

      try {
        const produced = await rule.analyze(context);
        findings.push(...produced);
        ruleFindingCount += produced.length;
      } catch (cause: unknown) {
        const error = normalizeError(cause);
        failures.push(Object.freeze({ ruleId: rule.meta.id, filePath: file.absolutePath, error }));
        ruleFailureCount += 1;
        logger.warn(`Rule "${rule.meta.id}" failed for ${file.relativePath}`, {
          error: error.message,
        });
      }
    }

    ruleSummaries.push(
      Object.freeze({
        ruleId: rule.meta.id,
        filesAnalyzed,
        findingCount: ruleFindingCount,
        failureCount: ruleFailureCount,
        durationMs: performance.now() - ruleStart,
      }),
    );
  }

  const summary: RuleEngineSummary = Object.freeze({
    ruleCount: options.rules.length,
    parsedFileCount: parsedFiles.length,
    findingCount: findings.length,
    failureCount: failures.length,
    durationMs: performance.now() - engineStart,
    rules: Object.freeze(ruleSummaries),
  });

  const writeSummary = options.writeSummary ?? console.log;
  writeSummary(formatRuleEngineSummary(summary));

  return Object.freeze({
    findings: Object.freeze(findings),
    failures: Object.freeze(failures),
    summary,
  });
}

/** Format a compact summary without introducing a reporter dependency. */
export function formatRuleEngineSummary(summary: RuleEngineSummary): string {
  const heading = [
    `Rule analysis complete in ${summary.durationMs.toFixed(1)}ms`,
    `${summary.ruleCount} rules`,
    `${summary.parsedFileCount} parsed files`,
    `${summary.findingCount} findings`,
    `${summary.failureCount} failures`,
  ].join(" · ");
  const rules = summary.rules.map(
    (rule) =>
      `  ${rule.ruleId}: ${rule.findingCount} findings, ${rule.failureCount} failures (${rule.durationMs.toFixed(1)}ms)`,
  );
  return [heading, ...rules].join("\n");
}

function collectParsedFiles(
  ast: ASTProject,
  files: readonly FileModel[],
): Array<{ readonly file: FileModel; readonly sourceFile: ASTSourceFile }> {
  const parsed: Array<{ file: FileModel; sourceFile: ASTSourceFile }> = [];
  for (const file of files) {
    const sourceFile = ast.getSourceFile(file.absolutePath);
    if (sourceFile?.isParsed) parsed.push({ file, sourceFile });
  }
  return parsed;
}

function resolveConfiguration(
  rule: Rule,
  configurations: RuleEngineOptions["configurations"],
): RuleConfiguration {
  return (
    configurations?.[rule.meta.id] ?? {
      severity: rule.meta.defaultSeverity,
      options: Object.freeze({}) as RuleOptions,
    }
  );
}

function normalizeError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  return new Error(typeof cause === "string" ? cause : "Unknown rule execution error", { cause });
}
