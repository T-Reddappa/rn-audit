/**
 * Rule Registry Diagnostics
 *
 * Registration problems are expected input outcomes, especially when loading
 * third-party plugins. They are represented as immutable data instead of
 * exceptions so callers can validate a complete batch and display every issue
 * at once. Exceptions are reserved for broken registry invariants and misuse
 * of strict APIs.
 *
 * @module rules/registry-diagnostics
 */

import type { RuleId, RuleNamespace } from "./descriptor.js";

/** Stable machine-readable codes for configuration, CI, and IDE integrations. */
export enum RegistryDiagnosticCode {
  DuplicateId = "duplicate-id",
  DuplicateName = "duplicate-name",
  InvalidMetadata = "invalid-metadata",
  ReservedNamespace = "reserved-namespace",
  NamespaceConflict = "namespace-conflict",
  VersionConflict = "version-conflict",
  DeprecatedRule = "deprecated-rule",
  ConfigurationConflict = "configuration-conflict",
}

/** Errors reject an operation; warnings and information preserve registration. */
export enum RegistryDiagnosticSeverity {
  Information = "information",
  Warning = "warning",
  Error = "error",
}

/** JSON-safe scalar context keeps diagnostics portable and cheap to serialize. */
export type RegistryDiagnosticDetail = string | number | boolean | null;

/** Structured validation outcome associated with a descriptor or namespace. */
export interface RegistryDiagnostic {
  readonly code: RegistryDiagnosticCode;
  readonly severity: RegistryDiagnosticSeverity;
  readonly message: string;
  readonly ruleId?: RuleId;
  readonly namespace?: RuleNamespace;
  readonly details?: Readonly<Record<string, RegistryDiagnosticDetail>>;
}

/** Input allows ordinary strings at construction boundaries. */
export interface RegistryDiagnosticInput {
  readonly code: RegistryDiagnosticCode;
  readonly severity: RegistryDiagnosticSeverity;
  readonly message: string;
  readonly ruleId?: string;
  readonly namespace?: string;
  readonly details?: Readonly<Record<string, RegistryDiagnosticDetail>>;
}

/** Aggregate returned by validators and non-throwing registry operations. */
export interface RegistryValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly RegistryDiagnostic[];
}

/** Build a defensively copied, immutable diagnostic. */
export function createRegistryDiagnostic(input: RegistryDiagnosticInput): RegistryDiagnostic {
  if (input.message.trim().length === 0) {
    throw new TypeError("Registry diagnostic message must not be empty");
  }

  return Object.freeze({
    ...input,
    ruleId: input.ruleId as RuleId | undefined,
    namespace: input.namespace as RuleNamespace | undefined,
    details: input.details ? Object.freeze({ ...input.details }) : undefined,
  });
}

/** Aggregate diagnostics and derive validity from error severity. */
export function createValidationResult(
  diagnostics: readonly RegistryDiagnostic[],
): RegistryValidationResult {
  return Object.freeze({
    valid: !diagnostics.some(
      (diagnostic) => diagnostic.severity === RegistryDiagnosticSeverity.Error,
    ),
    diagnostics: Object.freeze([...diagnostics]),
  });
}

/** Base class for exceptional registry failures, carrying a stable error code. */
export class RuleRegistryError extends Error {
  constructor(
    message: string,
    readonly code: RegistryDiagnosticCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RuleRegistryError";
  }
}

/** A strict operation attempted to introduce an existing rule ID. */
export class DuplicateRuleError extends RuleRegistryError {
  constructor(readonly ruleId: RuleId) {
    super(`Rule "${ruleId}" is already registered`, RegistryDiagnosticCode.DuplicateId);
    this.name = "DuplicateRuleError";
  }
}

/** A caller attempted to claim a namespace controlled by another source. */
export class NamespaceConflictError extends RuleRegistryError {
  constructor(readonly namespace: RuleNamespace) {
    super(
      `Namespace "${namespace}" is already owned by another source`,
      RegistryDiagnosticCode.NamespaceConflict,
    );
    this.name = "NamespaceConflictError";
  }
}

/** Descriptor metadata failed validation in a strict registration API. */
export class MetadataValidationError extends RuleRegistryError {
  constructor(
    readonly diagnostics: readonly RegistryDiagnostic[],
    options?: ErrorOptions,
  ) {
    super("Rule metadata validation failed", RegistryDiagnosticCode.InvalidMetadata, options);
    this.name = "MetadataValidationError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

/** Internal indexes disagree; this indicates a registry implementation defect. */
export class RegistryIntegrityError extends RuleRegistryError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, RegistryDiagnosticCode.ConfigurationConflict, options);
    this.name = "RegistryIntegrityError";
  }
}
