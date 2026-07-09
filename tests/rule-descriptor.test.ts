import { describe, expect, it, vi } from "vitest";
import {
  defineRuleDescriptor,
  InvalidRuleDescriptorError,
  loadRule,
  parseRuleId,
  RuleSourceKind,
} from "../src/rules/descriptor.js";
import { FindingCategory, FindingTag } from "../src/rules/finding.js";
import { RuleSeverity, type Rule, type RuleMetadata } from "../src/rules/types.js";

function metadata(id = "core/example-rule"): RuleMetadata {
  return {
    id,
    name: "Example rule",
    description: "Checks an example condition.",
    category: FindingCategory.Correctness,
    defaultSeverity: RuleSeverity.Warning,
    recommended: true,
    requiresTypeInformation: false,
    requiresJSX: false,
    tags: [FindingTag.BestPractice],
    supportsAutoFix: false,
    supportsSuggestions: false,
    introducedVersion: "1.0.0",
    documentation: {
      url: "https://example.test/example-rule",
      goodExamples: ["const valid = true;"],
    },
  };
}

function rule(meta = metadata()): Rule {
  return { meta, analyze: () => [] };
}

describe("RuleDescriptor", () => {
  it("exposes metadata without loading the implementation", () => {
    const loader = vi.fn(() => rule());
    const descriptor = defineRuleDescriptor({
      metadata: metadata(),
      source: { kind: RuleSourceKind.BuiltIn },
      load: loader,
    });

    expect(descriptor.id).toBe("core/example-rule");
    expect(descriptor.namespace).toBe("core");
    expect(descriptor.localName).toBe("example-rule");
    expect(descriptor.metadata.name).toBe("Example rule");
    expect(loader).not.toHaveBeenCalled();
  });

  it("defensively copies and deeply freezes catalog data", () => {
    const sourceMetadata = metadata();
    const descriptor = defineRuleDescriptor({
      metadata: sourceMetadata,
      source: { kind: RuleSourceKind.BuiltIn },
      load: () => rule(),
    });

    (sourceMetadata.tags as FindingTag[]).push(FindingTag.Memory);
    expect(descriptor.metadata.tags).toEqual([FindingTag.BestPractice]);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.metadata.documentation?.goodExamples)).toBe(true);
  });

  it("supports scoped package namespaces", () => {
    expect(parseRuleId("@acme/mobile/no-legacy-image")).toEqual({
      namespace: "@acme/mobile",
      localName: "no-legacy-image",
    });
  });

  it("supports asynchronous implementation loading", async () => {
    const implementation = rule();
    const descriptor = defineRuleDescriptor({
      metadata: implementation.meta,
      source: { kind: RuleSourceKind.Package, name: "@acme/rules", version: "2.0.0" },
      load: async () => implementation,
    });

    await expect(loadRule(descriptor)).resolves.toBe(implementation);
  });

  it.each(["example", "/example", "core/Example", "core/example_rule", " core/example"])(
    "rejects malformed rule ID %s",
    (id) => {
      expect(() =>
        defineRuleDescriptor({
          metadata: metadata(id),
          source: { kind: RuleSourceKind.BuiltIn },
          load: () => rule(metadata(id)),
        }),
      ).toThrow(InvalidRuleDescriptorError);
    },
  );

  it("requires source identity for plugin and package descriptors", () => {
    expect(() =>
      defineRuleDescriptor({
        metadata: metadata(),
        source: { kind: RuleSourceKind.Plugin },
        load: () => rule(),
      }),
    ).toThrow("plugin descriptors require a source name");
  });

  it("detects an implementation that does not match its descriptor", async () => {
    const descriptor = defineRuleDescriptor({
      metadata: metadata(),
      source: { kind: RuleSourceKind.BuiltIn },
      load: () => rule(metadata("core/different-rule")),
    });

    await expect(loadRule(descriptor)).rejects.toThrow(
      'Loaded rule ID "core/different-rule" does not match descriptor ID "core/example-rule"',
    );
  });
});
