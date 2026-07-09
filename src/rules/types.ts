/**
 * Rule SDK — Core Contracts
 *
 * This module defines the stable, implementation-independent vocabulary used
 * by rules and by the framework that executes them. It intentionally contains
 * no registry, configuration resolution, traversal, or reporting logic.
 *
 * Rules depend on these contracts; framework implementations depend on them
 * too. Keeping the dependency pointed at abstractions prevents a rule from
 * coupling itself to the scanner, ts-morph, or a particular reporter.
 *
 * @module rules/types
 */

import type { ASTProject, ASTSourceFile } from "../ast/types.js";
import type { FileModel } from "../types/file.js";
import type { ProjectModel } from "../types/project.js";
import { FindingCategory } from "./finding.js";
import type { EstimatedFixTime, EstimatedImpact, Finding, FindingTag } from "./finding.js";

export { EstimatedFixTime, EstimatedImpact } from "./finding.js";
export type { Finding } from "./finding.js";

/** Stable categories used to group rules and findings across all reporters. */
export const RuleCategory = FindingCategory;
export type RuleCategory = FindingCategory;

/**
 * User-visible severity. `Off` is valid in configuration, but never on a
 * produced finding because disabled rules are not executed.
 */
export enum RuleSeverity {
  Off = "off",
  Hint = "hint",
  Info = "info",
  Warning = "warning",
  Error = "error",
}

/** A semantic-version string identifying when a public rule changed. */
export type RuleVersion = string;

/** Searchable labels consumed by documentation, presets, and IDE tooling. */
export type RuleTag = FindingTag;

/** Documentation that can be rendered without loading a rule implementation. */
export interface RuleDocumentation {
  /** Canonical documentation page. */
  readonly url?: string;
  /** Concise rationale suitable for generated documentation. */
  readonly rationale?: string;
  /** Examples of compliant source code. */
  readonly goodExamples?: readonly string[];
  /** Examples of source code that the rule reports. */
  readonly badExamples?: readonly string[];
}

/**
 * Immutable rule identity and capabilities. Registries validate this once at
 * registration time, allowing execution to avoid repeated capability checks.
 */
export interface RuleMetadata {
  /** Globally unique, namespaced identifier, for example `core/no-inline-style`. */
  readonly id: string;
  /** Human-readable name used in documentation and interactive UIs. */
  readonly name: string;
  /** One-sentence description of the problem detected by the rule. */
  readonly description: string;
  /** Primary reporting and preset group. */
  readonly category: RuleCategory;
  /** Default severity before user configuration is resolved. */
  readonly defaultSeverity: Exclude<RuleSeverity, RuleSeverity.Off>;
  /** Whether the rule belongs in the built-in recommended preset. */
  readonly recommended: boolean;
  /** Whether execution requires semantic type information. */
  readonly requiresTypeInformation: boolean;
  /** Whether files without JSX can be skipped before execution. */
  readonly requiresJSX: boolean;
  /** Searchable capabilities and ecosystem labels. */
  readonly tags: readonly RuleTag[];
  /** Expected benefit when the reported issue is corrected. */
  readonly estimatedImpact?: EstimatedImpact;
  /** Expected manual effort for a typical occurrence. */
  readonly estimatedFixTime?: EstimatedFixTime;
  /** Declares that the rule may emit safe automatic edits. */
  readonly supportsAutoFix: boolean;
  /** Declares that the rule may emit optional editor suggestions. */
  readonly supportsSuggestions: boolean;
  /** SDK/package version in which the rule first became available. */
  readonly introducedVersion: RuleVersion;
  /** Deprecation details; absent means the rule is active. */
  readonly deprecated?: {
    readonly since: RuleVersion;
    readonly reason: string;
    readonly replacedBy?: string;
  };
  /** Structured documentation used by websites, CLIs, and IDEs. */
  readonly documentation?: RuleDocumentation;
}

/** JSON-compatible values accepted by rule option schemas. */
export type RuleOptionValue =
  | null
  | boolean
  | number
  | string
  | readonly RuleOptionValue[]
  | { readonly [key: string]: RuleOptionValue };

/** Options are rule-owned, immutable, and validated before execution. */
export type RuleOptions = Readonly<Record<string, RuleOptionValue>>;

/** Fully resolved configuration supplied to one rule invocation. */
export interface RuleConfiguration<Options extends RuleOptions = RuleOptions> {
  readonly severity: Exclude<RuleSeverity, RuleSeverity.Off>;
  readonly options: Readonly<Options>;
}

/** Minimal structured logger; implementations may target debug output or no-op. */
export interface RuleLogger {
  debug(message: string, details?: Readonly<Record<string, unknown>>): void;
  warn(message: string, details?: Readonly<Record<string, unknown>>): void;
}

/**
 * Typed service lookup for optional framework/plugin capabilities. Rules must
 * tolerate an unavailable service unless their metadata declares it required.
 */
export interface RuleServices {
  get<Service>(key: string): Service | undefined;
}

/**
 * Capability object supplied to a rule. It exposes read-only scanner and AST
 * models while hiding their construction, lifecycle, and concrete parser.
 */
export interface RuleContext<Options extends RuleOptions = RuleOptions> {
  readonly project: ProjectModel;
  readonly ast: ASTProject;
  readonly file: FileModel;
  readonly sourceFile: ASTSourceFile;
  readonly configuration: RuleConfiguration<Options>;
  readonly logger: RuleLogger;
  readonly services: RuleServices;
  /** Enables cooperative cancellation in CLI, IDE, and future worker runs. */
  readonly signal: AbortSignal;
}

/** Findings and timing produced by one successful rule invocation. */
export interface RuleResult {
  readonly ruleId: string;
  readonly filePath: string;
  readonly findings: readonly Finding[];
  readonly durationMs: number;
}

/**
 * The only contract a rule author implements. The framework owns discovery,
 * validation, scheduling, error isolation, and result collection.
 */
export interface Rule<Options extends RuleOptions = RuleOptions> {
  readonly meta: RuleMetadata;
  analyze(context: RuleContext<Options>): readonly Finding[] | Promise<readonly Finding[]>;
}
