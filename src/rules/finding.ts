/**
 * Canonical, reporter-neutral Finding domain model.
 *
 * The model contains only deeply immutable, JSON-safe data. It deliberately
 * excludes AST nodes, filesystem handles, callbacks, and rendered CLI output.
 * Source ranges are half-open: start inclusive and end exclusive.
 *
 * @module rules/finding
 */

export type FindingId = string & { readonly __brand: "FindingId" };
export type DiagnosticCode = string & { readonly __brand: "DiagnosticCode" };

export enum FindingCategory {
  Performance = "performance",
  Accessibility = "accessibility",
  Correctness = "correctness",
  Maintainability = "maintainability",
  Security = "security",
}

/** `off` belongs to configuration, never to an emitted finding. */
export enum FindingSeverity {
  Hint = "hint",
  Info = "info",
  Warning = "warning",
  Error = "error",
}

/** Curated tags keep filtering and documentation consistent across rules. */
export enum FindingTag {
  BestPractice = "best-practice",
  Jsx = "jsx",
  Styles = "styles",
  Performance = "performance",
  UserExperience = "user-experience",
  Rendering = "rendering",
  Memory = "memory",
  Network = "network",
  BundleSize = "bundle-size",
  React = "react",
  Callbacks = "callbacks",
  ReactNative = "react-native",
  Expo = "expo",
}

export enum EstimatedImpact {
  Low = "low",
  Medium = "medium",
  High = "high",
}

export enum EstimatedFixTime {
  UnderFiveMinutes = "under-5-minutes",
  FiveToFifteenMinutes = "5-15-minutes",
  OverFifteenMinutes = "over-15-minutes",
}

/** JavaScript and LSP both use UTF-16 code units for offsets and columns. */
export enum PositionEncoding {
  Utf16 = "utf-16",
}

/** Lines and columns are one-based; offsets are zero-based UTF-16 code units. */
export interface SourcePosition {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface SourceLocation {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
  readonly encoding: PositionEncoding;
}

/** A URI supports physical files as well as future virtual editor documents. */
export interface SourceReference {
  readonly uri: string;
  readonly path?: string;
  readonly language?: string;
}

export interface FindingMessage {
  readonly title: string;
  readonly description: string;
}

/** Plain source excerpt with no ANSI, HTML, or other reporter-specific markup. */
export interface CodeFrame {
  readonly text: string;
  readonly startLine: number;
  readonly highlight: SourceLocation;
}

export interface DocumentationReference {
  readonly url: string;
  readonly label?: string;
}

export interface Recommendation {
  readonly message: string;
  readonly documentation?: DocumentationReference;
}

/** A replacement in the same source document as the owning finding. */
export interface TextEdit {
  readonly range: SourceLocation;
  readonly newText: string;
}

/** Structured now so a future fix engine needs no Finding schema migration. */
export interface SuggestedFix {
  readonly description: string;
  readonly edits: readonly TextEdit[];
  readonly applicability: "safe" | "unsafe";
}

/** An explicit user choice; suggestions are never applied implicitly. */
export interface Suggestion {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly edits?: readonly TextEdit[];
  readonly documentation?: DocumentationReference;
}

export interface FindingOrigin {
  readonly ruleId: string;
  readonly ruleVersion?: string;
  readonly plugin?: string;
}

export type FindingMetadataValue =
  | null
  | boolean
  | number
  | string
  | readonly FindingMetadataValue[]
  | { readonly [key: string]: FindingMetadataValue };

/** Namespaced, JSON-safe escape hatch for integrations and future plugins. */
export type FindingMetadata = Readonly<Record<string, FindingMetadataValue>>;

export interface Finding {
  readonly id: FindingId;
  readonly code: DiagnosticCode;
  readonly origin: FindingOrigin;
  readonly message: FindingMessage;
  readonly severity: FindingSeverity;
  readonly category: FindingCategory;
  readonly source: SourceReference;
  readonly location: SourceLocation;
  readonly codeFrame?: CodeFrame;
  readonly recommendation?: Recommendation;
  readonly tags: readonly FindingTag[];
  readonly estimatedImpact?: EstimatedImpact;
  readonly estimatedFixTime?: EstimatedFixTime;
  readonly fix?: SuggestedFix;
  readonly suggestions: readonly Suggestion[];
  readonly metadata?: FindingMetadata;
}

export type FindingInput = Omit<Finding, "id" | "code"> & {
  readonly id: string;
  readonly code: string;
};

export class InvalidFindingError extends Error {
  readonly name = "InvalidFindingError";
}

/** Validate, defensively copy, and deeply freeze one finding. */
export function createFinding(input: FindingInput): Finding {
  assertText(input.id, "id");
  assertText(input.code, "code");
  assertText(input.origin.ruleId, "origin.ruleId");
  assertText(input.message.title, "message.title");
  assertText(input.message.description, "message.description");
  assertText(input.source.uri, "source.uri");
  validateLocation(input.location, "location");
  if (input.codeFrame) {
    validateLocation(input.codeFrame.highlight, "codeFrame.highlight");
    assertPositive(input.codeFrame.startLine, "codeFrame.startLine");
  }
  validateEdits(input.fix?.edits, "fix.edits");
  input.suggestions.forEach((suggestion, index) => {
    assertText(suggestion.id, `suggestions[${index}].id`);
    validateEdits(suggestion.edits, `suggestions[${index}].edits`);
  });

  const finding: Finding = {
    ...input,
    id: input.id as FindingId,
    code: input.code as DiagnosticCode,
    tags: [...input.tags],
    suggestions: input.suggestions.map((suggestion) => ({
      ...suggestion,
      edits: suggestion.edits?.map(copyEdit),
    })),
    fix: input.fix ? { ...input.fix, edits: input.fix.edits.map(copyEdit) } : undefined,
  };
  return deepFreeze(finding);
}

function copyEdit(edit: TextEdit): TextEdit {
  return {
    ...edit,
    range: { ...edit.range, start: { ...edit.range.start }, end: { ...edit.range.end } },
  };
}

function validateEdits(edits: readonly TextEdit[] | undefined, path: string): void {
  edits?.forEach((edit, index) => validateLocation(edit.range, `${path}[${index}].range`));
}

function validateLocation(location: SourceLocation, path: string): void {
  validatePosition(location.start, `${path}.start`);
  validatePosition(location.end, `${path}.end`);
  if (location.encoding !== PositionEncoding.Utf16)
    throw new InvalidFindingError(`${path}.encoding must be utf-16`);
  if (location.end.offset < location.start.offset)
    throw new InvalidFindingError(`${path}.end must not precede ${path}.start`);
}

function validatePosition(position: SourcePosition, path: string): void {
  assertPositive(position.line, `${path}.line`);
  assertPositive(position.column, `${path}.column`);
  if (!Number.isSafeInteger(position.offset) || position.offset < 0)
    throw new InvalidFindingError(`${path}.offset must be a non-negative safe integer`);
}

function assertPositive(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new InvalidFindingError(`${path} must be a positive safe integer`);
}

function assertText(value: string, path: string): void {
  if (value.trim().length === 0) throw new InvalidFindingError(`${path} must not be empty`);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
