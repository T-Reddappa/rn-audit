/**
 * Inline Style Detection
 *
 * Reports object literals passed directly to JSX `style` attributes. Creating
 * these objects during render can add avoidable allocations and makes styles
 * harder to reuse. References, function calls, conditional expressions, and
 * other dynamic values are intentionally ignored.
 *
 * Current limitations:
 * - Object literals inside style arrays are not reported.
 * - Objects returned by functions or stored in variables are not followed.
 * - This rule does not attempt to determine whether a component is native.
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

export const INLINE_STYLE_RULE_ID = "core/inline-style";

export class InlineStyleRule implements Rule {
  readonly meta: RuleMetadata = Object.freeze({
    id: INLINE_STYLE_RULE_ID,
    name: "Inline style detection",
    description: "Detects inline object literals passed directly to JSX style props.",
    category: FindingCategory.Performance,
    defaultSeverity: RuleSeverity.Warning,
    recommended: true,
    requiresTypeInformation: false,
    requiresJSX: true,
    tags: Object.freeze([
      FindingTag.Jsx,
      FindingTag.Styles,
      FindingTag.Performance,
      FindingTag.ReactNative,
    ]),
    estimatedImpact: EstimatedImpact.Low,
    estimatedFixTime: EstimatedFixTime.UnderFiveMinutes,
    supportsAutoFix: false,
    supportsSuggestions: false,
    introducedVersion: "0.1.0",
    documentation: Object.freeze({
      rationale:
        "Inline style objects are allocated during rendering and cannot be reused across components.",
    }),
  });

  analyze(context: RuleContext): readonly Finding[] {
    const findings: Finding[] = [];

    context.sourceFile.traverse({
      [SyntaxKind.JsxAttribute]: (attribute) => {
        const objectLiteral = getInlineStyleObject(attribute);
        if (!objectLiteral) return;
        findings.push(createInlineStyleFinding(context, objectLiteral));
      },
    });

    return findings;
  }
}

function getInlineStyleObject(attribute: ASTNode): ASTNode | undefined {
  let attributeName: ASTNode | undefined;
  let initializer: ASTNode | undefined;

  visitChildren(attribute, (child) => {
    const kind = getKind(child);
    if (!attributeName && kind === SyntaxKind.Identifier) attributeName = child;
    else if (kind === SyntaxKind.JsxExpression) initializer = child;
  });

  if (!attributeName || getText(attributeName) !== "style" || !initializer) return undefined;

  let objectLiteral: ASTNode | undefined;
  visitChildren(initializer, (child) => {
    if (getKind(child) === SyntaxKind.ObjectLiteralExpression) {
      objectLiteral = child;
      return false;
    }
    return undefined;
  });
  return objectLiteral;
}

function createInlineStyleFinding(context: RuleContext, node: ASTNode): Finding {
  const location = getLocation(node);
  return createFinding({
    id: `${INLINE_STYLE_RULE_ID}:${context.file.relativePath}:${location.start.offset}`,
    code: INLINE_STYLE_RULE_ID,
    origin: { ruleId: INLINE_STYLE_RULE_ID, ruleVersion: "0.1.0" },
    message: {
      title: "Avoid inline style objects.",
      description:
        "Extract the style into StyleSheet.create() to improve readability and reduce unnecessary object allocations during rendering.",
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
      message: "Extract this object into a named style created with StyleSheet.create().",
    },
    tags: [FindingTag.Jsx, FindingTag.Styles, FindingTag.Performance, FindingTag.ReactNative],
    estimatedImpact: EstimatedImpact.Low,
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
