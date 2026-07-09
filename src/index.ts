/**
 * rn-audit — Public API
 *
 * This module is the programmatic entry point for rn-audit.
 * It is what users import when they write:
 *
 *   import { discoverProject } from 'rn-audit';
 *
 * The CLI entry point (src/cli.ts) is a separate module designed
 * for terminal use. This separation ensures that programmatic
 * consumers (IDE extensions, CI scripts, other tools) don't
 * pull in Commander, chalk, ora, or other terminal-specific
 * dependencies unnecessarily.
 *
 * @packageDocumentation
 */

// Project Discovery (Milestone 1.1)
export {
  discoverProject,
  DiscoveryError,
  NoPackageJsonError,
  NotReactNativeProjectError,
  UnsupportedProjectError,
  InvalidConfigurationError,
} from "./discovery/index.js";

// Source Discovery (Milestone 1.2)
export { discoverSourceFiles } from "./scanner/index.js";

// Types
export type {
  ProjectModel,
  ConfigFiles,
  DependencyMap,
  DiscoveryOptions,
} from "./discovery/index.js";

export type { FileModel, SourceDiscoveryResult, FileExtension } from "./types/file.js";

export { ProjectFramework, ExpoWorkflow, PackageManager } from "./types/project.js";

// AST Engine (Milestone 2)
export {
  createASTProject,
  createASTSourceFile,
  SyntaxKind,
  ParseErrorCollector,
  ParseErrorCode,
  fromTypeScriptDiagnostic,
  // Visitor primitives
  getKind,
  getText,
  getFullText,
  getStart,
  getEnd,
  getStartLine,
  getStartColumn,
  getEndLine,
  getEndColumn,
  getParent,
  getAncestors,
  getChildren,
  visitChildren,
  visitDescendants,
  findNodes,
  findNodesByKinds,
  findFirst,
  filterNodes,
  // Domain queries
  findJSXElements,
  findJSXAttributes,
  findJSXAttributeByName,
  hasJSXAttribute,
  getJSXTagName,
  findImports,
  hasImport,
  findCallExpressions,
  findCallExpressionsByName,
  findComponentDeclarations,
  findHookCalls,
  findObjectLiterals,
  findArrowFunctions,
  findIdentifiers,
  findIdentifiersByName,
} from "./ast/index.js";

export type {
  ASTProject,
  ASTSourceFile,
  ASTNode,
  ASTVisitor,
  VisitorContext,
  ParseError,
  ParseErrorSeverity,
  ASTProjectOptions,
  ASTCacheEntry,
} from "./ast/index.js";

// Rule Authoring SDK and MVP Rule Engine (Milestone 2.5)
export { RuleSeverity, RuleCategory } from "./rules/types.js";
export type {
  Rule,
  RuleMetadata,
  RuleContext,
  RuleServices,
  RuleLogger,
  RuleOptions,
  RuleConfiguration,
  RuleResult,
  RuleTag,
  RuleVersion,
  RuleDocumentation,
} from "./rules/types.js";

export {
  createFinding,
  FindingCategory,
  FindingSeverity,
  FindingTag,
  EstimatedImpact,
  EstimatedFixTime,
  PositionEncoding,
  InvalidFindingError,
} from "./rules/finding.js";
export type {
  Finding,
  FindingInput,
  FindingId,
  DiagnosticCode,
  SourcePosition,
  SourceLocation,
  SourceReference,
  FindingMessage,
  CodeFrame,
  DocumentationReference,
  Recommendation,
  TextEdit,
  SuggestedFix,
  Suggestion,
  FindingOrigin,
  FindingMetadata,
  FindingMetadataValue,
} from "./rules/finding.js";

export { runRuleEngine, formatRuleEngineSummary } from "./rules/engine.js";
export { InlineCallbackRule, INLINE_CALLBACK_RULE_ID } from "./rules/inline-callback.js";
export { InlineStyleRule, INLINE_STYLE_RULE_ID } from "./rules/inline-style.js";
export { runAudit } from "./audit.js";
export type { AuditOptions, AuditResult } from "./audit.js";
export type {
  RuleEngineOptions,
  RuleEngineResult,
  RuleEngineFailure,
  RuleEngineSummary,
  RuleExecutionSummary,
} from "./rules/engine.js";
