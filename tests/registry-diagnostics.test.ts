import { describe, expect, it } from "vitest";
import {
  createRegistryDiagnostic,
  createValidationResult,
  DuplicateRuleError,
  MetadataValidationError,
  NamespaceConflictError,
  RegistryDiagnosticCode,
  RegistryDiagnosticSeverity,
  RegistryIntegrityError,
  RuleRegistryError,
} from "../src/rules/registry-diagnostics.js";
import type { RuleId, RuleNamespace } from "../src/rules/descriptor.js";

describe("registry diagnostics", () => {
  it("creates immutable, serialization-safe diagnostics", () => {
    const inputDetails = { owner: "core", count: 2 };
    const diagnostic = createRegistryDiagnostic({
      code: RegistryDiagnosticCode.DuplicateId,
      severity: RegistryDiagnosticSeverity.Error,
      message: "The rule ID is already registered.",
      ruleId: "core/example",
      details: inputDetails,
    });

    inputDetails.owner = "plugin";
    expect(diagnostic.details?.owner).toBe("core");
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic.details)).toBe(true);
    expect(JSON.parse(JSON.stringify(diagnostic))).toEqual(diagnostic);
  });

  it("rejects diagnostics without a useful message", () => {
    expect(() =>
      createRegistryDiagnostic({
        code: RegistryDiagnosticCode.InvalidMetadata,
        severity: RegistryDiagnosticSeverity.Error,
        message: "  ",
      }),
    ).toThrow("Registry diagnostic message must not be empty");
  });

  it("marks aggregates invalid only when they contain errors", () => {
    const warning = createRegistryDiagnostic({
      code: RegistryDiagnosticCode.DeprecatedRule,
      severity: RegistryDiagnosticSeverity.Warning,
      message: "This rule is deprecated.",
    });
    const error = createRegistryDiagnostic({
      code: RegistryDiagnosticCode.VersionConflict,
      severity: RegistryDiagnosticSeverity.Error,
      message: "Versions conflict.",
    });

    expect(createValidationResult([warning]).valid).toBe(true);
    const invalid = createValidationResult([warning, error]);
    expect(invalid.valid).toBe(false);
    expect(Object.isFrozen(invalid.diagnostics)).toBe(true);
  });

  it("provides typed errors for strict registry operations", () => {
    const duplicate = new DuplicateRuleError("core/example" as RuleId);
    const namespace = new NamespaceConflictError("core" as RuleNamespace);

    expect(duplicate).toBeInstanceOf(RuleRegistryError);
    expect(duplicate.code).toBe(RegistryDiagnosticCode.DuplicateId);
    expect(duplicate.ruleId).toBe("core/example");
    expect(namespace.code).toBe(RegistryDiagnosticCode.NamespaceConflict);
  });

  it("freezes diagnostics carried by metadata validation errors", () => {
    const diagnostic = createRegistryDiagnostic({
      code: RegistryDiagnosticCode.InvalidMetadata,
      severity: RegistryDiagnosticSeverity.Error,
      message: "Description is missing.",
    });
    const error = new MetadataValidationError([diagnostic]);

    expect(Object.isFrozen(error.diagnostics)).toBe(true);
    expect(error.diagnostics).toEqual([diagnostic]);
  });

  it("preserves causes for unexpected integrity failures", () => {
    const cause = new Error("index mismatch");
    const error = new RegistryIntegrityError("Registry indexes are inconsistent", { cause });

    expect(error.cause).toBe(cause);
    expect(error.code).toBe(RegistryDiagnosticCode.ConfigurationConflict);
  });
});
