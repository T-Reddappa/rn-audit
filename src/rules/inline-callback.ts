/**
 * Inline Callback Detection
 *
 * Reports arrow functions and function expressions passed directly to JSX
 * attributes. These callbacks are recreated on every render, which may cause
 * unnecessary rerenders when passed to memoized children or list item
 * renderers.
 *
 * What this rule detects:
 * - `onPress={() => save()}`
 * - `renderItem={({ item }) => <Card item={item} />}`
 * - `onChange={function (value) { update(value); }}`
 *
 * Why inline callbacks may affect rendering:
 * - A new function reference is allocated during each render.
 * - Memoized children that compare props by reference may rerender anyway.
 * - List callbacks such as `renderItem` run for many items and amplify cost.
 *
 * Intentionally ignored (common false positives):
 * - Handlers extracted to variables: `const onPress = () => ...`
 * - References: `onPress={handlePress}`, `onPress={props.onPress}`
 * - Member expressions: `onPress={callbacks.save}`
 * - Conditional or logical expressions wrapping callbacks
 *
 * Current limitations:
 * - Only direct function expressions inside JSX attribute initializers are reported.
 * - Callbacks inside style arrays or spread props are not followed.
 * - The rule does not determine whether a child component is memoized.
 *
 * When useCallback is appropriate:
 * - The callback is passed to a memoized child or list renderer.
 * - The callback is a dependency of other hooks.
 *
 * When useCallback is unnecessary:
 * - The child is not memoized and rerenders with its parent anyway.
 * - The callback is not passed across a memo boundary.
 */

import { pathToFileURL } from "node:url";
import type { ASTNode } from "../ast/types.js";
import { SyntaxKind } from "../ast/source-file.js";
import {
  getEnd,
  getEndColumn,
  getEndLine,
  getKind,
  getStart,
  getStartColumn,
  getStartLine,
  getText,
  visitChildren,
} from "../ast/visitors.js";
import {
  createFinding,
  EstimatedFixTime,
  EstimatedImpact,
  FindingCategory,
  FindingSeverity,
  FindingTag,
  PositionEncoding,
  type Finding,
  type SourceLocation,
} from "./finding.js";
import { RuleSeverity, type Rule, type RuleContext, type RuleMetadata } from "./types.js";

export const INLINE_CALLBACK_RULE_ID = "performance/inline-callback";

const HIGH_IMPACT_LIST_PROPS = new Set([
  "renderItem",
  "ListHeaderComponent",
  "ListFooterComponent",
  "ItemSeparatorComponent",
  "keyExtractor",
]);

export class InlineCallbackRule implements Rule {
  readonly meta: RuleMetadata = Object.freeze({
    id: INLINE_CALLBACK_RULE_ID,
    name: "Inline callback detection",
    description:
      "Detects inline arrow functions and function expressions passed directly to JSX props.",
    category: FindingCategory.Performance,
    defaultSeverity: RuleSeverity.Warning,
    recommended: true,
    requiresTypeInformation: false,
    requiresJSX: true,
    tags: Object.freeze([
      FindingTag.Rendering,
      FindingTag.Performance,
      FindingTag.Jsx,
      FindingTag.Callbacks,
      FindingTag.React,
    ]),
    estimatedImpact: EstimatedImpact.Low,
    estimatedFixTime: EstimatedFixTime.UnderFiveMinutes,
    supportsAutoFix: false,
    supportsSuggestions: false,
    introducedVersion: "0.1.0",
    documentation: Object.freeze({
      rationale:
        "Inline callbacks are recreated during rendering and may contribute to unnecessary rerenders when passed to memoized children or list renderers.",
      badExamples: Object.freeze([
        "<Button onPress={() => save()} />",
        "renderItem={({ item }) => <ProductCard item={item} />}",
      ]),
      goodExamples: Object.freeze([
        "const onPress = () => save();\n<Button onPress={onPress} />",
        "<Button onPress={handlePress} />",
      ]),
    }),
  });

  analyze(context: RuleContext): readonly Finding[] {
    const findings: Finding[] = [];

    context.sourceFile.traverse({
      [SyntaxKind.JsxAttribute]: (attribute) => {
        const inlineCallback = getInlineCallback(attribute);
        if (!inlineCallback) return;
        findings.push(createInlineCallbackFinding(context, inlineCallback));
      },
    });

    return findings;
  }
}

interface InlineCallbackMatch {
  readonly callback: ASTNode;
  readonly attributeName: string;
}

function getInlineCallback(attribute: ASTNode): InlineCallbackMatch | undefined {
  let attributeName: ASTNode | undefined;
  let initializer: ASTNode | undefined;

  visitChildren(attribute, (child) => {
    const kind = getKind(child);
    if (!attributeName && kind === SyntaxKind.Identifier) attributeName = child;
    else if (kind === SyntaxKind.JsxExpression) initializer = child;
  });

  if (!attributeName || !initializer) return undefined;

  let callback: ASTNode | undefined;
  visitChildren(initializer, (child) => {
    const kind = getKind(child);
    if (kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.FunctionExpression) {
      callback = child;
      return false;
    }
    return undefined;
  });

  if (!callback) return undefined;
  return { callback, attributeName: getText(attributeName) };
}

function createInlineCallbackFinding(context: RuleContext, match: InlineCallbackMatch): Finding {
  const location = getLocation(match.callback);
  const estimatedImpact = HIGH_IMPACT_LIST_PROPS.has(match.attributeName)
    ? EstimatedImpact.High
    : EstimatedImpact.Low;

  return createFinding({
    id: `${INLINE_CALLBACK_RULE_ID}:${context.file.relativePath}:${location.start.offset}`,
    code: INLINE_CALLBACK_RULE_ID,
    origin: { ruleId: INLINE_CALLBACK_RULE_ID, ruleVersion: "0.1.0" },
    message: {
      title: "Inline Callback",
      description:
        "Avoid inline callback functions inside JSX. Inline callbacks are recreated during rendering. If passed to memoized children or frequently rendered components, they may contribute to unnecessary rerenders.",
    },
    severity: toFindingSeverity(context.configuration.severity),
    category: FindingCategory.Performance,
    source: {
      uri: pathToFileURL(context.file.absolutePath).href,
      path: context.file.relativePath,
      language: context.file.extension === ".tsx" ? "typescriptreact" : "javascriptreact",
    },
    location,
    recommendation: {
      message: "Consider extracting the callback or using useCallback when appropriate.",
    },
    tags: [
      FindingTag.Rendering,
      FindingTag.Performance,
      FindingTag.Jsx,
      FindingTag.Callbacks,
      FindingTag.React,
    ],
    estimatedImpact,
    estimatedFixTime: EstimatedFixTime.UnderFiveMinutes,
    suggestions: [],
  });
}

function getLocation(node: ASTNode): SourceLocation {
  return {
    start: { line: getStartLine(node), column: getStartColumn(node), offset: getStart(node) },
    end: { line: getEndLine(node), column: getEndColumn(node), offset: getEnd(node) },
    encoding: PositionEncoding.Utf16,
  };
}

function toFindingSeverity(severity: Exclude<RuleSeverity, RuleSeverity.Off>): FindingSeverity {
  switch (severity) {
    case RuleSeverity.Hint:
      return FindingSeverity.Hint;
    case RuleSeverity.Info:
      return FindingSeverity.Info;
    case RuleSeverity.Warning:
      return FindingSeverity.Warning;
    case RuleSeverity.Error:
      return FindingSeverity.Error;
  }
}
