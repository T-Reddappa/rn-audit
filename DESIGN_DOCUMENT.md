# rn-audit — Engineering Design Document

**Status:** Draft v1.0 — Pre-Implementation Design Review
**Author:** Technical Lead / Staff Architect
**Date:** 2026-07-08
**Target Audience:** Engineering team, open-source contributors, design reviewers
**Classification:** Public (open-source project)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision](#2-product-vision)
3. [Problem Statement](#3-problem-statement)
4. [Target Audience](#4-target-audience)
5. [Competitive Analysis](#5-competitive-analysis)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Complete CLI Specification](#8-complete-cli-specification)
9. [User Experience Flow](#9-user-experience-flow)
10. [High-Level System Architecture](#10-high-level-system-architecture)
11. [Module Responsibilities](#11-module-responsibilities)
12. [Data Flow](#12-data-flow)
13. [Rule Engine Design](#13-rule-engine-design)
14. [Configuration System](#14-configuration-system)
15. [Reporting System](#15-reporting-system)
16. [Plugin Architecture](#16-plugin-architecture)
17. [Performance Considerations](#17-performance-considerations)
18. [Testing Strategy](#18-testing-strategy)
19. [Repository Structure](#19-repository-structure)
20. [Directory Structure](#20-directory-structure)
21. [Development Milestones](#21-development-milestones)
22. [Risks and Trade-offs](#22-risks-and-trade-offs)
23. [Future Roadmap](#23-future-roadmap)
24. [Architectural Decision Records](#24-architectural-decision-records-adr)
25. [Open Source Strategy](#25-open-source-strategy)
26. [Documentation Plan](#26-documentation-plan)

---

## 1. Executive Summary

**rn-audit** is a production-grade, open-source CLI tool that performs static code analysis on React Native and Expo projects to surface actionable performance, maintainability, accessibility, and architecture recommendations.

It is designed to become **the standard static analysis tool for React Native** — what ESLint is for JavaScript, what Biome is for formatting, what Rust's `cargo check` is for Rust projects. A developer should run `npx rn-audit` before shipping, just as they run `npx eslint .` before committing.

Phase 1 is **static analysis only** — no runtime profiling, no AI, no auto-fixes. The tool reads source files, parses ASTs, applies rules, and reports findings. This constraint is intentional: it keeps the initial scope achievable, the architecture clean, and the value proposition clear.

The architecture is designed from day one to support:
- A plugin system modeled after ESLint's (third-party rules, shareable configs, presets)
- Multiple output formats (terminal, JSON, HTML, SARIF, Markdown, GitHub Actions annotations)
- Future phases: runtime profiling, Babel plugin injection, VS Code extension, AI-powered recommendations, CI/CD quality gates
- Thousands of users, hundreds of contributors, years of evolution

---

## 2. Product Vision

### 2.1 The North Star

A developer opens any React Native or Expo project and runs:

```
npx rn-audit
```

Within seconds, they receive a scored, categorized report telling them exactly what to fix, why it matters, and how long it will take. No configuration required. No runtime needed. No app to launch.

The tool becomes:
- The **first command** run in a new React Native project to assess its health
- The **CI gate** that blocks regressions before they reach production
- The **onboarding companion** that teaches React Native best practices through actionable feedback
- The **shared language** between developers, teams, and organizations discussing React Native quality

### 2.2 Design Philosophy

**Zero-config by default, infinitely configurable when needed.**
The tool must work immediately with sensible defaults. Every knob must be discoverable and well-documented. Configuration must never be required to get value.

**Static analysis first.**
Runtime profiling is powerful but fragile (requires the app to build and run, depends on device state, varies between runs). Static analysis is deterministic, reproducible, and fast. Phase 1 proves the value with static analysis alone.

**Actionable over comprehensive.**
A finding that says "your app might be slow" is useless. Every finding must include: what the problem is, where it is, why it matters, how to fix it, and how long it will take. A developer should be able to act on every finding without leaving their editor.

**Open-source from commit zero.**
The tool is developed in the open. Architecture decisions are documented. Contribution paths are clear. The community owns the tool.

---

## 3. Problem Statement

### 3.1 The React Native Performance Gap

React Native applications are notoriously difficult to performance-optimize. Developers routinely ship applications with:

- **Inline styles** that create new objects on every render, defeating React's reconciliation optimizations
- **Inline callbacks** (`onPress={() => ...}`) that cause unnecessary re-renders of child components
- **Missing `keyExtractor`** on FlatLists that degrade scroll performance and cause rendering artifacts
- **ScrollView with `.map()`** where FlatList (with virtualization) should be used, causing all items to render simultaneously
- **Images without explicit `width` and `height`** that cause layout shifts and re-layout cycles
- **Missing `accessibilityLabel`** that make the app unusable for screen reader users
- **Nested ScrollViews** (ScrollView inside ScrollView) that create conflicting gesture handling and undefined scroll behavior
- **Unused dependencies** that bloat bundle size and increase cold-start time
- **Oversized image assets** that waste memory and slow image decoding
- **Synchronous heavy work during render** that blocks the JS thread and drops frames

### 3.2 Why Existing Tools Don't Solve This

- **ESLint** with `eslint-plugin-react` and `eslint-plugin-react-native` catches some issues, but these plugins are not specialized for React Native performance. They are general-purpose, maintained by different teams, and don't understand React Native-specific patterns like FlatList, ScrollView virtualization, or the JS-bridge architecture.
- **TypeScript** catches type errors but has no concept of React Native performance patterns. It cannot tell you that a ScrollView with 500 children will be slow.
- **Metro** bundles code but doesn't audit it. Its focus is on the bundle pipeline, not source quality.
- **React DevTools** and **Flipper** profile runtime behavior but require the app to be running — they are investigative tools, not preventative ones.
- **SonarQube**, **DeepSource**, and **CodeRabbit** are general-purpose or SaaS products that lack React Native domain expertise.
- **why-did-you-render** tracks re-renders at runtime but cannot predict them from static code.

### 3.3 The Specific Need

There is no tool that says: "I understand React Native. I know its performance footguns. I will check your code for all of them, right now, without launching your app. Here's what to fix."

rn-audit fills this gap.

---

## 4. Target Audience

### 4.1 Primary: Individual React Native Developers

- Working on side projects or small team apps
- Want quick, zero-config feedback on code quality
- May not be React Native performance experts
- Expect the tool to teach them best practices

### 4.2 Primary: React Native Teams

- Shipping production apps to the App Store and Google Play
- Want to prevent performance regressions
- Need CI integration and quality gates
- Want standardized quality metrics across the codebase

### 4.3 Secondary: Agency and Consultancy Teams

- Deliver React Native apps to clients
- Need to demonstrate quality and adherence to best practices
- Want exportable reports (HTML, JSON) to share with stakeholders

### 4.4 Secondary: Open-Source Library Authors

- Maintain React Native libraries
- Want to ensure their library follows best practices
- May want to ship custom rules for their library's API (e.g., `react-navigation` could provide navigation-specific rules)

### 4.5 Tertiary: Platform Teams at Large Organizations

- Manage many React Native projects across teams
- Want organization-wide quality standards
- Need shareable configs and presets
- Want aggregated reporting across projects

---

## 5. Competitive Analysis

### 5.1 Comparison Matrix

| Tool | Type | React Native Aware | Performance Focus | Static Analysis | Open Source | Zero Config | Plugin System |
|------|------|-------------------|-------------------|-----------------|-------------|-------------|---------------|
| **rn-audit** | Static analysis + future runtime | ✅ Deep | ✅ Primary | ✅ Phase 1 | ✅ | ✅ | ✅ Planned |
| ESLint + plugins | Static analysis | ⚠️ Shallow | ❌ | ✅ | ✅ | ❌ | ✅ |
| Biome | Static analysis | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| TypeScript | Type checking | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Metro | Bundler | ✅ | ⚠️ Indirect | ❌ | ✅ | ✅ | ✅ |
| React DevTools | Runtime profiler | ✅ | ✅ | ❌ | ✅ | N/A | ❌ |
| Flipper | Debugger | ✅ | ✅ | ❌ | ✅ | N/A | ✅ |
| SonarQube | Code quality | ⚠️ General web | ⚠️ | ✅ | ⚠️ CE | ❌ | ⚠️ |
| DeepSource | SaaS code review | ⚠️ | ⚠️ | ✅ | ❌ | ❌ | ❌ |
| why-did-you-render | Runtime monitor | ✅ | ✅ | ❌ | ✅ | ❌ | N/A |

### 5.2 Detailed Analysis

#### ESLint + eslint-plugin-react + eslint-plugin-react-native

**What it does well:**
- Mature ecosystem, widely adopted, large community
- Excellent plugin architecture (the gold standard)
- Shareable configs, presets, and formatters
- Rule documentation, auto-fix infrastructure, CI integration

**Where it falls short for React Native:**
- `eslint-plugin-react-native` has only 4 rules (no-inline-styles, no-unused-styles, no-color-literals, split-platform-components) — far too few for comprehensive auditing
- No understanding of FlatList vs ScrollView tradeoffs
- No accessibility-specific rules
- No dependency/bundle-size analysis
- No asset analysis
- No Expo-specific rules
- No performance scoring or category grouping
- Rules are style-oriented, not performance-oriented
- No understanding of the React Native bridge, Hermes, or the New Architecture

**Why not build this as an ESLint plugin?**
ESLint operates on a per-file basis without module-level context. Many React Native performance issues are cross-cutting: a component defined in one file being used without memoization in another, a heavy dependency imported but never tree-shaken, image assets that are larger than needed. ESLint's architecture fundamentally limits what can be analyzed. Furthermore, building as a standalone tool allows us to control the entire experience: scoring, categorization, report formatting, and future runtime profiling — without fighting ESLint's abstraction boundaries.

#### TypeScript Compiler

**What it does well:**
- Gold standard for type checking
- Rich type system enables sophisticated static analysis
- Exact type information (not approximations)

**Where it falls short:**
- No domain knowledge of React or React Native
- No concept of performance patterns
- No linting infrastructure (rules, severity, categories, reporting)
- Not designed for extensibility in the way a linter needs

**Relationship to rn-audit:**
rn-audit should leverage the TypeScript Compiler API as its primary parser (see ADR-002), gaining access to type information for rules that need it. This is a key architectural advantage over ESLint, which primarily works with untyped ASTs.

#### Biome

**What it does well:**
- Extremely fast (Rust-based)
- Good developer experience
- Growing ecosystem

**Where it falls short:**
- No React Native domain knowledge
- Plugin system is immature (by design — Biome prioritizes built-in rules)
- No extensibility model comparable to ESLint's

**Relationship to rn-audit:**
Biome and rn-audit are complementary. A developer might use Biome for formatting and general JS linting, and rn-audit for React Native-specific performance auditing. In the long term, rn-audit could potentially use Biome's parser for additional speed, but this is not a Phase 1 concern.

#### Metro (React Native Bundler)

**What it does well:**
- Understands the entire module graph
- Can report bundle sizes per module
- Has access to the final bundle output

**Where it falls short:**
- Not a static analysis tool — operates on the bundle pipeline
- No rules engine, no findings model, no reporting infrastructure
- Cannot provide source-level recommendations
- Requires the project to build

**Relationship to rn-audit:**
Metro and rn-audit are complementary. In Phase 3+, rn-audit could integrate Metro data (bundle size per module, tree-shaking analysis) into its findings. rn-audit's architecture should be designed so that adding a "Metro data source" is possible without core changes.

### 5.3 rn-audit's Unique Position

rn-audit is the **intersection** of three things that don't exist together today:

1. **React Native domain expertise** — understands FlatList, ScrollView, the bridge, Hermes, Image, Animated, the New Architecture, Expo
2. **Static analysis infrastructure** — file scanning, AST parsing, rule engine, findings model, reporting, scoring
3. **Developer tool quality** — zero-config, fast, beautiful terminal output, CI-ready, extensively documented

No existing tool has all three. This is rn-audit's moat.

---

## 6. Functional Requirements

### 6.1 Phase 1 — What It MUST Do

#### FR-1: Project Detection
- FR-1.1: Detect whether the current directory is a React Native or Expo project by checking for `react-native` or `expo` in `package.json` dependencies.
- FR-1.2: If not a React Native project, exit with a clear error message suggesting the user navigate to a React Native project root.
- FR-1.3: Detect the project type (bare React Native, Expo managed, Expo bare) and tailor analysis accordingly.
- FR-1.4: Detect whether TypeScript or JavaScript is the primary language.

#### FR-2: File Discovery
- FR-2.1: Discover all relevant source files (`.ts`, `.tsx`, `.js`, `.jsx`) in the project.
- FR-2.2: Respect `.gitignore` patterns by default.
- FR-2.3: Respect a configurable ignore list (glob patterns).
- FR-2.4: Exclude `node_modules`, build artifacts, and generated code by default.
- FR-2.5: Support configurable include and exclude patterns.

#### FR-3: Source Parsing
- FR-3.1: Parse TypeScript (`.ts`, `.tsx`) files into ASTs using the TypeScript Compiler API.
- FR-3.2: Parse JavaScript (`.js`, `.jsx`) files into ASTs using a Babel-based fallback parser.
- FR-3.3: Parse JSON files (`package.json`, `app.json`, `tsconfig.json`) for configuration and dependency analysis.
- FR-3.4: Handle parse errors gracefully — report the error file and continue analyzing other files.
- FR-3.5: Support JSX and TSX syntax in parsed files.

#### FR-4: Rule Engine
- FR-4.1: Execute a set of built-in rules against every parsed file.
- FR-4.2: Rules operate on typed ASTs (TypeScript Compiler API ASTs, not ESTree).
- FR-4.3: Each rule is an independent, stateless module.
- FR-4.4: Rules declare their metadata: name, description, severity, category, applicable file types, and any configurable options.
- FR-4.5: Rules can report zero or more findings per file.
- FR-4.6: Rules can access type information when available.
- FR-4.7: Disabled rules (via configuration) are skipped entirely — no parsing or traversal cost is incurred for them.

#### FR-5: Findings Model
- FR-5.1: Every issue discovered by a rule is represented as a Finding with a standardized structure.
- FR-5.2: Each finding includes: unique ID, rule ID, title, description, severity, category, file path, line number, column number, end line, end column, source code snippet, recommendation text, documentation URL, estimated performance impact, estimated fix time, and tags.
- FR-5.3: Findings are collected, deduplicated, and sorted before reporting.

#### FR-6: Reporting
- FR-6.1: Default output is a colorized terminal report.
- FR-6.2: Terminal report shows: summary line (total files, total findings, score), findings grouped by category, each finding with code frame, severity icon, and recommendation.
- FR-6.3: Support `--json` for machine-readable output.
- FR-6.4: Support `--format` flag to select output formatter (default: `stylish`, also: `json`).
- FR-6.5: Exit code 0 when no errors (warnings and info are OK), exit code 1 when errors found.
- FR-6.6: Support `--max-warnings` flag to set a warning threshold (exit code 1 if exceeded).
- FR-6.7: Support `--quiet` flag to suppress non-error findings in terminal output.

#### FR-7: Configuration
- FR-7.1: Work with zero configuration — sensible defaults for everything.
- FR-7.2: Support `.rnauditrc.json` configuration file.
- FR-7.3: Support `rnaudit` key in `package.json`.
- FR-7.4: CLI flags override configuration file values.
- FR-7.5: Configuration supports: `include` patterns, `exclude` patterns, `rules` (enable/disable/configure), `severity` overrides, `categories` to focus on.
- FR-7.6: `rn-audit init` generates a configuration file with documentation comments.

#### FR-8: CLI
- FR-8.1: `rn-audit` (no arguments) runs a full scan and displays the terminal report.
- FR-8.2: `rn-audit scan` explicitly runs a scan (alias for default behavior).
- FR-8.3: `rn-audit report` re-displays the last report (from cache).
- FR-8.4: `rn-audit report --json` outputs the last report as JSON.
- FR-8.5: `rn-audit rules` lists all available rules with their metadata.
- FR-8.6: `rn-audit explain <rule-id>` shows detailed documentation for a specific rule.
- FR-8.7: `rn-audit init` generates a `.rnauditrc.json` file with defaults and documentation.
- FR-8.8: `rn-audit version` prints the version.
- FR-8.9: `rn-audit --help` and `rn-audit <command> --help` show usage.
- FR-8.10: All CLI output goes to stdout; errors and progress go to stderr.

#### FR-9: Caching
- FR-9.1: Cache parse results and rule findings per file, keyed by file content hash.
- FR-9.2: On subsequent runs, skip re-analysis of files whose content hasn't changed.
- FR-9.3: Cache is stored in `node_modules/.cache/rn-audit/`.
- FR-9.4: `--no-cache` flag disables caching.
- FR-9.5: `--clear-cache` flag deletes the cache before running.

#### FR-10: Initial Rule Set
The initial release must ship with at least these built-in rules:

| Rule ID | Category | Severity | Description |
|---------|----------|----------|-------------|
| `no-inline-styles` | styles | warning | Objects passed to `style` prop should use `StyleSheet.create()` |
| `no-inline-callbacks` | react | warning | Callbacks in JSX props should be stabilized with `useCallback` or defined outside render |
| `no-inline-objects` | react | warning | Objects/arrays in JSX props create new references each render |
| `require-flatlist-key-extractor` | react-native | error | `FlatList` without `keyExtractor` degrades scroll performance |
| `require-image-dimensions` | react-native | warning | `<Image>` without explicit `width`/`height` causes layout shifts |
| `require-accessibility-label` | accessibility | warning | Interactive elements without `accessibilityLabel` are invisible to screen readers |
| `no-nested-scrollviews` | react-native | error | Nested `ScrollView` components create conflicting scroll behavior |
| `no-duplicate-styles` | styles | info | Identical style objects across files should be extracted |
| `no-direct-mutation` | react | error | Direct state mutation (`.push()`, `.sort()` on state) instead of immutable update |
| `prefer-flatlist-over-scrollview` | react-native | warning | `ScrollView` with dynamic children should be `FlatList` |
| `no-sync-storage` | react-native | warning | `AsyncStorage.getItem()` without `await` blocks the JS thread |
| `no-console-log` | code-quality | info | `console.log` statements should not ship to production |

### 6.2 Phase 1 — What It MUST NOT Do

- ❌ Execute or launch the React Native application
- ❌ Run Metro bundler
- ❌ Launch Expo
- ❌ Inject Babel plugins
- ❌ Profile runtime performance (FPS, memory, bridge traffic)
- ❌ Use AI or LLMs for analysis or recommendations
- ❌ Modify source code (no auto-fix)
- ❌ Require the application to build successfully
- ❌ Connect to any external service or API
- ❌ Require authentication or accounts
- ❌ Collect telemetry without explicit opt-in
- ❌ Write to any file outside `node_modules/.cache/rn-audit/`

### 6.3 Phase 1 — What It MAY Do (Optional but Valuable)

- Read `tsconfig.json` to determine compiler options for parsing
- Read `babel.config.js` to understand custom syntax plugins
- Read `.eslintrc` to inherit ignore patterns
- Use worker threads for parallel file processing (if performance requires it)
- Show progress indicator during long scans (`--verbose`)

---

## 7. Non-Functional Requirements

### 7.1 Performance

| Requirement | Target | Measurement |
|-------------|--------|-------------|
| Cold scan (no cache, 500 files) | < 30 seconds | Wall-clock time on typical developer laptop |
| Warm scan (full cache, no changes) | < 2 seconds | Wall-clock time |
| Incremental scan (1 file changed) | < 500ms per file | Wall-clock time |
| Memory usage (500 files) | < 512 MB | RSS as reported by OS |
| Startup time (CLI to first output) | < 1 second | Wall-clock time |

**Rationale:** Developers run linters frequently. If the tool takes more than 30 seconds on a cold run, developers will stop using it. The warm-scan target (< 2 seconds) is critical for pre-commit hook and save-on-type editor integration scenarios.

### 7.2 Scalability

- The architecture must support projects with 10,000+ source files without architectural changes.
- File discovery must use streaming/lazy patterns, not load all file paths into memory at once.
- AST parsing must use a bounded thread pool (CPU count - 1) to avoid oversubscription.
- The findings array must be the only in-memory collection that grows with project size. Everything else should be streamed or bounded.
- Cache keys must be stable and independent of absolute file paths (for CI, where checkout paths vary).

### 7.3 Extensibility

- Adding a new rule must require creating a single new file in the rules directory and registering it. No other source changes.
- Adding a new reporter formatter must require creating a single new file in the formatters directory.
- Adding a new configuration file format (e.g., YAML, TOML) must be possible without changing the config resolution logic.
- The plugin system (Phase 2) must be designed into the architecture from day one, even if not implemented in Phase 1.
- The rule engine must not import individual rule modules. It must discover rules through a registry pattern.

### 7.4 Reliability

- A single file with a parse error must not crash the entire scan.
- A single rule throwing an exception must not crash the entire scan.
- Out-of-memory must be handled gracefully — the tool should exit with a clear error, not crash.
- The tool must be deterministic: running twice with the same code and same config must produce identical findings.
- Cache corruption must be detected and the cache invalidated automatically.

### 7.5 Compatibility

- Must run on Node.js 18, 20, 22 (the LTS versions at time of Phase 1 release).
- Must work on macOS, Linux, and Windows.
- Must work with React Native 0.71+ (the range supported at Phase 1 release).
- Must work with Expo SDK 49+.
- Must work with both TypeScript and JavaScript projects.
- Must work with both the Old Architecture and the New Architecture.

### 7.6 Open-Source Quality

- 100% TypeScript with `strict: true`.
- Public API documented with TSDoc/JSDoc comments.
- Test coverage > 90% for core engine modules, > 80% overall.
- CI runs on every push and PR: lint, typecheck, test (matrix of Node versions and OS), build.
- Semantic versioning (semver) strictly followed.
- Conventional Commits for machine-readable changelog generation.
- Contributing guide, code of conduct, security policy, issue templates, PR template — all in place before going public.
- Apache 2.0 license (permissive, enterprise-friendly, compatible with React Native's license).


---

## 8. Complete CLI Specification

### 8.1 Command Inventory

This section specifies every command planned for the tool's lifetime, organized by phase. The CLI is designed as a single binary with subcommands, following the conventions established by `git`, `npm`, `cargo`, `eslint`, and `biome`.

#### Phase 1 Commands

| Command | Aliases | Purpose | Exit Codes |
|---------|---------|---------|------------|
| `rn-audit` | — | Default: run a full scan and display terminal report | 0 = no errors; 1 = errors found; 2 = runtime error |
| `rn-audit scan` | — | Explicitly run a scan (same as default, but enables scan-specific flags) | Same as above |
| `rn-audit report` | — | Re-display the most recent report from cache | 0 = success; 1 = no cached report; 2 = runtime error |
| `rn-audit rules` | `rn-audit rule list` | List all available rules with name, category, severity, and enabled status | 0 |
| `rn-audit explain <rule>` | `rn-audit rule explain <rule>` | Display detailed documentation for a specific rule including: description, rationale, examples (good/bad), configuration options, references | 0 = found; 1 = rule not found |
| `rn-audit init` | — | Generate `.rnauditrc.json` with all available rules and their default settings, commented with descriptions | 0 |
| `rn-audit version` | `rn-audit --version`, `rn-audit -v` | Print version string | 0 |
| `rn-audit --help` | `rn-audit -h`, `rn-audit help` | Print top-level help or command-specific help | 0 |

#### Phase 2 Commands (Planned)

| Command | Purpose |
|---------|---------|
| `rn-audit config` | Display the resolved (merged) configuration — what config file was used, what rules are enabled, what overrides are active |
| `rn-audit doctor` | Verify the tool is correctly installed and configured. Checks: Node version, project type detection, config validity, cache health, rule loading |
| `rn-audit --fix` | Apply auto-fixes for rules that support them. Requires each rule to implement a fix() method |
| `rn-audit --ci` | CI mode: exit code 1 on any finding (not just errors), SARIF output by default, no progress indicators, no color |

#### Phase 3+ Commands (Planned)

| Command | Purpose |
|---------|---------|
| `rn-audit watch` | Watch mode: re-scan on file changes. Used with `--watch` flag on `scan` |
| `rn-audit profile` | Runtime profiling mode: launch the app, collect runtime metrics (FPS, bridge traffic, memory), combine with static findings |
| `rn-audit baseline` | Generate a baseline file of known findings to ignore. Subsequent runs only report new findings |
| `rn-audit diff` | Compare findings between two branches/commits |
| `rn-audit plugin add <name>` | Install a third-party plugin |
| `rn-audit plugin remove <name>` | Remove a third-party plugin |
| `rn-audit plugin list` | List installed third-party plugins |

### 8.2 Global Flags

Flags that apply to all commands:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--config <path>` | string | auto | Path to config file. If not provided, auto-discovery is used |
| `--no-color` | boolean | false | Disable ANSI color output |
| `--color` | boolean | true | Force ANSI color output (even when piped) |
| `--verbose` | boolean | false | Enable verbose logging (progress, timing, cache hits/misses) |
| `--quiet` | boolean | false | Suppress all output except errors |
| `--silent` | boolean | false | Suppress all output; exit code only |
| `--debug` | boolean | false | Enable debug output (internal state, stack traces on errors) |

### 8.3 Scan-Specific Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format <name>` | string | `stylish` | Output format: `stylish`, `json`, `html`, `sarif`, `markdown`, `github-actions` |
| `--output <path>` | string | stdout | Write report to file instead of stdout |
| `--max-warnings <n>` | number | -1 | Exit code 1 if warning count exceeds this threshold (-1 = no limit) |
| `--no-cache` | boolean | false | Disable file cache |
| `--clear-cache` | boolean | false | Delete cache before scanning |
| `--cache-location <path>` | string | `node_modules/.cache/rn-audit` | Custom cache directory |
| `--include <patterns>` | string[] | auto | Glob patterns of files to include |
| `--exclude <patterns>` | string[] | auto | Glob patterns of files to exclude |
| `--rules <ids>` | string[] | all | Only run these specific rules |
| `--skip <ids>` | string[] | none | Skip these specific rules |
| `--category <cats>` | string[] | all | Only run rules in these categories |
| `--severity <level>` | string | `error` | Minimum severity to report (`error`, `warning`, `info`) |
| `--no-ignore` | boolean | false | Don't use ignore patterns (`.gitignore`, config excludes) |
| `--stats` | boolean | false | Print timing and count statistics after the report |

### 8.4 Design Rationale for Each Command

**Why `rn-audit` (no args) runs a scan instead of printing help?**
Follows the convention of `eslint`, `tsc`, and `cargo check`. The primary action should be the default. Developers type `rn-audit` expecting to audit their project, not to see a help menu.

**Why both `rn-audit scan` and `rn-audit` (no args)?**
The no-args form is the 90% use case. The explicit `scan` form enables scan-specific flags that would be ambiguous at the top level. It also provides a natural place for `--fix`, `--ci`, and `--watch` in future phases — these modify the scan behavior, so they belong on the scan subcommand.

**Why `rn-audit report` as a separate command?**
After a scan completes, the findings are cached. A developer might want to view the report again without re-scanning. `rn-audit report` reads the cached findings and formats them. `rn-audit report --json > report.json` exports machine-readable data without re-running analysis.

**Why `rn-audit explain <rule>` instead of just documentation URLs?**
Following ESLint's model: when a developer sees `no-inline-styles` in a report, they need to understand what it means. A documentation URL requires leaving the terminal. `rn-audit explain no-inline-styles` prints the full rule documentation in the terminal — rationale, examples, configuration, and references. This keeps developers in flow.

**Why `rn-audit init`?**
Zero-config is great for the first run. After that, teams need to customize. `rn-audit init` generates a configuration file with every rule listed, its default settings, and a documentation comment. This serves as both scaffolding and documentation — the user reads the generated file and uncomments/modifies what they need.

**Why `rn-audit config` in Phase 2 instead of Phase 1?**
Phase 1 configuration is simple: one config file, flat structure. The `config` command is most valuable when there's cascading configuration (multiple config files in nested directories), plugins, and presets — at which point "what is my effective config?" becomes a non-trivial question. That complexity arrives in Phase 2.

**Why `rn-audit doctor` in Phase 2?**
In Phase 1, the tool is simple enough that errors are self-explanatory. As plugins, shareable configs, presets, and version compatibility enter the picture, the tool's environment becomes complex enough to warrant a self-diagnostic.

### 8.5 Exit Code Specification

| Code | Meaning | When |
|------|---------|------|
| 0 | Success | No errors found (warnings and info are OK, subject to `--max-warnings`) |
| 1 | Findings threshold exceeded | One or more error-level findings found, or `--max-warnings` threshold exceeded |
| 2 | Runtime error | Unhandled exception, config parse error, or internal failure. Details on stderr |

This aligns with ESLint's exit code convention, which is the de facto standard for linting tools in the JavaScript ecosystem.

---

## 9. User Experience Flow

### 9.1 First-Time User — Zero Config

```bash
$ cd my-react-native-app
$ npx rn-audit

✔ Project detected: React Native 0.76 (New Architecture enabled)
✔ Configuration: Using defaults (no config file found)
  Run `rn-audit init` to generate a config file
✔ Scanning 247 files...

  [■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■] 100%

✖ 3 errors · ⚠ 12 warnings · ℹ 8 info

┌─────────────────────────────────────────────────────────────┐
│                     PERFORMANCE SCORE: 72/100               │
│                                                             │
│  ████████████████████████████████████████░░░░░░░░░░░░░░░░  │
└─────────────────────────────────────────────────────────────┘

REACT NATIVE (2 errors, 4 warnings)
────────────────────────────────────

  error  FlatList is missing keyExtractor prop
  rn-audit/require-flatlist-key-extractor
  
  src/screens/ProductList.tsx:42:5
  
    40 |   return (
    41 |     <View style={styles.container}>
  > 42 |       <FlatList
       |       ^^^^^^^^
    43 |         data={products}
    44 |         renderItem={renderProduct}
    45 |       />
  
  ⚡ High performance impact   🕐 Quick fix (30s)
  
  Recommendation: Add keyExtractor={(item) => item.id} to this FlatList.
  Without keyExtractor, React Native cannot efficiently track list items,
  causing unnecessary re-renders and degraded scroll performance.
  
  Docs: https://github.com/user/rn-audit/blob/main/docs/rules/require-flatlist-key-extractor.md


  warning  Image is missing explicit width/height
  rn-audit/require-image-dimensions
  
  src/components/ProductCard.tsx:18:7
  
    16 |     <View style={styles.card}>
    17 |       <Text style={styles.title}>{product.name}</Text>
  > 18 |       <Image source={{ uri: product.image }} />
       |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    19 |       <Text style={styles.price}>{product.price}</Text>
    20 |     </View>
  
  ⚡ Medium performance impact   🕐 Quick fix (30s)
  
  Recommendation: Add width and height to this Image component, or use
  the `style` prop with explicit dimensions. Images without dimensions
  cause layout shifts when loading completes.
  
  Docs: https://github.com/user/rn-audit/blob/main/docs/rules/require-image-dimensions.md


STYLES (1 error, 6 warnings)
────────────────────────────────────
  ...

ACCESSIBILITY (0 errors, 2 warnings)
────────────────────────────────────
  ...

──
3 errors · 12 warnings · 8 info
Run `rn-audit explain <rule-id>` for more information about a rule.
Run `rn-audit report --json` for machine-readable output.
```

### 9.2 User With Configuration

```bash
$ cat .rnauditrc.json
{
  "rules": {
    "no-console-log": "off",
    "require-accessibility-label": "error"
  },
  "exclude": ["**/__tests__/**", "**/*.test.*", "**/*.spec.*", "e2e/**"],
  "categories": {
    "code-quality": "warn"
  }
}

$ npx rn-audit

✔ Configuration: .rnauditrc.json
✔ Scanning 312 files...
  ...
```

### 9.3 CI Integration

```bash
$ npx rn-audit scan --format sarif --output rn-audit-results.sarif --max-warnings 0 --no-color
```

```
# stdout is empty (SARIF written to file)
# stderr (if --verbose):
✔ Scanning 312 files...
✖ Audit failed: 3 errors, 12 warnings
  Exit code: 1 (max-warnings exceeded)
```

### 9.4 Error States

**Not a React Native project:**
```bash
$ cd some-random-folder
$ npx rn-audit

✖ Error: This does not appear to be a React Native or Expo project.

  Could not find 'react-native' or 'expo' in package.json dependencies.
  
  If you believe this is an error, run:
    rn-audit --config ./path/to/config
```

**Parse error in a file:**
```bash
$ npx rn-audit
✔ Scanning 247 files...

⚠ Warning: Parse error in src/BrokenFile.tsx:15:3
  Unexpected token. This file will be skipped.
  Run with --debug for stack trace.

✔ Scan completed (1 file skipped due to parse errors)
✖ 3 errors · ⚠ 12 warnings · ℹ 8 info
```

**Configuration file has a schema error:**
```bash
$ npx rn-audit

✖ Error: Invalid configuration in .rnauditrc.json

  /rules/require-flatlist-key-extractor: Expected one of "off", "warn", "error",
  "info" but received "critical".

  Valid values: "off", "info", "warn", "error"
```

---

## 10. High-Level System Architecture

### 10.1 Architectural Layers

The system is organized into four horizontal layers and one vertical concern:

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI LAYER                              │
│  Command parsing · Argument validation · Help generation    │
│                Entry point orchestration                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   ORCHESTRATION LAYER                       │
│  Scan orchestrator · Lifecycle management · Progress        │
│  Caching · Concurrency · Error boundaries                   │
└──────┬────────────┬───────────┬──────────┬─────────────────┘
       │            │           │          │
┌──────▼──────┐ ┌───▼────┐ ┌───▼────┐ ┌───▼──────────────┐
│   SCANNER   │ │ PARSER │ │ ENGINE │ │   REPORTER       │
│   MODULE    │ │ MODULE │ │ MODULE │ │   MODULE         │
│             │ │        │ │        │ │                   │
│ File        │ │ TS AST │ │ Rule   │ │ Format findings  │
│ discovery   │ │ parsing │ │ exec   │ │ Calculate score  │
│ Glob        │ │ JS AST │ │ Visit  │ │ Group by         │
│ matching    │ │ JSON   │ │ dispatch│ │ category         │
│ Gitignore   │ │ parsing│ │        │ │                   │
└──────┬──────┘ └───┬────┘ └───┬────┘ └───┬──────────────┘
       │            │          │          │
┌──────▼────────────▼──────────▼──────────▼──────────────────┐
│                     DATA LAYER                              │
│  Findings model · Rule model · Config model · Types        │
└─────────────────────────────────────────────────────────────┘

                        CONFIGURATION (vertical)
                        Config loading · Validation · Resolution
                        (accessed by every layer)
```

### 10.2 Key Architectural Principles

1. **Dependency Inversion**: Higher layers depend on interfaces, not implementations. The engine does not import individual rules. The scanner does not know about the parser. Each module defines an interface that its consumers depend on.

2. **Single Responsibility**: Each module has exactly one reason to change. The scanner finds files. The parser produces ASTs. The engine runs rules. The reporter formats output. They do not know about each other's internals.

3. **Stateless Core**: The rule engine and all rules are stateless. Given the same file and config, they produce the same findings. State (cache, progress tracking, collected findings) lives in the orchestration layer.

4. **Fail-Safe**: Any unhandled exception in a rule, parser, or scanner is caught at the module boundary, logged, and the scan continues. A bug in one rule must not prevent other rules from running. A parse error in one file must not prevent other files from being analyzed.

5. **Streaming Where Possible**: Files are discovered, parsed, and analyzed as a pipeline, not in batch stages. The scanner emits file paths → the parser streams ASTs → the engine produces findings. This keeps memory bounded and enables progress reporting.

### 10.3 Why Not MVC / Hexagonal / Clean Architecture in Full?

Full Clean Architecture (use cases, entities, gateways, presenters) would be over-engineering for a CLI tool. The architecture above follows Clean Architecture's core principle — dependency inversion — without its ceremony. Modules depend on interfaces. Implementations are swappable. The orchestration layer owns the use cases.

The architecture is closest to the **Pipes and Filters** pattern: each stage transforms its input and passes output downstream. This is the pattern used successfully by ESLint, Babel, and the TypeScript Compiler.

---

## 11. Module Responsibilities

### 11.1 CLI Module (`src/cli/`)

**Single Responsibility:** Parse user input and dispatch to the appropriate command handler.

**Does:**
- Parse argv using a lightweight argument parser (no external dependency)
- Validate flag values
- Route to the correct command handler
- Print help text

**Does NOT:**
- Contain business logic (scanning, parsing, reporting)
- Know about rules, ASTs, or findings
- Access the filesystem directly

**Dependencies:** Only the orchestration layer (command handlers)

**Why argument parsing is built-in, not a dependency:**
The CLI has simple needs: a few subcommands, flags, and aliases. Full-featured argument parsers (commander, yargs, clipanion) add weight and dependency risk for functionality we don't need. ESLint uses `optionator` (a minimal wrapper). Biome wrote their own. We should do the same. The argument parser is ~200 lines of straightforward code — not worth an external dependency.

### 11.2 Scanner Module (`src/scanner/`)

**Single Responsibility:** Discover which files to analyze.

**Does:**
- Recursively walk the project directory
- Apply include/exclude glob patterns
- Respect `.gitignore` rules
- Exclude well-known directories (`node_modules`, `.git`, `ios/Pods`, `android/.gradle`, `build`, `dist`)
- Return a lazily-evaluated iterable of file paths (not an array) for memory efficiency

**Does NOT:**
- Read file contents
- Parse files
- Know about rules or findings

**Dependencies:** Configuration (for include/exclude patterns), filesystem

**Why lazy iteration instead of collecting all paths:**
A large monorepo might have 50,000 files. Building an array of all file paths wastes memory. By yielding file paths one at a time, downstream consumers can process files as they're discovered and the garbage collector can free memory. This is the approach used by ESLint 9's flat config file enumeration.

### 11.3 Parser Module (`src/parser/`)

**Single Responsibility:** Convert source files into typed ASTs.

**Does:**
- Accept a file path and return a parsed AST with type information
- Route to the correct parser based on file extension (`.ts`/`.tsx` → TypeScript Compiler API, `.js`/`.jsx` → Babel)
- Attach source file metadata (path, content hash)
- Report parse errors as structured error objects (not thrown exceptions)

**Does NOT:**
- Know about rules or findings
- Run visitors on the AST
- Cache results (caching is the orchestrator's responsibility)

**Dependencies:** TypeScript Compiler API, Babel parser (optional fallback)

**Why TypeScript Compiler API as primary parser (ADR-002):**
The TypeScript Compiler API provides:
- A typed AST (not just syntactic structure — you know the type of every expression)
- Module resolution (what does this import resolve to?)
- JSDoc parsing
- Control flow analysis (for rules about useEffect dependencies, conditional hooks, etc.)

This enables rules that are impossible with an untyped ESTree AST:
- Detect when `useMemo` wraps a value whose dependencies never change (the memo is unnecessary)
- Verify that `useCallback` dependency arrays are complete (by checking what variables the callback actually references)
- Trace imports to determine if a heavy library is being imported for a single trivial function

The cost is parsing speed. TypeScript's parser is ~2-3x slower than Babel's on individual files. However, parsing is the most cacheable stage of the pipeline, and the richer AST enables more valuable rules. This tradeoff is documented in ADR-002.

### 11.4 Engine Module (`src/engine/`)

**Single Responsibility:** Apply rules to parsed ASTs and collect findings.

**Does:**
- Maintain the rule registry (which rules are available and enabled)
- Walk the AST using a visitor pattern
- Dispatch to matching rules at each AST node
- Provide each rule with a context object for reporting findings
- Collect findings from rules
- Catch and log rule-level exceptions (one crashing rule does not crash the scan)

**Does NOT:**
- Discover files (scanner's job)
- Parse files (parser's job)
- Format output (reporter's job)
- Load configuration (config module's job)
- Know about the CLI, filesystem, or terminal

**Dependencies:** Rule implementations, type system (finding model, rule model), config (to know which rules are enabled)

### 11.5 Reporter Module (`src/reporter/`)

**Single Responsibility:** Format findings for human or machine consumption.

**Does:**
- Accept an array of findings and produce formatted output
- Calculate the performance score
- Group findings by category, severity, or file (configurable)
- Colorize terminal output
- Support multiple output formats (stylish, JSON, HTML, SARIF, Markdown, GitHub Actions)

**Does NOT:**
- Run rules or produce findings
- Access the filesystem
- Know about the CLI argument parser

**Dependencies:** Finding model, score calculation logic

### 11.6 Configuration Module (`src/config/`)

**Single Responsibility:** Load, validate, and resolve configuration.

**Does:**
- Search for config files in standard locations (`.rnauditrc.json`, `.rnauditrc.js`, `package.json#rnaudit`)
- Validate config against a JSON Schema
- Merge config from multiple sources (file defaults → config file → CLI flags)
- Resolve paths relative to the config file location
- Provide typed, validated config to all other modules

**Does NOT:**
- Execute rules
- Access the network
- Modify files

**Dependencies:** JSON Schema validator, filesystem (read-only)

### 11.7 Cache Module (`src/cache/`)

**Single Responsibility:** Persist and retrieve per-file analysis results.

**Does:**
- Hash file contents (SHA-256)
- Store findings keyed by `(file_path, content_hash)`
- Detect cache validity on subsequent runs
- Prune entries for files that no longer exist
- Handle cache corruption by invalidating affected entries

**Does NOT:**
- Know about rules or findings structure
- Perform analysis

**Dependencies:** Filesystem (read/write to `node_modules/.cache/rn-audit/`)

### 11.8 Rules Module (`src/rules/`)

**Single Responsibility:** Provide the built-in rule implementations.

**Does:**
- Export a registry of all built-in rules
- Organize rules by category directory
- Each rule file exports a `Rule` object conforming to the Rule interface

**Does NOT:**
- Run the scan (engine's job)
- Know about the CLI, filesystem, or configuration

**Dependencies:** Rule interface (from types module), TypeScript Compiler API types

---

## 12. Data Flow

### 12.1 Full Scan Flow

```
User runs: npx rn-audit

1. CLI Layer
   ├─ Parse arguments
   ├─ Detect project type (react-native / expo)
   └─ Delegate to: Scan Command Handler

2. Orchestration Layer (Scan Command Handler)
   ├─ Load configuration
   ├─ Initialize cache
   ├─ Initialize rule engine (load rules, apply config)
   ├─ Initialize reporter
   ├─ Call Scanner
   └─ For each file path from scanner:
       ├─ Check cache → if hit, use cached findings
       └─ If miss:
           ├─ Call Parser → receive AST
           ├─ Call Engine (with AST + file info) → receive Finding[]
           ├─ Store in cache
           └─ Collect findings

3. Reporting
   ├─ Group findings by category
   ├─ Sort by severity (error → warning → info)
   ├─ Calculate performance score
   ├─ Format output
   └─ Write to stdout (or file if --output)
   
4. Exit
   └─ Exit code based on findings and --max-warnings
```

### 12.2 Data Flow Diagram

```
┌──────────┐    ┌───────────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐
│          │    │           │    │         │    │         │    │          │
│  Config  │───▶│  Scanner  │───▶│ Parser  │───▶│ Engine  │───▶│ Reporter │
│  Loader  │    │           │    │         │    │         │    │          │
│          │    │ File path │    │   AST   │    │Finding[]│    │ Formatted│
└──────────┘    │ (string)  │    │ (typed) │    │         │    │  output  │
                └───────────┘    └─────────┘    └─────────┘    └──────────┘
                                                │
                                          ┌─────▼─────┐
                                          │   Cache   │
                                          │  (read/   │
                                          │   write)  │
                                          └───────────┘
```

### 12.3 Rule Execution Within a Single File

```
Engine.receive(AST, SourceFileInfo)
│
├─ Create RuleContext(sourceFile, config)
│
├─ For each enabled rule:
│   │
│   ├─ Check: does rule apply to this file type?
│   │   (Rule.fileTypes: ['.tsx', '.jsx'] — skip if no match)
│   │
│   ├─ Walk AST, at each node of type T:
│   │   │
│   │   ├─ Look up: does rule declare interest in node type T?
│   │   │   (Rule.visitor: { CallExpression(node) {...} })
│   │   │
│   │   └─ If yes: call rule's visitor(node, context)
│   │       │
│   │       └─ Rule may call: context.report(finding)
│   │           │
│   │           └─ Finding added to per-file findings array
│   │
│   └─ After traversal: collect all findings for this rule
│
└─ Return all findings for this file
```

### 12.4 Caching Strategy Detail

```
For each file to analyze:
│
├─ Compute hash = SHA256(fileContent + ruleIds + ruleConfigs)
│
├─ Look up in cache: Cache.get(hash)
│
├─ If HIT (same file content, same rules, same rule configs):
│   ├─ Restore cached Finding[]
│   ├─ Adjust file paths if project root changed (CI scenario)
│   └─ Use cached findings without re-parsing
│
└─ If MISS:
    ├─ Parse file → AST
    ├─ Run rules → Finding[]
    ├─ Cache.put(hash, Finding[])
    └─ Return Finding[]
```

**Why include rule IDs and configs in the cache key?**
If a user changes a rule from `"warn"` to `"error"`, the finding severity changes but the file content doesn't. If we only hashed file content, we'd serve stale findings with the old severity. Including the rule configuration in the hash ensures cache correctness.

**Why SHA-256 instead of a faster hash (xxHash, FarmHash)?**
SHA-256 is built into Node.js (`crypto.createHash('sha256')`), requires no native dependencies, and is fast enough for the file counts we target. The hashing cost is dwarfed by parsing cost. If profiling reveals hashing as a bottleneck, we can switch to xxHash via an optional native dependency in a future optimization pass.

---

## 13. Rule Engine Design

### 13.1 Why a Rule Engine?

A rule engine is the heart of any static analysis tool. Its design determines:
- How easy it is to add new rules (contributor velocity)
- How fast the tool runs (performance)
- How reliable the tool is (fault isolation)
- Whether third-party plugins are possible (ecosystem)

ESLint's rule architecture is the gold standard in the JavaScript ecosystem. It has proven itself over a decade of use by millions of developers. We follow its pattern while adapting for typed ASTs and React Native domain knowledge.

### 13.2 Rule Interface

Every rule conforms to a single interface. This is the contract between the engine and every rule, built-in or plugin.

```typescript
// Conceptual interface — not implementation code

interface Rule {
  // Unique identifier, e.g., "no-inline-styles"
  // Uses kebab-case. Core rules are unprefixed. Plugin rules are prefixed:
  // "my-plugin/no-inline-styles"
  id: string;

  // Metadata displayed in reports and documentation
  meta: {
    // Human-readable title, e.g., "Disallow inline styles"
    title: string;

    // Detailed description explaining what the rule checks
    description: string;

    // Default severity: "error" | "warn" | "info"
    // Users can override this in configuration
    severity: Severity;

    // Which category the rule belongs to
    category: Category;
    // Categories: "react" | "react-native" | "styles" | "accessibility"
    //           | "dependencies" | "assets" | "architecture" | "expo"
    //           | "code-quality" | "performance"

    // Whether this rule is fixable (Phase 2+)
    fixable?: boolean;

    // Whether this rule has a suggested fix (Phase 2+)
    hasSuggestions?: boolean;

    // JSON Schema for rule options (used for config validation)
    schema?: JSONSchema;

    // URL to full documentation
    docsUrl?: string;

    // Tags for filtering, e.g., ["performance", "flatlist", "scroll"]
    tags?: string[];
  };

  // Which file types this rule applies to.
  // If undefined, applies to all .ts/.tsx/.js/.jsx files.
  fileTypes?: string[];

  // Visitor: maps AST node type → handler function
  // The handler receives the current node and the rule context.
  // Only declare handlers for node types you care about.
  visitor: Record<string, (node: ASTNode, context: RuleContext) => void>;

  // Optional lifecycle hooks
  // Called before visiting any nodes in a file
  onFileStart?: (file: SourceFileInfo, context: RuleContext) => void;

  // Called after visiting all nodes in a file
  onFileEnd?: (file: SourceFileInfo, context: RuleContext) => void;
}
```

### 13.3 RuleContext Interface

```typescript
// Conceptual interface — not implementation code

interface RuleContext {
  // The file being analyzed
  sourceFile: {
    path: string;          // Relative to project root
    absolutePath: string;  // Absolute filesystem path
    content: string;       // Raw source text
    language: 'typescript' | 'javascript';
    isJSX: boolean;
    isTSX: boolean;
  };

  // Configuration for this specific rule (merged from defaults + user config)
  options: Record<string, unknown>;

  // Report a finding at a specific location.
  // This is the primary way rules communicate findings.
  report(finding: {
    // Location within the file
    node: ASTNode;             // The AST node (for position extraction)
    message: string;           // One-line description
    suggestion?: string;       // Fix recommendation
    estimatedImpact?: 'high' | 'medium' | 'low';
    estimatedFixTime?: 'quick' | 'moderate' | 'significant';
  }): void;

  // Get the TypeScript type of a node (only available for .ts/.tsx files)
  getType?(node: ASTNode): Type;

  // Get the resolved module path for an import
  getResolvedModule?(importPath: string): string | null;

  // Access the TypeScript type checker (powerful but use sparingly)
  typeChecker?: TypeScript.TypeChecker;
}
```

### 13.4 Rule Lifecycle

```
1. REGISTRATION (at tool startup)
   │
   ├─ Built-in rules are auto-discovered from src/rules/ directories
   ├─ Each rule module exports a Rule object
   ├─ Rule is validated against the Rule interface schema
   ├─ Rule is registered in the RuleRegistry
   └─ If validation fails, rule is skipped with a warning

2. CONFIGURATION (per scan)
   │
   ├─ User config is loaded
   ├─ Rule severity overrides are applied
   ├─ Disabled rules are removed from the active set
   └─ Rule options are merged (defaults → config)

3. FILE START (per file)
   │
   ├─ Engine checks: does rule apply to this file type?
   │   (rule.fileTypes filter)
   ├─ If yes: rule.onFileStart(file, context) is called
   └─ Rule may do pre-processing (e.g., scan all imports first)

4. AST VISITING (per node)
   │
   ├─ AST walker traverses the tree depth-first
   ├─ At each node, engine checks: does any active rule have a
   │   visitor for this node type?
   ├─ If yes: calls rule.visitor[NodeType](node, context)
   │   │
   │   ├─ Rule inspects the node (and optionally its type)
   │   ├─ If issue found: calls context.report(finding)
   │   └─ If no issue: returns (no-op)
   └─ Engine collects all reported findings

5. FILE END (per file)
   │
   ├─ rule.onFileEnd(file, context) is called
   └─ Rule may report file-level findings (e.g., "file has no default export")

6. AGGREGATION (after all files)
   │
   ├─ All findings collected by engine
   ├─ Deduplicated (same id = same finding)
   ├─ Sorted (severity desc, then file path, then line)
   └─ Passed to reporter
```

### 13.5 Rule Registration Pattern

Rules are registered through a central registry, not imported individually by the engine.

```typescript
// Conceptual — not implementation

// src/rules/react-native/index.ts
import { FlatListKeyExtractor } from './require-flatlist-key-extractor';
import { ImageDimensions } from './require-image-dimensions';
// ... all rules in this category

export const reactNativeRules: Rule[] = [
  FlatListKeyExtractor,
  ImageDimensions,
  // ...
];
```

**Why auto-discovery from directories, not manual imports?**
The directory-based convention is how ESLint, Babel, and Jest discover plugins. A contributor creates a single file in `src/rules/react-native/` and the rule is automatically available. No central registry to update, no import to add, no merge conflict risk. The engine scans directories at startup, imports every `.ts` file, and validates that each exports a valid Rule object.

This also makes third-party plugins trivial in Phase 2: a plugin npm package exports rules following the same structure, and the engine discovers them the same way.

### 13.6 Fault Isolation

Every rule runs inside a try-catch boundary:

```
For each file:
  For each enabled rule:
    try {
      run rule's visitor on this node
    } catch (error) {
      log: "Rule {ruleId} threw an error in {filePath}:{line}. This is a bug in the rule, not your code."
      if (--debug) log stack trace
      continue to next rule  // Do NOT crash the scan
    }
```

This is critical for reliability. In a tool with 50+ rules (future), bugs in individual rules are inevitable. One buggy rule must not prevent the other 49 from reporting findings.

### 13.7 How Rules Access Cross-File Information

Some rules need context beyond the current file:

- `no-unused-files`: needs to know which files are imported by other files
- `no-duplicate-components`: needs to compare components across files
- `dependency-rules`: needs to analyze package.json

For Phase 1, cross-file analysis is handled by the `onFileStart` / `onFileEnd` hooks. The engine can pass a shared context object that accumulates data across files:

```typescript
// Conceptual
interface SharedAnalysisContext {
  // Populated by the engine before rules run
  allFilePaths: string[];
  packageJson: PackageJson;
  // Rules can write to this to share data
  ruleData: Map<string, unknown>;
}
```

The engine populates this context with information gathered during the scan (all file paths discovered, parsed package.json, etc.) and passes it to every rule.

---

## 14. Configuration System

### 14.1 Design Principles

1. **Zero config works**: `npx rn-audit` without any config file does the right thing. Sensible defaults for every rule, every option.

2. **Progressive disclosure**: The config file is not required to get value. It's there when you need customization. `rn-audit init` generates a documented config to ease the transition.

3. **Single source of truth**: Config from file + CLI flags are merged predictably. CLI flags always win. No hidden state, no environment variables with side effects.

4. **Schema-validated**: The config file is validated against a JSON Schema at load time. Typos, invalid values, and structural errors are caught immediately with helpful error messages.

### 14.2 Configuration File Discovery

The config loader searches for the first matching file in this order:

1. `--config <path>` CLI flag (explicit, wins)
2. `.rnauditrc.json`
3. `.rnauditrc.js` (Phase 2 — for dynamic config)
4. `.rnauditrc.yaml` / `.rnauditrc.yml` (Phase 2)
5. `rnaudit` key in `package.json`

It starts at the project root (where `package.json` with `react-native` dependency is found) and does not cascade (for Phase 1). Cascading configs (like ESLint's) are a Phase 2 concern.

**Why not `.rnauditrc` as a directory (like `.eslintrc` was)?**
ESLint 9's flat config (`eslint.config.js`) moved away from the cascading directory-based config. The industry is converging on a single config file at the project root. For Phase 1, a single file is simpler to implement, document, and debug. Cascading can be added later if community demand justifies it.

### 14.3 Configuration Schema

```jsonc
{
  // Which files to include in the scan. Glob patterns relative to project root.
  // Default: all .ts, .tsx, .js, .jsx files not in node_modules
  "include": ["src/**/*.{ts,tsx,js,jsx}"],

  // Which files to exclude. Overrides include patterns.
  // Default: node_modules, build artifacts, test files
  "exclude": [
    "node_modules/**",
    "**/__tests__/**",
    "**/*.test.{ts,tsx,js,jsx}",
    "**/*.spec.{ts,tsx,js,jsx}",
    "e2e/**",
    "**/build/**",
    "**/dist/**"
  ],

  // Rule configuration.
  // Key = rule ID. Value = "off" | "info" | "warn" | "error" | [severity, options]
  "rules": {
    "no-console-log": "off",
    "require-accessibility-label": "error",
    "no-inline-styles": ["warn", { "allowStyleProp": false }]
  },

  // Category-level severity overrides. Applied before individual rule overrides.
  "categories": {
    "accessibility": "error",
    "code-quality": "warn"
  },

  // Severity mapping for terminal output
  "severity": {
    "error": { "icon": "✖", "color": "red" },
    "warn": { "icon": "⚠", "color": "yellow" },
    "info": { "icon": "ℹ", "color": "blue" }
  },

  // Performance score weights (0-100 total)
  "scoring": {
    // How much each severity reduces the score
    "errorDeduction": 10,
    "warnDeduction": 3,
    "infoDeduction": 0,
    // Category multipliers (1.0 = normal weight)
    "categoryWeights": {
      "performance": 1.5,
      "react-native": 1.2,
      "accessibility": 1.0,
      "styles": 0.8,
      "code-quality": 0.5
    }
  },

  // Future: plugin configuration (Phase 2)
  // "plugins": ["@rn-audit/plugin-expo-image"],
  
  // Future: preset/extends (Phase 2)
  // "extends": ["@rn-audit/preset-recommended"],
  
  // Future: settings passed to rules (Phase 2)
  // "settings": {
  //   "reactNativeVersion": "0.76",
  //   "importAliases": { "@components": "./src/components" }
  // }
}
```

### 14.4 Configuration Resolution Order

Layers applied in order (each overrides the previous):

1. **Hardcoded defaults** — every rule has a default severity
2. **Category overrides** — `categories.accessibility = "error"` changes all accessibility rules
3. **Individual rule overrides** — `rules.require-accessibility-label = "warn"` overrides the category's "error"
4. **CLI flags** — `--rules` and `--skip` override the merged config

```
Defaults ──▶ Category overrides ──▶ Rule overrides ──▶ CLI flags
                                                             │
                                                   Final active config
```

### 14.5 What `rn-audit init` Generates

`rn-audit init` generates a `.rnauditrc.json` file containing:

```jsonc
{
  // ============================================================
  // rn-audit Configuration
  // Run `rn-audit rules` to see all available rules.
  // Run `rn-audit explain <rule-id>` for rule documentation.
  // ============================================================

  // Files to include in the analysis
  "include": ["src/**/*.{ts,tsx,js,jsx}"],

  // Files and directories to exclude
  "exclude": [
    "node_modules/**",
    "**/__tests__/**",
    "**/*.test.{ts,tsx,js,jsx}",
    "**/*.spec.{ts,tsx,js,jsx}",
    "e2e/**",
    "**/build/**",
    "**/dist/**"
  ],

  // Rules configuration
  // Set any rule to "off" to disable, or ["error"/"warn"/"info", { options }]
  "rules": {
    // Example: disable console.log warnings
    // "no-console-log": "off",

    // Example: make accessibility a hard error
    // "require-accessibility-label": "error",

    // Example: configure rule options
    // "no-inline-styles": ["warn", { "allowStyleProp": false }]
  }
}
```

Every default-enabled rule is listed (commented) so the user sees what exists and can customize without reading external documentation.

---

## 15. Reporting System

### 15.1 Finding Structure

Every issue discovered during analysis is represented as a Finding with the following fields:

```typescript
// Conceptual type — not implementation code

interface Finding {
  // Unique identifier for this specific finding instance.
  // Generated as: SHA1(ruleId + file + line + column).substring(0, 8)
  // Used for deduplication, baselines, and referencing specific findings.
  id: string;

  // The rule that produced this finding.
  ruleId: string;

  // Human-readable one-line summary.
  // e.g., "FlatList is missing keyExtractor prop"
  title: string;

  // Detailed explanation of the issue.
  // Plain text (no markdown). Should be self-contained.
  // e.g., "This FlatList component does not have a keyExtractor prop..."
  description: string;

  // Severity level of this finding.
  severity: 'error' | 'warn' | 'info';

  // Category this finding belongs to.
  category: Category;

  // File location (relative to project root)
  location: {
    file: string;      // e.g., "src/screens/ProductList.tsx"
    line: number;      // 1-indexed
    column: number;    // 1-indexed
    endLine?: number;  // For multi-line issues
    endColumn?: number;
  };

  // The relevant source code lines, annotated with line numbers.
  // Typically 1-3 lines before the issue line and the issue line itself.
  codeFrame?: {
    lines: Array<{
      lineNumber: number;
      content: string;
      isHighlighted: boolean;  // true for the primary line(s) with the issue
    }>;
  };

  // Actionable fix recommendation.
  // e.g., "Add keyExtractor={(item) => item.id} to this FlatList."
  recommendation: string;

  // URL to full rule documentation.
  documentationUrl?: string;

  // Estimated performance impact of this issue.
  estimatedImpact: 'high' | 'medium' | 'low';

  // Estimated time to fix.
  estimatedFixTime: 'quick' | 'moderate' | 'significant';

  // Machine-readable tags for filtering/searching.
  // e.g., ["flatlist", "scroll-performance", "virtualization"]
  tags: string[];

  // Phase 2: whether an auto-fix is available for this issue.
  futureFixAvailable: boolean;
}
```

### 15.2 Field Rationale

| Field | Why It Exists |
|-------|---------------|
| `id` | Enables deduplication, baselines ("ignore this specific finding"), and CI integration ("comment on the PR with this finding ID") |
| `ruleId` | Links the finding back to its rule for filtering, disabling, and documentation lookups |
| `title` | The quick scan — developers read this first. Must be specific enough to understand the issue without reading the description |
| `description` | Full context for developers unfamiliar with the rule. Includes "why this matters" |
| `severity` | Triage: errors block CI, warnings are advisory, info is educational |
| `category` | Enables grouping in reports and category-level configuration |
| `location` | Clickable in terminal and IDE. `file:line:column` is the universal code location format |
| `codeFrame` | Shows the problematic code inline in the terminal. A developer should not need to open the file to understand the issue. Modeled after Babel and ESLint's code frames |
| `recommendation` | The "what to do about it." Every finding must be actionable. If we can't tell the developer what to do, the rule is not ready |
| `documentationUrl` | Deep link to the rule's full documentation (rationale, examples, exceptions) |
| `estimatedImpact` | Helps developers prioritize. A high-impact FlatList issue should be fixed before a low-impact style duplication |
| `estimatedFixTime` | Reduces the psychological barrier to fixing issues. "Quick fix (30s)" is more likely to get fixed than an undifferentiated warning |
| `tags` | Powers future features: "show me all FlatList-related findings," "filter by performance impact," dashboard aggregation |
| `futureFixAvailable` | Phase 2 readiness: tells the developer "this can be auto-fixed with --fix" — incentive to upgrade |

### 15.3 Severity Levels

| Level | Icon | Meaning | Default CI Behavior |
|-------|------|---------|-------------------|
| `error` | ✖ | Definitively wrong. Causes performance degradation or crashes. Should block CI. | Exit code 1 |
| `warn` | ⚠ | Likely problematic. May cause performance issues. Should be reviewed. | Does not fail CI (configurable via `--max-warnings`) |
| `info` | ℹ | Educational. Points out patterns that could be improved. No performance impact. | Never fails CI |

### 15.4 Categories

| Category | Description | Phase |
|----------|-------------|-------|
| `react` | React patterns: hooks, memo, callbacks, state | Phase 1 |
| `react-native` | React Native specifics: FlatList, ScrollView, Image, Animated | Phase 1 |
| `styles` | StyleSheet, inline styles, theme consistency, duplicated styles | Phase 1 |
| `accessibility` | a11y labels, roles, hit targets, focus order | Phase 1 |
| `dependencies` | Package analysis: duplicates, deprecated, oversized, incompatible | Phase 1 |
| `assets` | Image optimization, dimensions, formats, duplicate assets | Phase 1 |
| `code-quality` | Console.log, debugger statements, unused imports | Phase 1 |
| `architecture` | Duplicate components, cyclic dependencies, folder structure | Phase 2 |
| `expo` | Expo-specific: expo-image, expo-router, EAS config | Phase 2 |
| `performance` | Future runtime-profiling results | Phase 3 |

### 15.5 Performance Score Calculation

The performance score is a 0–100 number displayed prominently in the report. Its purpose is to:
- Give a quick health assessment of the project
- Enable trend tracking over time ("we went from 72 to 85 this sprint")
- Gamify quality improvements

**Formula:**

```
score = max(0, 100 - totalDeduction)

totalDeduction = sum over all findings of:
  baseDeduction(severity) × categoryWeight(category) × impactMultiplier(impact)

baseDeduction:
  error: 10
  warn:  3
  info:  0

categoryWeights (configurable):
  performance:    1.5
  react-native:   1.2
  react:          1.1
  accessibility:  1.0
  dependencies:   1.0
  styles:         0.8
  assets:         0.8
  code-quality:   0.5
  architecture:   0.7
  expo:           1.0

impactMultiplier:
  high:   1.0
  medium: 0.6
  low:    0.3
```

**Example:**
A project with 3 error findings (all high-impact, react-native category) and 12 warning findings (mixed):
```
errors:   3 × 10 × 1.2 × 1.0 = 36
warnings: 12 × 3 × ~0.9 × ~0.65 = ~21
total deduction ≈ 57
score = 43
```

**Why not a letter grade (A/B/C/D/F)?**
Numeric scores are more granular, less subjective, and track better over time. A project going from 72 to 78 is meaningful. A project staying at "B" for six months is not. This follows the model of Lighthouse, SonarQube, and Code Climate.

**Why category weights?**
A missing `keyExtractor` on a FlatList has more performance impact than a duplicated style object. The weights encode domain knowledge about which categories matter most. They are configurable because different teams have different priorities (an e-commerce app cares more about image optimization than a banking app).

### 15.6 Output Format — Stylish (Default)

The default terminal formatter, named "stylish" after ESLint's convention:

```
Top section: Score bar (colored: green ≥ 80, yellow ≥ 60, red < 60)
Section per category: Category header, then findings sorted by severity then file
Each finding: severity icon, title, rule ID, location, code frame, impact badge, fix time badge, recommendation
Footer: total counts, pointer to more info
```

Colors use ANSI escape codes. The tool respects `--no-color`, `NO_COLOR` environment variable, and `FORCE_COLOR`.

### 15.7 Output Format — JSON

```json
{
  "meta": {
    "tool": "rn-audit",
    "version": "1.0.0",
    "timestamp": "2026-07-08T10:30:00Z",
    "projectType": "react-native",
    "projectRoot": "/Users/dev/my-app",
    "filesScanned": 247,
    "filesSkipped": 1,
    "cacheHitRate": 0.85,
    "duration": 3200
  },
  "score": {
    "total": 72,
    "byCategory": {
      "react-native": 45,
      "styles": 78,
      "accessibility": 90
    }
  },
  "findings": [
    {
      "id": "a1b2c3d4",
      "ruleId": "require-flatlist-key-extractor",
      "title": "FlatList is missing keyExtractor prop",
      "severity": "error",
      "category": "react-native",
      "location": {
        "file": "src/screens/ProductList.tsx",
        "line": 42,
        "column": 5
      },
      "estimatedImpact": "high",
      "estimatedFixTime": "quick",
      "recommendation": "Add keyExtractor={(item) => item.id} to this FlatList."
    }
  ],
  "summary": {
    "errors": 3,
    "warnings": 12,
    "info": 8,
    "total": 23
  }
}
```

### 15.8 Output Format — SARIF

SARIF (Static Analysis Results Interchange Format) is the industry standard for static analysis tool output. It's supported by GitHub Code Scanning, GitLab, Azure DevOps, and many other platforms.

By implementing SARIF output in Phase 1, rn-audit integrates with every major CI/CD platform's code review system out of the box — no per-platform integration work needed.

### 15.9 Extensibility of the Reporting System

New formatters are added by:
1. Creating a file in `src/reporter/formatters/`
2. Exporting a function: `(report: Report) => string`
3. Adding the formatter name to a formatter registry

```typescript
// Conceptual interface
interface Formatter {
  id: string;
  name: string;
  description: string;
  contentType: 'text' | 'json' | 'html';
  format(report: Report, options: FormatOptions): string;
}
```

The reporter module discovers formatters the same way the engine discovers rules — directory convention, no manual registration.

---

## 16. Plugin Architecture

### 16.1 Phase 1: Prepared but Not Implemented

Phase 1 does not ship with a plugin system. However, the architecture is designed so that adding plugins in Phase 2 requires **no changes to the rule engine, the AST walker, or the reporting system**. This is achieved by designing the rule interface and the rule registry to be plugin-agnostic from day one.

The built-in rules are treated as a special case of a plugin — the "core" plugin. The engine does not know whether a rule comes from `src/rules/` or from `node_modules/some-plugin/`. Rules are rules.

### 16.2 Plugin Model (Phase 2)

A plugin is an npm package that:

1. Exports an object conforming to the `Plugin` interface
2. Contains one or more Rule implementations
3. May contain shareable configurations (presets)

```typescript
// Conceptual plugin interface
interface Plugin {
  // Unique name, used as prefix for rule IDs
  // e.g., "expo-image" → rules are "expo-image/no-unoptimized-image"
  name: string;

  // Map of rule ID (without prefix) → Rule implementation
  rules: Record<string, Rule>;

  // Optional: shareable configurations
  configs?: Record<string, Partial<Config>>;
}
```

### 16.3 Plugin Usage Flow

```bash
# Install a plugin
npm install --save-dev @rn-audit/plugin-expo-image

# Configure it
# In .rnauditrc.json:
{
  "plugins": ["@rn-audit/plugin-expo-image"],
  "rules": {
    "expo-image/no-unoptimized-image": "error"
  }
}
```

### 16.4 Plugin Discovery

Plugins are discovered at startup by the config module:
1. Read `plugins` array from config
2. For each plugin name, `require(pluginName)` — let Node.js module resolution find it
3. Validate the exported object against the Plugin interface schema
4. Register each rule with the engine: `engine.registerRule(pluginName, ruleId, rule)`

**Why `require()`-based discovery instead of file-system scanning?**
ESLint uses `require()`-based plugin loading. It's battle-tested, simple to understand, and leverages Node.js's module resolution algorithm (which handles nested dependencies, symlinks, and workspaces correctly). File-system scanning would require us to reimplement module resolution — a non-trivial and bug-prone undertaking.

### 16.5 Presets / Shareable Configs (Phase 2)

A preset is an npm package that exports a partial config. It allows teams and the community to share configurations:

```json
{
  "extends": [
    "@rn-audit/preset-recommended",
    "@rn-audit/preset-expo",
    "@my-company/preset-standards"
  ],
  "rules": {
    "no-console-log": "off"
  }
}
```

Resolution is identical to ESLint's `extends`: each preset is loaded, its config is merged in order, and local `rules` overrides take precedence.

### 16.6 Why Not Phase 1?

Building a plugin system in Phase 1 would:
- Delay the initial release by months
- Require solving hard problems (plugin loading, version compatibility, schema validation, error messages for misconfigured plugins) before proving core value
- Risk building the wrong plugin API (we don't yet know what plugins need)

ESLint's plugin API evolved significantly over a decade. We should ship the core tool, gather real-world usage data, understand what plugin authors actually need, then design the plugin API for Phase 2.

**What Phase 1 does instead:** The rule interface, rule registry, and discovery mechanism are designed to be plugin-compatible. Built-in rules use the exact same interface that plugins will use. Phase 2 "just" adds the ability to load rules from npm packages.

---

## 17. Performance Considerations

### 17.1 Performance Budget

```
Cold scan (no cache, 500 files):  < 30 seconds
Warm scan (full cache, 0 changes): < 2 seconds
Incremental (1 file changed):     < 500ms per changed file
Memory ceiling (500 files):       < 512 MB
Startup time (CLI to scan start): < 1 second
```

### 17.2 Parsing Strategy

**Primary parser: TypeScript Compiler API**

The TS Compiler API is designed for batch compilation, not per-file linting. Creating a full `ts.Program` for every file would be prohibitively expensive. Instead, we use a lightweight approach:

1. Create a single `ts.CompilerHost` and `ts.Program` for the entire project (matching the project's `tsconfig.json`)
2. This gives us a shared type checker and module resolution cache
3. For each file to analyze:
   - Get the `ts.SourceFile` from the program (the TypeScript compiler has already parsed it)
   - Walk the AST using `ts.forEachChild` or a recursive visitor
   - The type checker is available for rules that need type information

**Tradeoff:** This means the project must have a valid `tsconfig.json`, which most React Native projects do. For projects without TypeScript, we fall back to Babel parsing.

**Fallback parser: Babel**

For `.js` and `.jsx` files, and for projects without TypeScript:
- Parse with `@babel/parser` (supports JSX, Flow, and modern JavaScript syntax)
- The AST is a Babel AST, not a TS AST
- Rules that require type information are skipped for these files (with an info-level note: "Type information not available for .js files")

### 17.3 Caching Architecture

```
Cache Location: node_modules/.cache/rn-audit/
Cache Format: One file per source file, named as SHA256(absolutePath)
Cache Content: JSON with { hash, findings, timestamp, ruleVersions }

Cache Key = SHA256(
  fileContent +
  JSON.stringify(activeRuleIds) +
  JSON.stringify(ruleConfigs) +
  toolVersion  // invalidate all caches on tool upgrade
)
```

**Cache invalidation:**
- File content changed → hash mismatch → cache miss
- Rule configuration changed → hash mismatch → cache miss
- Tool version changed → hash mismatch → cache miss (rules may have changed between versions)
- Cache entry older than 7 days → considered stale and pruned (prevents unbounded cache growth)

**Why not a SQLite cache?**
ESLint uses a flat file cache. For our scale (thousands of files, not millions), a flat file approach is simpler, easier to debug (`cat .cache/rn-audit/<hash>` is human-readable), and avoids a native dependency (better-sqlite3 requires compilation). If performance data shows SQLite would be faster, we can add it as an optional backend without changing the cache interface.

### 17.4 Concurrency Model (Phase 1 Decision: Single-Threaded)

**Phase 1 uses a single-threaded, synchronous execution model**, with the following rationale:

1. **TypeScript Compiler API is inherently synchronous.** The `ts.Program` and `ts.TypeChecker` APIs are all synchronous. Running them in worker threads would require creating separate `ts.Program` instances per worker, which would multiply memory usage and startup time.

2. **I/O is not the bottleneck.** For projects under 1,000 files, parsing (CPU) dominates. File reading is a small fraction of total time.

3. **Simplicity.** A single-threaded model is easier to debug, profile, and make deterministic. Concurrency bugs (race conditions, ordering-dependent behavior) disappear.

4. **The cache makes this viable.** The cold scan is slow (~30s) but the warm scan is fast (~2s). Developers experience the warm scan most of the time.

**Phase 2+ concurrency:** For larger projects (5,000+ files), worker threads can be introduced for:
- File reading (I/O-bound, trivially parallelizable)
- JavaScript file parsing with Babel (no shared state)
- Rule execution on already-parsed ASTs (stateless, trivially parallelizable)

TypeScript parsing would remain on the main thread due to the shared `ts.Program` constraint.

### 17.5 Memory Optimization

- **Lazy file discovery:** The scanner yields file paths one at a time. Not all 50,000 paths are in memory simultaneously.
- **Streaming analysis:** Files are parsed and analyzed as they're discovered. The entire project's worth of findings is the only unbounded collection.
- **AST garbage collection:** After a file is analyzed and cached, its AST can be garbage collected. We don't keep all ASTs in memory.
- **Cache pruning:** Old cache entries are automatically pruned to prevent disk bloat.

### 17.6 Profiling Built In

The tool includes built-in profiling (visible with `--stats`):

```
$ rn-audit --stats

Timing Report (total: 3.2s)
  File discovery:     120ms   (3.8%)
  Parsing:            1800ms  (56.3%)  ← bottleneck
  Rule execution:     980ms   (30.6%)
  Reporting:          300ms   (9.4%)

Cache
  Hits: 210 (85%)
  Misses: 37 (15%)

Memory
  Peak RSS: 180MB
```

This transparency helps developers understand where time goes and guides optimization work by contributors.

---

## 18. Testing Strategy

### 18.1 Testing Philosophy

Professional compiler and linter tools (TypeScript, ESLint, Babel) use a multi-layered testing strategy. We adopt their proven approaches.

The guiding principle: **every bug fix adds a test first.** Regression tests are the cheapest form of quality assurance for a tool whose output is deterministic.

### 18.2 Test Layers

#### Layer 1: Unit Tests

**What:** Test individual functions in isolation: config validation, file path glob matching, finding deduplication, score calculation, cache key generation.

**Tools:** Vitest (fast, native ESM, TypeScript support, Jest-compatible API).

**Coverage target:** > 90% for all modules in `src/config/`, `src/utils/`, `src/reporter/scorer.ts`, `src/cache/`.

**Example patterns:**
- Config schema: valid config passes, invalid config produces specific error messages
- Score calculation: known findings produce expected scores
- Cache: put + get roundtrip, corrupted cache detection, pruning of stale entries

#### Layer 2: Rule Tests (Fixture-Based)

**What:** Each rule is tested against pairs of input files: a "valid" (should produce no findings) and "invalid" (should produce expected findings) file. This is the pattern used by ESLint and typescript-eslint.

**Structure:**
```
tests/fixtures/
  require-flatlist-key-extractor/
    valid/
      with-key-extractor.tsx
      empty-flatlist.tsx
      sectionlist.tsx              // Should not flag SectionList
    invalid/
      missing-key-extractor.tsx
      key-extractor-wrong-type.tsx
```

**Test runner:** For each fixture directory:
1. Parse each file in `valid/` → assert zero findings
2. Parse each file in `invalid/` → assert expected findings (rule ID, message, line, column)

**Why fixture-based tests for rules?**
Rules are the "product." Their correctness cannot be verified by unit testing helper functions. A fixture test says: "Given this exact source code, the rule must produce these exact findings." This is how ESLint, typescript-eslint, and Rome test their rules. It's also the most contributor-friendly test pattern: adding a new rule means adding fixture files, not writing test code.

#### Layer 3: Snapshot Tests

**What:** Run the full tool against a known project and snapshot the output. Used to catch regressions in reporting, scoring, or the interaction between multiple rules.

**Structure:**
```
tests/__snapshots__/
  full-scan-terminal.txt
  full-scan-json.json
  full-scan-sarif.json
```

**When snapshots are updated:** When a rule is intentionally changed, the snapshot changes. The CI diff shows exactly what changed in the output — this is a feature, not a bug. It prevents accidental output changes.

#### Layer 4: Integration Tests

**What:** End-to-end tests using the CLI entry point against real project directories.

**Structure:**
```
tests/integration/
  fixtures/
    basic-rn-project/
      package.json
      src/
        App.tsx
        components/
          ProductList.tsx
    expo-project/
      ...
    project-with-config/
      .rnauditrc.json
      src/
```

**Test scenarios:**
- `rn-audit` in a basic React Native project → exit code 1 (errors found), expected output contains specific findings
- `rn-audit --format json` → valid JSON output, parseable
- `rn-audit --no-cache` → produces same results as cached run
- `rn-audit init` → generates valid config file
- `rn-audit rules` → lists expected rules
- `rn-audit explain require-flatlist-key-extractor` → prints documentation
- Parse error in one file → other files still analyzed, parse error reported

#### Layer 5: CLI Tests

**What:** Verify argument parsing, help text, error messages, exit codes.

**Scenarios:**
- `rn-audit --help` → prints help text, exit 0
- `rn-audit --invalid-flag` → prints error, exit 2
- `rn-audit --config nonexistent.json` → prints "config file not found", exit 2
- Not a React Native project → prints project detection error, exit 2
- Node version too old → prints version error, exit 2

### 18.3 Test Infrastructure

```
tests/
├── unit/                    # Unit tests mirroring src/ structure
│   ├── config/
│   │   ├── loader.test.ts
│   │   └── schema.test.ts
│   ├── scanner/
│   ├── reporter/
│   ├── cache/
│   └── utils/
├── fixtures/               # Rule fixture tests
│   ├── require-flatlist-key-extractor/
│   ├── no-inline-styles/
│   ├── require-image-dimensions/
│   └── ...
├── integration/            # Full CLI integration tests
│   ├── basic-project.test.ts
│   ├── expo-project.test.ts
│   ├── config-file.test.ts
│   └── fixtures/           # Test project directories
├── __snapshots__/          # Snapshot files
├── helpers/                # Test utilities
│   ├── create-fixture.ts   # Create temp projects for tests
│   ├── run-cli.ts          # Execute CLI and capture output
│   └── assert-finding.ts   # Finding assertion helpers
└── setup.ts                # Global test setup
```

### 18.4 CI Test Matrix

```
OS:        ubuntu-latest, macos-latest, windows-latest
Node.js:   18.x, 20.x, 22.x
React Native: 0.71, 0.76 (latest), canary
```

Each combination runs: lint → typecheck → unit tests → rule fixture tests → integration tests → snapshot comparison.

### 18.5 Performance Regression Testing

A dedicated CI job runs the tool against a large synthetic project (5,000 generated React Native files) and asserts that:
- Cold scan completes in < 60 seconds (more lenient than the dev target — CI is slower)
- Warm scan completes in < 5 seconds
- Memory usage stays under 1 GB

If a PR degrades performance, the CI job fails and the author must justify or revert.

---

## 19. Repository Structure

### 19.1 Top-Level Organization

```
rn-audit/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # Main CI: lint, typecheck, test (matrix)
│   │   ├── release.yml             # npm publish on tag
│   │   └── perf.yml                # Performance regression tests
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml          # Structured bug report form
│   │   ├── feature_request.yml     # Feature request form
│   │   └── rule_proposal.yml       # New rule proposal form
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS                  # Who reviews what
│   └── dependabot.yml              # Automated dependency updates
├── docs/
│   ├── README.md                   # Documentation index
│   ├── getting-started.md
│   ├── configuration.md
│   ├── rules/                      # One page per rule
│   │   ├── index.md
│   │   ├── no-inline-styles.md
│   │   ├── require-flatlist-key-extractor.md
│   │   └── ...
│   ├── guides/
│   │   ├── ci-integration.md
│   │   ├── custom-rules.md         # Phase 2
│   │   ├── plugin-authoring.md     # Phase 2
│   │   └── contributing.md
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── rule-engine.md
│   │   ├── parser.md
│   │   └── adr/                    # Architectural Decision Records
│   │       ├── 001-typescript-implementation.md
│   │       ├── 002-ts-compiler-api-parser.md
│   │       └── ...
│   └── roadmap.md
├── src/
│   ├── index.ts                    # Public API surface (for programmatic use)
│   ├── cli.ts                      # CLI entry point (bin in package.json)
│   ├── cli/
│   ├── scanner/
│   ├── parser/
│   ├── engine/
│   ├── rules/
│   ├── reporter/
│   ├── config/
│   ├── cache/
│   ├── types/
│   └── utils/
├── tests/
├── scripts/
│   ├── generate-rule-docs.ts       # Generate docs/rules/ from rule metadata
│   ├── release.ts                  # Release automation
│   └── benchmark.ts                # Performance benchmarking
├── .gitignore
├── .prettierrc                     # Code formatting (not for audits, for the tool's own code)
├── .editorconfig
├── package.json
├── tsconfig.json
├── tsconfig.build.json             # Stricter config for production build
├── vitest.config.ts
├── README.md                       # Project README (different from docs/)
├── CHANGELOG.md                    # Auto-generated from conventional commits
├── LICENSE                         # Apache 2.0
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── SECURITY.md
└── SUPPORT.md
```

### 19.2 Monorepo Consideration

For Phase 1, a single package is sufficient. The repository is structured so that future extraction into a monorepo is straightforward:

- The `src/` directory maps 1:1 to a potential `packages/core/` package
- The `docs/` directory maps to a `packages/docs/` or standalone documentation site
- The rules could be extracted into `packages/rules-react-native/`, `packages/rules-expo/`, etc.
- The CLI could be a thin wrapper over the core library

No changes are needed now. The structure supports future extraction.

---

## 20. Directory Structure

### 20.1 Every Folder Explained

```
src/
```

The entire source code. Separated from tests, docs, and config so that the build output maps cleanly to the source structure.

```
src/cli/
```

The command-line interface layer. Parses arguments, validates flags, dispatches to command handlers. This is the only module that knows about process.argv, stdout, stderr, and exit codes.

**Why separate from the core logic?** The CLI is one consumer of the core library. Future consumers (VS Code extension, programmatic API, GitHub Action) should not need to know about argument parsing or terminal output. This separation enforces that boundary.

```
src/cli/commands/
```

One file per command. `scan.ts` is the most complex — it orchestrates the entire scan pipeline. Other commands (`rules.ts`, `explain.ts`, `init.ts`) are simpler. Each command file exports a `run(args)` function.

```
src/scanner/
```

File system traversal. Finds files to analyze, applies glob patterns, respects ignore rules. The scanner does not read file contents — it only produces file paths.

**Why not use `fast-glob` directly?** `fast-glob` handles glob matching but not `.gitignore` awareness, well-known directory exclusion, or React Native-specific patterns (like ignoring `ios/Pods`, `android/.gradle`). The scanner wraps glob functionality with React Native-specific defaults.

```
src/parser/
```

AST parsing. Primary: TypeScript Compiler API for `.ts`/`.tsx`. Fallback: Babel for `.js`/`.jsx`. The parser module also handles JSON files (`package.json`, `app.json`).

**Why an abstraction over the parser?** Different file types need different parsers. The engine should not know which parser is being used — it just asks for an AST. This abstraction also makes it easy to add future parsers (e.g., a Biome-based parser for speed, or a Flow parser for Flow-typed projects).

```
src/engine/
```

The rule execution engine. This is the heart of the tool. It:
- Maintains the rule registry
- Walks ASTs
- Dispatches to rules
- Collects findings
- Isolates rule failures

```
src/rules/
```

Built-in rule implementations, organized by category subdirectory. Each rule file exports a single Rule object. The index file re-exports a flat list of all rules.

**Why category directories?** Organization for contributors. Finding a rule is easier when they're grouped by domain. The directory structure also serves as documentation — a new contributor can see what categories exist and where their new rule fits.

```
src/reporter/
```

Output formatting. Transforms a list of Findings into formatted text (terminal, JSON, HTML, SARIF, Markdown). Includes the performance score calculator.

**Why separate from the engine?** The engine produces findings. The reporter formats them. These are separate concerns with separate test strategies and separate evolution paths. Adding a new output format should require zero changes to the engine.

```
src/reporter/formatters/
```

One file per output format. Each exports a Formatter object. New formats can be added by creating a single file.

```
src/config/
```

Configuration loading, validation, and resolution. Reads config files, validates against JSON Schema, merges layers (defaults → file → CLI), and provides typed, resolved config to all consumers.

```
src/cache/
```

File-level result caching. Stores and retrieves findings by content hash.

```
src/types/
```

TypeScript type definitions shared across modules. Finding, Rule, Config, Report, Plugin interfaces live here. This module has zero runtime code — it's pure types.

**Why a dedicated types directory?** Keeps type definitions separate from implementations. Prevents circular imports (the engine imports Rule from types, rules import Finding from types — no module imports another module's implementation).

```
src/utils/
```

Shared utilities with no domain knowledge. Logging, timing, path manipulation. These are pure functions with no side effects, no configuration, and no knowledge of rules, findings, or React Native.

```
tests/
```

Mirrors `src/` structure. Test files live alongside the modules they test, but in the test tree. This is the convention used by TypeScript, Babel, and ESLint.

```
docs/
```

All documentation, organized by topic. Separated from the README (which is the entry point for the repository) so that each documentation page can be deep-linked and versioned.

```
scripts/
```

Build and maintenance scripts. Not part of the published npm package. Includes: rule documentation generator (reads rule metadata and generates markdown docs), release automation, benchmark runner.

```
.github/
```

GitHub-specific configuration: CI workflows, issue templates, PR templates, CODEOWNERS. Standard for open-source projects.

### 20.2 Every File Explained (Key Files)

| File | Purpose | Why It Exists |
|------|---------|---------------|
| `src/index.ts` | Public API for programmatic use | Enables `import { scan } from 'rn-audit'` for VS Code extension, CI scripts, etc. |
| `src/cli.ts` | CLI entry point (`bin` in package.json) | Thin wrapper that calls the CLI module. Separate from `src/index.ts` so the API and CLI are different entry points |
| `src/types/finding.ts` | Finding interface and related types | Single source of truth for what a Finding is. Every module depends on this |
| `src/types/rule.ts` | Rule interface | The contract between the engine and every rule. Changing this interface is a breaking change |
| `src/types/config.ts` | Configuration types | Typed representation of the config schema |
| `src/config/defaults.ts` | Hardcoded defaults | Every configurable value has a default here. Generated config files reference these |
| `src/config/schema.ts` | JSON Schema for config validation | Machine-validatable definition of valid config. Used by the loader and by `rn-audit init` |
| `src/rules/index.ts` | Rule registry (built-in) | Central list of all built-in rules. The engine imports this file to register built-in rules |
| `src/reporter/scorer.ts` | Performance score calculation | Isolated so it can be unit-tested exhaustively with known inputs and expected outputs |
| `package.json` | npm package manifest | Standard. `bin` field points to compiled CLI. `main` field points to compiled API. `files` field controls what's published |
| `tsconfig.json` | TypeScript config for development | Used by the IDE for IntelliSense. Less strict than the build config |
| `tsconfig.build.json` | TypeScript config for production build | Stricter. `declaration: true` for `.d.ts` generation. Excludes tests |
| `vitest.config.ts` | Test runner configuration | Vitest configuration: globals, coverage thresholds, test environment |
| `CHANGELOG.md` | Release history | Auto-generated from conventional commits using `standard-version` or `changesets` |
| `LICENSE` | Apache 2.0 | Permissive, enterprise-friendly, compatible with React Native (MIT) |
| `CODE_OF_CONDUCT.md` | Contributor Covenant | Standard for open-source projects. Required for many corporate contribution policies |
| `CONTRIBUTING.md` | How to contribute | Setup instructions, development workflow, testing instructions, PR process |
| `SECURITY.md` | Security policy and reporting | Where to report vulnerabilities, supported versions, response timeline |
| `SUPPORT.md` | How to get help | Links to documentation, issues, discussions, community channels |

### 20.3 What Is Intentionally Absent

- **No monorepo tooling (nx, turborepo, lerna)**: Not needed for a single package. Added only when the project is split into multiple packages.
- **No build tool (webpack, esbuild, rolldown)**: TypeScript's `tsc` is sufficient for a Node.js library. The build output is clean CommonJS + ESM dual package.
- **No CSS/stylesheet system**: The tool has no UI beyond the terminal.
- **No database**: Cache is flat files. No ORM, no SQLite.
- **No framework (NestJS, Express, etc.)**: This is a CLI tool, not a server.
- **No DI container**: Dependency injection is manual (passing config and type checker to functions). The module graph is small and static enough that a DI framework adds complexity without benefit.

---

## 21. Development Milestones

### 21.1 Phase 1 (MVP — 3-4 months, 1-2 engineers)

| Milestone | Deliverables | Target |
|-----------|-------------|--------|
| **M1: Foundation** | Project scaffold, TypeScript build, CLI framework, argument parsing, project type detection | Week 2 |
| **M2: Scanner + Parser** | File discovery with glob + gitignore, TS Compiler API integration, Babel fallback, error handling | Week 4 |
| **M3: Rule Engine** | Rule interface, rule registry, AST walker, visitor dispatch, fault isolation, finding collection | Week 6 |
| **M4: First Rules** | Implement 5 rules (FlatList keyExtractor, inline styles, image dimensions, accessibility labels, nested ScrollViews) | Week 8 |
| **M5: Reporter** | Stylish terminal formatter, JSON formatter, performance scoring, color output | Week 10 |
| **M6: Configuration** | Config file loading, JSON Schema validation, CLI flag merging, `rn-audit init` | Week 11 |
| **M7: Caching** | Content-hash-based file cache, cache invalidation, `--no-cache`, `--clear-cache` | Week 12 |
| **M8: Polish** | Remaining rules, error messages, help text, documentation, benchmark suite, CI setup, test coverage | Week 14 |
| **M9: Release** | npm publish, announcement blog post, documentation site, example repository | Week 16 |

### 21.2 Phase 2 (3-4 months after Phase 1)

- Plugin system: load third-party rules from npm packages
- Auto-fix: `rn-audit --fix` for rules that support it
- More rules: dependency analysis, Expo rules, architecture rules (20-30 total)
- HTML reporter
- SARIF reporter
- Markdown reporter
- GitHub Actions reporter
- `rn-audit config` and `rn-audit doctor` commands
- Shareable configs and presets
- Cascading configuration

### 21.3 Phase 3 (6+ months after Phase 2)

- Runtime profiling: optional Metro/Babel plugin to collect runtime data
- Combined static + runtime reporting
- `rn-audit profile` command
- `rn-audit watch` mode
- VS Code extension (problem matcher, inline diagnostics, quick fixes)
- Baseline files

### 21.4 Phase 4 (12+ months)

- AI-powered recommendations (opt-in, local or cloud)
- AI auto-fixes for complex patterns
- CI/CD quality gates with trend tracking
- Cloud dashboard for team/project aggregation
- GitHub App for PR comments
- Community rule marketplace

---

## 22. Risks and Trade-offs

### 22.1 Risk: TypeScript Compiler API Complexity

**Risk:** The TypeScript Compiler API is complex, poorly documented, and changes between TypeScript versions. Engineers unfamiliar with it will have a steep learning curve. Breaking changes in TypeScript minor versions could break rn-audit.

**Mitigation:** Pin TypeScript as a peer dependency. Test against the TypeScript version range we support (matching React Native's supported TypeScript versions). Use the stable, public API surface only (not internal APIs). Maintain the Babel fallback so the tool works without TypeScript at all.

**Fallback:** If the TS Compiler API proves too burdensome, switch to `@typescript-eslint/parser` which produces ESTree-compatible ASTs with optional type information. This would sacrifice some type-aware analysis capabilities but simplify the parser layer significantly.

### 22.2 Risk: Performance on Very Large Projects

**Risk:** Monorepos (e.g., a project with 20,000 TypeScript files) may exceed the Phase 1 performance budget. Cold scans could take minutes, not seconds.

**Mitigation:** The architecture supports worker threads (Phase 2). The caching strategy mitigates the cold-start problem for repeated runs. The `--include` and `--exclude` flags let users scope analysis to specific directories.

**Fallback:** If single-threaded performance is unacceptable for large projects, prioritize worker-thread parallelism for Phase 1.1 (a minor release shortly after Phase 1). The architecture is designed for it — it's an implementation choice, not an architectural limitation.

### 22.3 Risk: Rule False Positives

**Risk:** Static analysis is inherently imprecise. A rule might flag code that is actually correct (false positive) or miss code that is actually wrong (false negative). Too many false positives and developers disable the rule or stop using the tool.

**Mitigation:**
- Every rule must include real-world test fixtures from popular open-source React Native apps (to verify they don't flag correct code)
- Rules are `"warn"` by default, not `"error"` — only rules with extremely low false-positive rates (like `require-flatlist-key-extractor`) are `"error"` by default
- Rules include `// rn-audit-disable-next-line` comments for suppression (Phase 1.1)
- Report false positives as GitHub issues with the "false-positive" label — they are treated as bugs, not feature requests

### 22.4 Risk: Community Adoption

**Risk:** Building a great tool that nobody uses. Developer tools are a crowded market. rn-audit competes for attention with ESLint, Biome, and established workflows.

**Mitigation:**
- Target the specific pain point: React Native performance. This is a niche that no existing tool fills well
- Zero-config: the tool must provide value on the first run, with no setup
- Beautiful, clear terminal output: first impressions matter
- Partner with React Native and Expo teams for visibility (blog posts, conference talks, documentation references)
- Ship with an Expo plugin so Expo projects get rn-audit by default (Phase 2)
- Performance scoring that gamifies improvement

### 22.5 Trade-off: Correctness vs Coverage

**Trade-off:** The tool could either:
- (A) Have fewer rules with very high accuracy (few false positives), or
- (B) Have many rules with variable accuracy (more findings, more noise)

**Decision:** Option A for default configuration. The default rule set is conservative — rules that have been tested against many real-world codebases and have low false-positive rates. More experimental or opinionated rules are shipped as `"info"` severity or disabled by default.

**Why:** Trust is the most valuable asset for a linting tool. One bad experience ("this tool flagged correct code as broken") loses a user permanently. It's better to have 12 trustworthy rules than 50 noisy ones. Power users can enable additional rules explicitly.

### 22.6 Trade-off: Simplicity vs Power

**Trade-off:** The tool could either:
- (A) Be simple: scan files, run rules, print findings, exit. Easy to understand and contribute to, or
- (B) Be powerful: worker threads, incremental analysis, watch mode, complicated caching, IDE integration

**Decision:** Option A for Phase 1, option B for Phase 2+.

**Why:** Shipping beats perfect. A simple tool that developers can use today is worth more than a powerful tool that ships in 12 months. The architecture supports future power without sacrificing Phase 1 simplicity.

---

## 23. Future Roadmap

### 23.1 Phase 2 — Ecosystem and Automation (3-4 months after Phase 1)

**Goal:** Make rn-audit extensible and CI-native.

**Features:**
- Plugin system (third-party rules)
- `--fix` auto-fix for applicable rules
- `--ci` mode for CI/CD pipelines
- SARIF, HTML, Markdown, and GitHub Actions output formatters
- `rn-audit config` and `rn-audit doctor` commands
- Shareable configs (`extends`)
- Presets (`@rn-audit/preset-recommended`)
- 20-30 additional rules (dependencies, Expo, architecture)
- `// rn-audit-disable-next-line` and `// rn-audit-disable-file` comments
- Cascading configuration

### 23.2 Phase 3 — Runtime Profiling and Editor Integration (6+ months after Phase 2)

**Goal:** Add runtime data and integrate into developer workflows.

**Features:**
- Optional Babel/Metro plugin that collects runtime performance data
- Combined static + runtime analysis
- `rn-audit profile` command (build + run + profile + report)
- `rn-audit watch` mode (re-scan on file changes)
- VS Code extension: inline problem display, quick fixes, status bar score
- Baseline files (`rn-audit baseline`) for incremental adoption in large codebases
- `rn-audit diff` to compare findings between branches

### 23.3 Phase 4 — Intelligence and Scale (12+ months after Phase 3)

**Goal:** Use ML/AI for advanced analysis, scale to organizations.

**Features:**
- AI-powered recommendations (opt-in, local-first)
- AI-assisted auto-fixes for complex refactoring patterns
- Organization-wide quality dashboard
- GitHub App for automated PR review comments
- Slack/Discord integration for team notifications
- Rule marketplace (community-contributed rules)
- Internationalization (findings in languages other than English)

### 23.4 Long-Term Vision (2+ Years)

rn-audit becomes the **standard quality toolkit for React Native**, analogous to:
- **ESLint** for JavaScript linting
- **Prettier** for code formatting
- **Lighthouse** for web performance
- **Cargo** for Rust build tooling

Developers expect `npx rn-audit` to be the comprehensive quality command for React Native projects. The tool is taught in React Native tutorials, integrated into project templates (`npx create-expo-app`), and referenced in job descriptions.

The community maintains hundreds of rules through plugins. Major React Native libraries (React Navigation, Reanimated, expo-image, NativeWind) ship with rn-audit plugins that enforce best practices for their APIs.

---

## 24. Architectural Decision Records (ADR)

### ADR-001: Implementation Language — TypeScript

**Status:** Accepted

**Context:** The tool must be implemented in some language. The options are TypeScript, Rust, Go, or plain JavaScript.

**Decision:** TypeScript.

**Rationale:**
- The target users are TypeScript/JavaScript developers. Contributors should not need to learn a new language.
- The TypeScript Compiler API (our primary parser) is a TypeScript/JavaScript API — using it from Rust or Go would require FFI or WASM, adding complexity.
- TypeScript provides type safety for the tool's own code, which is critical for a tool with a complex internal model (ASTs, rules, findings, configs).
- ESLint, Babel, and Metro are all written in TypeScript/JavaScript. This is the ecosystem norm.

**Alternatives considered:**
- **Rust** (Biome's choice): Faster, but requires contributors to know Rust. The React Native community is overwhelmingly TypeScript/JavaScript. The FFI cost for the TS Compiler API is prohibitive.
- **Go**: Same contributor and FFI issues as Rust, with the additional downside of no existing AST tooling for TypeScript.
- **Plain JavaScript**: Loses the type safety that makes the tool maintainable at scale. TypeScript is the standard for new Node.js projects in 2026.

### ADR-002: Primary Parser — TypeScript Compiler API

**Status:** Accepted

**Context:** We need to parse TypeScript and JavaScript files into ASTs for analysis. Options: TypeScript Compiler API, Babel, @typescript-eslint/parser, SWC, or Biome/oxc parser.

**Decision:** TypeScript Compiler API as primary parser, Babel as fallback for `.js` files.

**Rationale:**
- **Type information**: The TS Compiler API is the only option that provides full type information. Rules like "useMemo with unnecessary dependencies" or "useCallback missing dependencies" require knowing the types of variables referenced in the callback.
- **Module resolution**: The TS Compiler API resolves imports. Rules about dependencies and unused files need this.
- **Control flow analysis**: The TS Compiler API can determine if a variable is definitely assigned, if a function always returns, etc. This enables sophisticated rules.
- **React Native ecosystem**: React Native projects are overwhelmingly TypeScript. The React Native template has been TypeScript-first since 0.71.

**Costs accepted:**
- TS Compiler API is slower than Babel for individual file parsing (2-3x). Mitigated by caching.
- TS Compiler API is synchronous (not async-friendly). Mitigated by Phase 1's single-threaded model.
- TS Compiler API has a learning curve for contributors. Mitigated by abstraction — most rule authors don't interact with it directly.

**Alternatives considered:**
- **Babel only**: No type information. Rules limited to syntactic patterns. Faster parsing but less valuable findings. Would lock us out of Phase 3+ capabilities (type-aware refactoring, AI recommendations that need type context).
- **@typescript-eslint/parser**: Produces ESTree ASTs with optional type information. Good middle-ground, but the type information is less rich than the TS Compiler API. The ESTree AST also loses some TypeScript-specific constructs (like `as` expressions and `enum` declarations) that some rules may need.
- **SWC / oxc**: Very fast (Rust-based), but no type information, immature plugin ecosystem, and requires native compilation. Better suited for Phase 3+ as an optional speed-boost parser.

### ADR-003: AST Traversal — Visitor Pattern

**Status:** Accepted

**Context:** Rules need to inspect specific AST node types. The engine must dispatch nodes to the correct rules. Options: visitor pattern, recursive walk with node type switch, or path-based queries.

**Decision:** Visitor pattern, modeled after ESLint's `visitor` object. Each rule declares which node types it handles. The engine dispatches accordingly.

**Rationale:**
- **Proven pattern**: ESLint has used the visitor pattern for over a decade. It works, it's well-understood, and it's the mental model contributors expect.
- **Efficient**: The engine only calls rules for node types they've declared interest in. Rules that don't care about `ReturnStatement` never see `ReturnStatement` nodes.
- **Composable**: Multiple rules can observe the same node type without knowing about each other.
- **Testable**: A rule's behavior is fully determined by its visitor handlers and the AST it receives. No global state, no ordering dependencies.

**Alternatives considered:**
- **Recursive walk in each rule**: Each rule walks the entire AST independently. Simpler for rule authors (no visitor pattern to learn) but O(R × N) where R = rules and N = nodes. A project with 20 rules and 10,000 AST nodes per file would do 200,000 traversals. Rejected for performance.
- **Path-based queries (like Semgrep or AST-grep)**: Rules are patterns (e.g., `FlatList({...})` without `keyExtractor`). More expressive for pattern matching, less expressive for logic that requires type information or cross-node analysis. Also introduces a query language that contributors must learn.

### ADR-004: Configuration — Single File at Project Root (Phase 1)

**Status:** Accepted

**Context:** Users need to configure the tool. Options: single config file, cascading config (like ESLint's old `.eslintrc`), or CLI-only configuration.

**Decision:** Single config file at the project root for Phase 1. Cascading config deferred to Phase 2.

**Rationale:**
- **Simplicity**: One config file is easier to explain, implement, and debug than cascading. "Put `.rnauditrc.json` in your project root" is a complete sentence.
- **Industry trend**: ESLint 9 moved to a single flat config. Biome uses a single config. Prettier uses a single config. The industry has converged on single-file config.
- **Sufficient for Phase 1**: Without plugins, presets, or per-directory rule overrides, cascading config provides negligible value.

**Future-proofing:** The config loading module accepts an array of config sources (for cascading), but in Phase 1 the array always has one element: the project root config. Adding cascading means finding additional config files in subdirectories and appending them to the array. No interface changes.

**Alternatives considered:**
- **Cascading config (`.rnauditrc` in every directory)**: More powerful (per-directory overrides) but more complex. ESLint moved away from this. Rejected for Phase 1.
- **CLI-only config (flags for everything)**: Simple but doesn't scale past ~10 configurable options. Rejected because we expect 50+ rules with per-rule options.

### ADR-005: Scoring — Weighted Deduction Model

**Status:** Accepted

**Context:** The tool should produce a performance score that reflects project health. Options: pass/fail, letter grade, numeric deduction, or ML-based scoring.

**Decision:** Numeric weighted deduction model. Start at 100, subtract weighted penalties for each finding. See Section 15.5 for the formula.

**Rationale:**
- **Familiar**: Lighthouse, SonarQube, and Code Climate use numeric 0-100 scores. Developers understand this scale.
- **Transparent**: The formula is documented. A developer can compute it manually. No black box.
- **Configurable**: Teams can adjust weights to match their priorities.
- **Gamifiable**: Going from 72 to 78 is measurable progress. A letter grade of "B" stays "B" for a long time.

**Alternatives considered:**
- **Pass/Fail (error threshold only)**: Too coarse. A project with 1 error and a project with 50 errors are both "fail." No incentive for incremental improvement.
- **Letter grades (A/B/C/D/F)**: Subjective grade boundaries. Creates arguments about "why is this a B and not a B+?" Hard to track small improvements.
- **ML-based scoring**: Unpredictable, hard to explain, and requires training data. Violates the "no AI in Phase 1" constraint.

### ADR-006: Cache Storage — Flat Files

**Status:** Accepted

**Context:** The tool needs to cache analysis results. Options: flat files (one per source file), SQLite, or in-process memory only.

**Decision:** Flat files in `node_modules/.cache/rn-audit/`. One cache entry per analyzed file, keyed by content hash.

**Rationale:**
- **No native dependencies**: SQLite requires `better-sqlite3` (native compilation) or `sql.js` (WASM). Flat files use only Node.js built-in `fs` and `crypto`.
- **Debuggable**: A developer can `cat node_modules/.cache/rn-audit/<hash>.json` to inspect cached findings.
- **CI-friendly**: Cache can be persisted across CI runs by caching the `node_modules/.cache/rn-audit/` directory.
- **Bounded complexity**: For the scale we target (< 10,000 files), a flat file cache is more than fast enough. File-system lookups by hash are O(1) on modern SSDs.

**Alternatives considered:**
- **SQLite**: Better for 100,000+ cached entries, transaction safety, and concurrent access. Over-engineering for Phase 1. Can be added as an optional backend later.
- **In-memory only**: Fastest, but loses cache between tool invocations. The warm-scan scenario (< 2 seconds) depends on persistent cache.

### ADR-007: Exit Codes — ESLint Convention

**Status:** Accepted

**Context:** The tool's exit code communicates results to CI systems. Options: ESLint convention (0/1/2), or custom codes.

**Decision:** Follow ESLint's convention: 0 = success (no errors), 1 = linting errors found, 2 = runtime error.

**Rationale:**
- **Industry standard**: CI systems, pre-commit hooks, and developer muscle memory assume ESLint's exit code convention.
- **Semantic clarity**: 0 = "your code is fine," 1 = "your code has issues," 2 = "the tool itself broke."
- **Compatibility**: Drop-in replacement for `eslint` in CI pipelines (same exit codes, same `--max-warnings` semantics).

### ADR-008: License — Apache 2.0

**Status:** Accepted

**Context:** The tool needs an open-source license. Options: MIT, Apache 2.0, GPL, or a custom license.

**Decision:** Apache 2.0.

**Rationale:**
- **Enterprise-friendly**: Apache 2.0 includes explicit patent grants, which enterprise legal teams prefer.
- **Compatible with React Native**: React Native is MIT. Apache 2.0 is compatible with MIT.
- **Used by major tools**: TypeScript is Apache 2.0. ESLint is MIT (but Facebook/Meta projects like React and React Native are MIT).
- **Permissive**: Allows use in proprietary software. The goal is maximum adoption.

**Alternatives considered:**
- **MIT**: Simpler, more common in the React Native ecosystem. Apache 2.0 chosen for patent protection.
- **GPL**: Too restrictive. Would prevent use in proprietary apps, which conflicts with the goal of becoming the standard tool for all React Native development.

---

## 25. Open Source Strategy

### 25.1 Repository Health

**Before public launch, the repository must have:**
- [x] Comprehensive README with badges (npm version, CI status, license, downloads)
- [x] CONTRIBUTING.md with setup instructions, development workflow, and testing guide
- [x] CODE_OF_CONDUCT.md (Contributor Covenant 2.1)
- [x] SECURITY.md (how to report vulnerabilities, supported versions)
- [x] SUPPORT.md (where to get help)
- [x] CHANGELOG.md (auto-generated from conventional commits)
- [x] Issue templates (bug report, feature request, rule proposal) as YAML forms
- [x] PR template with checklist
- [x] CODEOWNERS (who reviews what)
- [x] CI badge in README (green, always)
- [x] GitHub Discussions enabled for Q&A
- [x] GitHub Projects set up for public roadmap tracking

### 25.2 Issue and PR Labels

```
Type: bug, feature, docs, refactor, performance, dx (developer experience)
Priority: p0-critical, p1-high, p2-medium, p3-low
Status: needs-triage, accepted, in-progress, blocked, needs-repro
Category: rule-*, reporter, cli, config, cache, docs
Community: good-first-issue, help-wanted, hacktoberfest
Rule-Specific: false-positive, false-negative, rule-enhancement
```

### 25.3 Release Strategy

- **Release cadence**: Minor releases every 2-4 weeks, patch releases as needed for bugs.
- **Release process**: Fully automated via GitHub Actions. Tag push → CI → npm publish → GitHub Release → changelog update.
- **Semantic versioning**: Strictly followed.
  - **MAJOR**: Breaking changes to the Rule interface, config schema, or CLI (e.g., removing a flag, changing exit codes).
  - **MINOR**: New rules, new formatters, new features, deprecations.
  - **PATCH**: Bug fixes, performance improvements, documentation updates.
- **Release channels**: `latest` (stable), `next` (beta/rc for early testing).
- **Deprecation policy**: Features deprecated in a MINOR release are removed in the next MAJOR. Deprecation warnings are printed in the terminal and include the migration path.

### 25.4 Community Building

**First 100 users:**
- Announce on React Native subreddit, Twitter/X, and React Native Discord
- Blog post on the Expo blog (partnership)
- Demo at React Native meetups and conferences
- Reach out to prominent React Native developers for feedback

**First 1,000 users:**
- Rule proposal process: any user can propose a rule via a structured issue template, community votes, accepted rules are implemented by maintainers or the proposer
- Contributor ladder: casual contributor → regular contributor → triage team → maintainer
- Swag for contributors (stickers, t-shirts for significant contributions)
- Office hours (bi-weekly video call for contributors)

**Sustainability:**
- GitHub Sponsors for the lead maintainer
- Open Collective for project expenses (domain, CI minutes, swag)
- Corporate sponsorship tiers (companies that depend on rn-audit sponsor its development)

---

## 26. Documentation Plan

### 26.1 Documentation Sites

**GitHub (`/docs/`):**
- Architecture documentation (for contributors)
- Rule documentation (one page per rule)
- API documentation (for programmatic users)
- Contributing guide

**Documentation Website (Phase 2):**
- Getting started guide
- Rule search/filter
- Interactive examples
- Migration guides
- Blog/changelog

### 26.2 Rule Documentation Template

Every rule's documentation page follows this template:

```markdown
# rule-id

**Severity:** warn (configurable)
**Category:** react-native
**Estimated Fix Time:** quick

## Overview
One-paragraph description of what the rule checks and why.

## Rationale
Why this matters. Link to React Native documentation, performance guides, or research.

## Examples

### ❌ Incorrect
```tsx
// Code that triggers this rule
```

### ✅ Correct
```tsx
// Code that passes this rule
```

## Configuration

```json
{
  "rules": {
    "rule-id": ["warn", { "optionName": "value" }]
  }
}
```

## When Not to Use
Cases where this rule might be overly strict and should be disabled.

## Related Rules
- [other-rule](./other-rule.md) — Related rule description

## References
- [React Native docs: ...](https://...)
- [Related blog post / research](https://...)
```

### 26.3 Generated Documentation

Rule documentation pages in `docs/rules/` are partially auto-generated from rule metadata:
- Title, severity, category, tags, schema → generated boilerplate
- Description, rationale, examples, references → hand-written by the rule author

A CI script (`scripts/generate-rule-docs.ts`) validates that every rule has a corresponding docs page and that the metadata in the docs matches the metadata in the rule implementation.

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **AST** | Abstract Syntax Tree — a tree representation of source code structure |
| **Finding** | A single issue discovered by a rule during analysis |
| **Rule** | A module that checks source code for a specific pattern and reports findings |
| **Plugin** | An npm package containing one or more custom rules |
| **Preset** | A shareable configuration that enables and configures a set of rules |
| **Severity** | The importance level of a finding: error, warn, or info |
| **Category** | The domain a rule belongs to: react, react-native, styles, accessibility, etc. |
| **Code Frame** | A snippet of source code with line numbers and highlighting, shown in error messages |
| **SARIF** | Static Analysis Results Interchange Format — an industry standard JSON format for static analysis results |
| **Stylish** | The default terminal output format, named after ESLint's convention |
| **Fault Isolation** | The principle that one failing rule should not crash the entire analysis |
| **Cold Scan** | Running the tool with an empty cache |
| **Warm Scan** | Running the tool with a fully populated cache and no file changes |
| **Estree** | The AST specification used by ESLint and Babel |
| **New Architecture** | React Native's post-0.76 architecture: Fabric renderer, TurboModules, JSI, Hermes |

---

## Appendix B: References

- [ESLint Architecture](https://eslint.org/docs/latest/contribute/architecture/)
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [Biome Architecture](https://github.com/biomejs/biome/blob/main/CONTRIBUTING.md)
- [Babel Plugin Handbook](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md)
- [React Native Performance Guide](https://reactnative.dev/docs/performance)
- [Expo Performance Guide](https://docs.expo.dev/guides/performance/)
- [SARIF Specification](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [Contributor Covenant](https://www.contributor-covenant.org/)

---

*This document is a living artifact. It will be updated as implementation reveals new constraints and as community feedback shapes the roadmap. All substantive changes to this document require a reviewed PR against the `main` branch.*

*Last updated: 2026-07-08*
