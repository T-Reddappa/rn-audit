import { describe, expect, it } from "vitest";
import {
  createFinding,
  EstimatedFixTime,
  EstimatedImpact,
  FindingCategory,
  FindingSeverity,
  FindingTag,
  InvalidFindingError,
  PositionEncoding,
  type FindingInput,
  type SourceLocation,
} from "../src/rules/finding.js";

const location: SourceLocation = {
  start: { line: 3, column: 5, offset: 24 },
  end: { line: 3, column: 10, offset: 29 },
  encoding: PositionEncoding.Utf16,
};

function input(overrides: Partial<FindingInput> = {}): FindingInput {
  return {
    id: "core/example:src/App.tsx:24",
    code: "core/example",
    origin: { ruleId: "core/example", ruleVersion: "1.0.0" },
    message: { title: "Example issue", description: "An example was found." },
    severity: FindingSeverity.Warning,
    category: FindingCategory.Performance,
    source: {
      uri: "file:///workspace/src/App.tsx",
      path: "src/App.tsx",
      language: "typescriptreact",
    },
    location,
    recommendation: {
      message: "Use the preferred pattern.",
      documentation: { url: "https://example.test/rules/example" },
    },
    tags: [FindingTag.BestPractice, FindingTag.ReactNative],
    estimatedImpact: EstimatedImpact.Medium,
    estimatedFixTime: EstimatedFixTime.UnderFiveMinutes,
    fix: {
      description: "Replace the expression.",
      applicability: "safe",
      edits: [{ range: location, newText: "replacement" }],
    },
    suggestions: [
      {
        id: "extract-value",
        title: "Extract the value",
        description: "Move the value to a reusable declaration.",
        edits: [{ range: location, newText: "sharedValue" }],
      },
    ],
    metadata: { "github/annotation-level": "warning", occurrence: 1 },
    ...overrides,
  };
}

describe("Finding domain model", () => {
  it("creates deeply immutable findings and defensively copies arrays", () => {
    const source = input();
    const finding = createFinding(source);

    expect(Object.isFrozen(finding)).toBe(true);
    expect(Object.isFrozen(finding.location.start)).toBe(true);
    expect(Object.isFrozen(finding.fix?.edits)).toBe(true);
    expect(Object.isFrozen(finding.suggestions[0]?.edits)).toBe(true);

    (source.tags as FindingTag[]).push(FindingTag.Memory);
    expect(finding.tags).not.toContain(FindingTag.Memory);
  });

  it("round-trips through JSON without losing domain data", () => {
    const finding = createFinding(input());
    const decoded: unknown = JSON.parse(JSON.stringify(finding));

    expect(decoded).toEqual(finding);
    expect(JSON.stringify(finding)).not.toContain("_internal");
  });

  it("retains UTF-16 positions and half-open offsets for editor integrations", () => {
    const finding = createFinding(input());

    expect(finding.location.encoding).toBe(PositionEncoding.Utf16);
    expect(finding.location.end.offset - finding.location.start.offset).toBe(5);
  });

  it("preserves structured fixes and user-selectable suggestions", () => {
    const finding = createFinding(input());

    expect(finding.fix).toMatchObject({ applicability: "safe" });
    expect(finding.fix?.edits[0]?.newText).toBe("replacement");
    expect(finding.suggestions[0]).toMatchObject({ id: "extract-value" });
  });

  it("rejects locations whose end precedes their start", () => {
    const invalidLocation: SourceLocation = {
      ...location,
      end: { line: 3, column: 4, offset: 23 },
    };

    expect(() => createFinding(input({ location: invalidLocation }))).toThrow(InvalidFindingError);
  });

  it("rejects empty stable identifiers", () => {
    expect(() => createFinding(input({ id: " " }))).toThrow("id must not be empty");
    expect(() => createFinding(input({ code: "" }))).toThrow("code must not be empty");
  });
});
