/**
 * Rule Descriptor
 *
 * A descriptor separates cheap, inspectable rule metadata from the code that
 * implements the rule. Registries, documentation generators, preset resolvers,
 * and IDEs can inspect thousands of rules without importing or constructing
 * their implementations. The loader is invoked only by a future loading or
 * execution boundary.
 *
 * IDs use `<namespace>/<local-name>`. Namespaces may contain `/`, allowing
 * scoped plugin identities such as `@acme/mobile/no-legacy-image`; the final
 * segment is always the local rule name.
 *
 * @module rules/descriptor
 */

import type { Rule, RuleMetadata, RuleOptions } from "./types.js";

/** Branded identities prevent accidentally exchanging namespaces and rule IDs. */
export type RuleId = string & { readonly __brand: "RuleId" };
export type RuleNamespace = string & { readonly __brand: "RuleNamespace" };
export type RuleLocalName = string & { readonly __brand: "RuleLocalName" };

/** Where a descriptor came from; useful for policy without loading rule code. */
export enum RuleSourceKind {
  BuiltIn = "built-in",
  Plugin = "plugin",
  Package = "package",
}

export interface RuleDescriptorSource {
  readonly kind: RuleSourceKind;
  /** Package or plugin identifier. Built-in descriptors may omit it. */
  readonly name?: string;
  /** Distribution version, distinct from the rule's introduced version. */
  readonly version?: string;
}

/** A deferred implementation provider. Both local factories and dynamic imports fit this shape. */
export type RuleLoader<Options extends RuleOptions = RuleOptions> = () =>
  Rule<Options> | Promise<Rule<Options>>;

/** Immutable catalog entry inspected without invoking its loader. */
export interface RuleDescriptor<Options extends RuleOptions = RuleOptions> {
  readonly id: RuleId;
  readonly namespace: RuleNamespace;
  readonly localName: RuleLocalName;
  readonly metadata: RuleMetadata;
  readonly source: RuleDescriptorSource;
  readonly load: RuleLoader<Options>;
}

export interface RuleDescriptorInput<Options extends RuleOptions = RuleOptions> {
  readonly metadata: RuleMetadata;
  readonly source: RuleDescriptorSource;
  readonly load: RuleLoader<Options>;
}

/** Descriptor construction failures are distinct from registry policy failures. */
export class InvalidRuleDescriptorError extends Error {
  readonly name = "InvalidRuleDescriptorError";
}

/**
 * Validate identity, defensively copy metadata, and freeze a descriptor.
 * Importantly, this function never invokes `load`.
 */
export function defineRuleDescriptor<Options extends RuleOptions>(
  input: RuleDescriptorInput<Options>,
): RuleDescriptor<Options> {
  const identity = parseRuleId(input.metadata.id);
  validateSource(input.source);

  const descriptor: RuleDescriptor<Options> = {
    id: input.metadata.id as RuleId,
    namespace: identity.namespace,
    localName: identity.localName,
    metadata: cloneMetadata(input.metadata),
    source: { ...input.source },
    load: input.load,
  };

  deepFreezeData(descriptor.metadata);
  Object.freeze(descriptor.source);
  return Object.freeze(descriptor);
}

/**
 * Resolve a descriptor and verify that deferred code still matches the
 * cataloged identity. A future RuleLoader can cache the successful result.
 */
export async function loadRule<Options extends RuleOptions>(
  descriptor: RuleDescriptor<Options>,
): Promise<Rule<Options>> {
  const rule = await descriptor.load();
  if (rule.meta.id !== descriptor.id) {
    throw new InvalidRuleDescriptorError(
      `Loaded rule ID "${rule.meta.id}" does not match descriptor ID "${descriptor.id}"`,
    );
  }
  return rule;
}

/** Parse a namespaced ID without applying registry-specific namespace policy. */
export function parseRuleId(id: string): {
  readonly namespace: RuleNamespace;
  readonly localName: RuleLocalName;
} {
  if (id !== id.trim() || id.length === 0) {
    throw new InvalidRuleDescriptorError(
      "Rule ID must be non-empty and contain no outer whitespace",
    );
  }

  const separator = id.lastIndexOf("/");
  if (separator <= 0 || separator === id.length - 1) {
    throw new InvalidRuleDescriptorError(
      `Rule ID "${id}" must use the form <namespace>/<local-name> with kebab-case segments`,
    );
  }
  const namespace = id.slice(0, separator);
  const localName = id.slice(separator + 1);
  if (!isValidNamespace(namespace) || !isValidSegment(localName)) {
    throw new InvalidRuleDescriptorError(
      `Rule ID "${id}" must use the form <namespace>/<local-name> with kebab-case segments`,
    );
  }

  return {
    namespace: namespace as RuleNamespace,
    localName: localName as RuleLocalName,
  };
}

function isValidNamespace(namespace: string): boolean {
  const segments = namespace.split("/");
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) return false;
  return segments.every((segment, index) => {
    if (index === 0 && segment.startsWith("@")) return isValidSegment(segment.slice(1));
    return isValidSegment(segment);
  });
}

function isValidSegment(segment: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment);
}

function validateSource(source: RuleDescriptorSource): void {
  if (source.kind !== RuleSourceKind.BuiltIn && !source.name?.trim()) {
    throw new InvalidRuleDescriptorError(`${source.kind} descriptors require a source name`);
  }
}

function cloneMetadata(metadata: RuleMetadata): RuleMetadata {
  return {
    ...metadata,
    tags: [...metadata.tags],
    deprecated: metadata.deprecated ? { ...metadata.deprecated } : undefined,
    documentation: metadata.documentation
      ? {
          ...metadata.documentation,
          goodExamples: metadata.documentation.goodExamples
            ? [...metadata.documentation.goodExamples]
            : undefined,
          badExamples: metadata.documentation.badExamples
            ? [...metadata.documentation.badExamples]
            : undefined,
        }
      : undefined,
  };
}

function deepFreezeData(value: object): void {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object" && !Object.isFrozen(child)) {
      deepFreezeData(child);
      Object.freeze(child);
    }
  }
  Object.freeze(value);
}
