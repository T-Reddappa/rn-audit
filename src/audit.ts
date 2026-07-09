/** End-to-end MVP audit orchestration. */

import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { createASTProject } from "./ast/project.js";
import { discoverProject } from "./discovery/index.js";
import { reportAudit, type ConsoleWriter } from "./reporters/console.js";
import { runRuleEngine, type RuleEngineResult } from "./rules/engine.js";
import { InlineCallbackRule } from "./rules/inline-callback.js";
import { InlineStyleRule } from "./rules/inline-style.js";
import { discoverSourceFiles } from "./scanner/index.js";
import type { ProjectModel } from "./types/project.js";

export interface AuditOptions {
  readonly cwd?: string;
  readonly write?: ConsoleWriter;
}

export interface AuditResult {
  readonly project: ProjectModel;
  readonly analysis: RuleEngineResult;
  /** 0 = clean, 1 = diagnostics found, 2 = incomplete analysis. */
  readonly exitCode: 0 | 1 | 2;
}

/** Connect discovery, scanning, parsing, the built-in rule, and reporting. */
export async function runAudit(options: AuditOptions = {}): Promise<AuditResult> {
  const totalStart = performance.now();

  const discoveryStart = performance.now();
  const project = discoverProject({ cwd: resolve(options.cwd ?? process.cwd()) });
  const discoveryMs = performance.now() - discoveryStart;

  const scannerStart = performance.now();
  const sources = discoverSourceFiles(project);
  const scannerMs = performance.now() - scannerStart;

  const astStart = performance.now();
  const ast = createASTProject(project, sources.files, { eagerParsing: true });
  const parsedFiles = [...ast.getSourceFiles()];
  const astMs = performance.now() - astStart;

  const rulesStart = performance.now();
  const analysis = await runRuleEngine({
    project,
    ast,
    files: sources.files,
    rules: [new InlineStyleRule(), new InlineCallbackRule()],
    writeSummary: () => undefined,
  });
  const rulesMs = performance.now() - rulesStart;

  reportAudit(
    {
      project,
      sources,
      parsedFiles,
      result: analysis,
      timings: {
        discoveryMs,
        scannerMs,
        astMs,
        rulesMs,
        totalMs: performance.now() - totalStart,
      },
    },
    options.write,
  );

  const hasOperationalFailures =
    analysis.failures.length > 0 || parsedFiles.some((file) => !file.isParsed);
  const exitCode = hasOperationalFailures ? 2 : analysis.findings.length > 0 ? 1 : 0;
  return Object.freeze({ project, analysis, exitCode });
}
