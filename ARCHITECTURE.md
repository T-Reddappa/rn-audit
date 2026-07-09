# rn-audit — Architecture & File Reference

## Overview

`rn-audit` is a static analysis and performance auditing CLI for React Native and Expo projects. It is a **Node.js package** (not an Expo library) — you run it against an RN/Expo project to analyze it.

The project is a pipeline with **four subsystems** wired in sequence:

```
Discovery → Scanner → AST Engine → Rule Engine → Reporter
```

There are **33 source files** across 6 directories.
wi
---

## Layer 0: Shared Types (`src/types/`)

### `src/types/project.ts` — The Project Model

The **central data structure** that flows through every subsystem. It's a plain interface (`ProjectModel`) with 22 fields describing everything the tool knows about the audited project:

- **Identity**: `root` (absolute path), `name` (from package.json), `version`
- **Classification**: `ProjectFramework` enum (`Expo` or `ReactNativeCLI`), `ExpoWorkflow` enum (`Managed` or `Bare`), `hasExpoRouter` (boolean)
- **Runtime versions**: `reactNativeVersion`, `expoVersion`, `reactVersion`, `typescriptVersion`, `nodeEngine` — all nullable strings
- **Package manager**: `PackageManager` enum (`Npm`, `Yarn`, `Pnpm`, `Unknown`) — detected from lock files, not user preference
- **Dependencies**: `DependencyMap = Record<string, string>` — flat maps of package name → semver range for both `dependencies` and `devDependencies`
- **Configuration files**: `ConfigFiles` interface with nullable paths for every known config file (`tsconfig`, `babelConfig`, `metroConfig`, `appJson`, `appConfig`, `expoEnvDts`, `tailwindConfig`, `nativewindConfig`, `eslintConfig`). `null` = "looked, not there"; distinct from `undefined` = "haven't checked yet"
- **Monorepo**: `isWorkspace` (boolean), `workspaceRoot` (nullable) — Phase 2 feature, always false/null in Phase 1
- **Metadata**: `isSupported` (boolean), `discoveredAt` (ISO 8601 timestamp)

Design principle: model what **IS**, not what we **WISH** — `packageManager` is detected from lock files, not read from user preference. `ConfigFiles` uses `null` not `undefined` to distinguish "checked and absent" from "not yet checked."

### `src/types/file.ts` — The File Model

Defines `FileModel` — the metadata record for a single discovered source file:

- **Identity**: `absolutePath` (canonical identifier, used as cache key), `relativePath`, `extension` (`FileExtension` union: `".ts" | ".tsx" | ".js" | ".jsx"`), `fileName`
- **Filesystem metadata**: `size` (bytes, used to estimate memory and flag oversized files), `lastModified` (Unix timestamp in ms — integer for fast comparison, trivial JSON serialization, deterministic sorting)
- **Project membership**: `projectRoot`, optional `workspace` (relative path in monorepo) and `packageName` (from workspace package.json)
- **Filtering state**: `ignored: boolean`, optional `ignoreReason` (e.g., `"node_modules (built-in)"` or `".gitignore:*.generated.* (line 12)"`)

`FileExtension` is a **union type** rather than `string` to enable exhaustive switch/case checking — adding a new extension causes TypeScript errors in every switch that handles extensions. `SUPPORTED_EXTENSIONS` is the canonical `ReadonlySet` used by the scanner for O(1) lookup.

`SourceDiscoveryResult` separates files into `active` and `ignored` buckets with traversal statistics (`traversalTimeMs`, `directoriesVisited`, optional `warnings`).

### `src/types/discovery.ts` — Discovery Subsystem Internal Types

Types used **only** within the discovery pipeline. Separated from `project.ts` to keep the Project Model pure — it describes output, not process:

- `DiscoveryOptions`: optional `cwd` (defaults to `process.cwd()`) and `projectRoot` (skips root-finding walk)
- `DiscoveryErrorCode` enum: `NO_PACKAGE_JSON`, `NOT_A_REACT_NATIVE_PROJECT`, `UNSUPPORTED_PROJECT_TYPE`, `INVALID_CONFIGURATION`, `PERMISSION_DENIED`
- `TypeDetectionResult`: `framework`, `isSupported`, optional `workflow`, `hasExpoRouter`
- `RawPackageMetadata`: raw strings from package.json **before** semver cleaning (version ranges like `^0.76.0`)
- `RootFinderResult`: `root` path + `explicit` boolean
- `ConfigFilePattern`: maps a `ConfigFiles` key to an ordered list of file names (first match wins)

---

## Layer 1: Project Discovery (`src/discovery/`)

### `src/discovery/index.ts` — Discovery Orchestrator

The **single public entry point**: `discoverProject(options?)`. Runs a six-step pipeline:

1. **Root finding**: `findProjectRoot(startDir)` — walk up from cwd to find package.json with `react-native` or `expo`. If `options.projectRoot` is provided, uses `findProjectRootExplicit()` instead (validates without walking).
2. **Validation**: `validateProject(root)` — checks version support, excludes web frameworks
3. **Metadata extraction**: `extractMetadata(root)` — reads package.json + lock files
4. **Type detection**: `detectProjectType(root, deps, devDeps)` — classifies framework/workflow
5. **Config discovery**: `discoverConfigFiles(root)` — finds all known config files
6. **Assembly**: merges everything into a `ProjectModel`, stamps `discoveredAt` with `new Date().toISOString()`

If unsupported, throws `UnsupportedProjectError` (caught by CLI for clean error messages with exit code 2). Re-exports all error classes, types, and enums for consumer convenience.

### `src/discovery/root-finder.ts` — Project Root Locator

Two public functions:

**`findProjectRoot(startDir?)`**: Walks up the directory tree from `startDir` (defaults to `process.cwd()`). At each level:

1. Checks if `<currentDir>/package.json` exists
2. If yes, parses it and checks for `react-native` or `expo` across `dependencies`, `devDependencies`, AND `peerDependencies` (monorepo roots hoist RN to devDeps; libraries declare it as a peerDep)
3. If found → returns `{ root: currentDir, explicit: false }`
4. If not → moves to `dirname(current)`; stops when `parent === current` (filesystem root)
5. Throws `NoPackageJsonError` if nothing found

**`findProjectRootExplicit(explicitRoot)`**: Validates a user-provided path without walking. Used when `--config <path>` is passed. Throws `NoPackageJsonError` if no package.json, `NotReactNativeProjectError` if not an RN project.

Internal helper `checkPackageJsonForReactNative()` merges all three dependency maps into a single set lookup against `RN_MARKER_DEPENDENCIES = Set(["react-native", "expo"])`. Malformed JSON is treated as "not an RN project" (validator catches it later with a better error).

### `src/discovery/validator.ts` — Project Validator

`validateProject(projectRoot)` runs four checks in order of cost (cheapest first):

1. **Dependency presence**: Are `react-native` or `expo` declared? Throws `NotReactNativeProjectError` if neither is found (double-checks the root finder's work with better error reporting).
2. **Web framework exclusion**: Checks `NON_RN_FRAMEWORKS = Set(["next", "nuxt", "remix", "@sveltejs/kit", "gatsby", "astro"])` against all deps. If a web framework is found AND react-native is also a dep, returns `{ isSupported: false, reason: "..." }` — the project is likely using react-native-web, not actual React Native.
3. **React Native version**: Requires ≥ 0.71.0 (first TypeScript-first RN version). Parses semver range by stripping `^~>=<`, handles `workspace:*` and `file:` protocols leniently (trusts them), handles URL/git deps leniently.
4. **Expo SDK version**: Requires ≥ 49. Only checked when `expo` is in deps.

Returns `ValidationResult { isSupported: boolean, reason?: string }`.

### `src/discovery/type-detector.ts` — Project Type Classifier

`detectProjectType(root, dependencies, devDependencies)` implements a classification matrix:

| Condition                                  | Framework      | Workflow  | hasExpoRouter         |
| ------------------------------------------ | -------------- | --------- | --------------------- |
| `expo` in deps, no `ios/`+`android/` dirs  | Expo           | Managed   | `expo-router` in deps |
| `expo` in deps, has `ios/`+`android/` dirs | Expo           | Bare      | `expo-router` in deps |
| `react-native` in deps, no `expo`          | ReactNativeCLI | undefined | `expo-router` in deps |

Both `ios/` AND `android/` directories must exist for Bare workflow classification. One native directory alone is classified as Managed (likely a misconfigured project). Merges `dependencies` and `devDependencies` into a single `Set` for lookup.

### `src/discovery/config-finder.ts` — Configuration File Discovery

`discoverConfigFiles(projectRoot)` iterates a `CONFIG_FILE_PATTERNS` array — the **single source of truth** mapping `ConfigFiles` keys to ordered file name lists:

```
tsconfig        → ["tsconfig.json"]
babelConfig     → ["babel.config.js", "babel.config.cjs", "babel.config.mjs", ".babelrc"]
metroConfig     → ["metro.config.js", "metro.config.cjs", "metro.config.mjs"]
appJson         → ["app.json"]
appConfig       → ["app.config.js", "app.config.ts"]
expoEnvDts      → ["expo-env.d.ts"]
tailwindConfig  → ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs"]
nativewindConfig→ ["nativewind.config.js", "nativewind.config.ts"]
eslintConfig    → ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs",
                    ".eslintrc.js", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml"]
```

For each pattern, checks files in priority order; **first match wins** (flat config before legacy for ESLint, `babel.config.js` before `.babelrc`). Builds the result object dynamically from the pattern array — adding a new config file type requires ONLY adding to `CONFIG_FILE_PATTERNS` and the `ConfigFiles` interface. `packageJson` is recorded unconditionally (validator already confirmed it exists).

### `src/discovery/metadata.ts` — Package Metadata Extractor

`extractMetadata(projectRoot)` reads and parses `package.json`, then:

1. **Merges dependency sources**: `{ ...devDependencies, ...peerDependencies, ...dependencies }` — `dependencies` last = highest priority for version lookups
2. **Extracts cleaned versions** via `extractVersion()`: strips `^~>=<` operators, handles compound ranges (takes first version), returns `null` for `workspace:*`, `file:`, `link:`, `git`, and `http` protocols
3. **Detects package manager** from lock files — the ground truth (the `packageManager` field is just a Corepack hint):
   - `pnpm-lock.yaml` → Pnpm
   - `yarn.lock` → Yarn
   - `package-lock.json` → Npm
   - None → Unknown
4. **Extracts Node engine** from `engines.node`

Returns `ExtractedMetadata` with all cleaned values ready for the ProjectModel.

### `src/discovery/errors.ts` — Discovery Error Hierarchy

A typed error hierarchy rooted at `DiscoveryError` (extends `Error`). Each subclass carries:

- `code: DiscoveryErrorCode` — machine-readable, stable across versions
- `directory: string` — the directory being examined
- Uses `Object.setPrototypeOf(this, ...)` — required for `instanceof` to work with ES2015+ class extension of built-ins

Four subclasses:

- `NoPackageJsonError` — walked up to filesystem root, found nothing
- `NotReactNativeProjectError` — package.json exists but no RN/Expo deps
- `UnsupportedProjectError` — adds `reason: string` (e.g., "version too old")
- `InvalidConfigurationError` — adds `filePath: string` (e.g., malformed JSON)

The `toString()` override formats as `[CODE] message (directory: path)` for debugging.

---

## Layer 2: Source Scanner (`src/scanner/`)

### `src/scanner/index.ts` — Scanner Orchestrator

`discoverSourceFiles(project)` — the single entry point for file discovery. Six-step pipeline:

1. **Create ignore predicate**: `createIgnorePredicate(project.root)` — compiles `.gitignore` into a closure, shared across all walks
2. **Resolve workspaces**: `resolveWorkspaces(project.root)` — detects monorepo tool and extracts workspace package directories
3. **Walk each workspace**: For each package (or just the root for single-package projects), calls `walkSourceFiles()` with the shared ignore predicate. For monorepos, also walks the workspace root for shared source files.
4. **Deduplicate**: By `absolutePath` — a file could match multiple workspace patterns
5. **Partition**: Split into `active` (not ignored) and `ignored` buckets
6. **Assemble**: Returns `SourceDiscoveryResult` with files, stats, and optional warnings

Non-fatal errors (permission denied, broken symlinks) are collected via `onWarning` callback and reported as warnings — a single inaccessible directory doesn't crash the entire scan.

### `src/scanner/file-walker.ts` — Recursive Filesystem Traversal

`walkSourceFiles(options)` performs a depth-first walk. The inner `walk(currentDir, depth)` function:

1. **Guards**: Checks `MAX_TRAVERSAL_DEPTH` (50) and `MAX_FILE_COUNT` (500,000) — if exceeded, emits a `TraversalLimitError` warning and stops recursing (or throws if no warning callback)
2. **Reads directory**: `readdirSync(currentDir, { withFileTypes: true })` — avoids per-entry `stat` calls
3. **For directories**: Prunes eagerly if the name is in `ALWAYS_IGNORED_DIRECTORIES` (saves ~100K+ syscalls in a typical project). Otherwise recurses.
4. **For symlinks**: Calls `resolveSymlink()` which follows chains up to `MAX_SYMLINK_DEPTH` (20), tracks visited real paths in a `Set` for loop detection, follows symlinks to directories. Broken symlinks (ENOENT) and circular symlinks (ELOOP) emit warnings.
5. **For regular files**: Calls `processFile()` which:
   - Checks extension against `supportedExtensions` Set (quick O(1) lookup)
   - Stats the file (handles ENOENT TOCTOU race silently, EACCES/EPERM as warnings)
   - Creates a `FileModel` with all metadata
   - Tests against the injected ignore predicate
   - Increments `filesFound`, `filesAccepted`, or `filesIgnored`

Error handling matrix:

| OS Error                | Handled as                      | Scan continues? |
| ----------------------- | ------------------------------- | --------------- |
| `EACCES` / `EPERM`      | `PermissionDeniedError` warning | Yes             |
| `ENOENT` (TOCTOU)       | Silently skipped                | Yes             |
| `ELOOP` (symlink cycle) | `BrokenSymlinkError` warning    | Yes             |
| `ENOTDIR`               | Silently skipped                | Yes             |

Returns `[FileModel[], WalkStatistics]` — files include ignored ones (marked `ignored: true`) for accurate counting.

### `src/scanner/ignore-resolver.ts` — Gitignore Pattern Engine

`createIgnorePredicate(projectRoot)` returns a closure `(absolutePath) => [boolean, reason?]`. Three-layer check:

1. **Hardcoded directories**: Splits the relative path by `/` and checks each segment against `ALWAYS_IGNORED_DIRECTORIES` — catches files at **any depth** within `node_modules`, `.git`, `dist`, `build`, `coverage`, `ios`, `android`, `.expo`, `.next`. Returns reason like `"node_modules (built-in)"`.
2. **Root `.gitignore`**: Parsed once at startup. `parseIgnoreFile()` reads the file, `parseIgnoreContent()` converts each line to a `CompiledPattern` with a compiled regex.
3. **Nested `.gitignore`**: Parsed on-demand with caching (`Map<string, IgnoreFile | null>`) — walks up from the file's directory to project root, checking for `.gitignore` at each level. Nested `.gitignore` overrides parent for files in its subtree.

**Gitignore-to-regex compiler** (`globToRegex()`): Hand-written conversion:

- `*` → `[^/]*` (anything except path separator)
- `?` → `[^/]` (single character except `/`)
- `**` → `.*` (zero or more path segments)
- Patterns without `/` → prepended with `(^|.*/)` (match at any depth)
- Escapes regex metacharacters: `.`, `(`, `)`, `+`, `^`, `$`, `|`, `{`, `}`, `[`, `]`, `\`

Pattern matching uses **"last match wins"** semantics (gitignore spec): walks patterns in forward order; non-negated match sets `lastMatch`; negated match (`!`) clears it. The final value determines the outcome.

### `src/scanner/workspace-resolver.ts` — Monorepo Workspace Detection

`resolveWorkspaces(projectRoot)`:

1. **`detectWorkspaceTool()`**: Checks in order:
   - `pnpm-workspace.yaml` → pnpm (checked first because pnpm projects may also have package.json workspaces)
   - `yarn.lock` → yarn
   - `package.json` with `workspaces` field → npm
   - Overlay tools detected independently: `turbo.json` → turborepo, `nx.json` → nx

2. **`extractWorkspacePatterns()`**: Dispatches by tool:
   - npm/yarn/turborepo/nx: calls `extractNpmWorkspacePatterns()` — reads `workspaces` from package.json, handles both array format (`["packages/*"]`) and object format (`{ "packages": ["packages/*"] }`)
   - pnpm: calls `extractPnpmWorkspacePatterns()` — focused line-by-line YAML extraction (avoids full YAML parser dependency): finds `packages:` key, then collects `- 'pattern'` lines, handles quoted and unquoted patterns, skips negation patterns

3. **`resolvePatterns()`**: Resolves glob patterns to actual directories:
   - `dir/*` → single-level `readdirSync` filtered to directories only
   - `dir/**` → recursive directory collection via `collectDirectoriesRecursive()`
   - Exact name (no wildcard) → existence check
   - Unsupported syntax → returns empty (silently skips)

4. **Validation**: Each candidate directory must contain a `package.json`. Reads it to extract the package name; falls back to directory basename.

Returns `WorkspaceResult { tool, packages: WorkspacePackage[] }`.

### `src/scanner/constants.ts` — Shared Scanner Constants

Four constant groups, centralized to prevent duplication:

- **`ALWAYS_IGNORED_DIRECTORIES`**: 9 entries — `node_modules`, `.git`, `dist`, `build`, `coverage`, `ios`, `android`, `.expo`, `.next`. Pruned at the directory level (don't even call `readdir`).
- **`SOURCE_EXTENSIONS`**: `.ts`, `.tsx`, `.js`, `.jsx` — what the scanner recognizes as source code.
- **Safety limits**: `MAX_TRAVERSAL_DEPTH = 50`, `MAX_FILE_COUNT = 500_000`, `MAX_SYMLINK_DEPTH = 20` — prevent infinite loops and memory exhaustion.
- **`IGNORE_FILE_NAMES`**: `[".gitignore"]` — future: `".rnauditignore"` for tool-specific overrides.

### `src/scanner/errors.ts` — Scanner Error Hierarchy

Typed errors rooted at `ScannerError`. `ScannerErrorCode` enum with 7 codes. All errors carry `code`, `path`, and optional `cause`.

Six concrete subclasses:

- `PermissionDeniedError` — adds `syscall` (e.g., `"EACCES"`). **Recoverable**.
- `BrokenSymlinkError` — adds `target` (the unresolvable path). **Recoverable**.
- `FileNotFoundError` — TOCTOU race (file deleted between readdir and stat). **Recoverable**, not thrown by default.
- `InvalidWorkspaceError` — adds `configPath`. Malformed workspace config. **Recoverable** (falls back to single-package).
- `UnsupportedPatternError` — adds `pattern` and `feature`. Glob syntax not supported in Phase 1. **Recoverable** (pattern skipped).
- `TraversalLimitError` — adds `limit: "depth" | "fileCount"` and `max`. **Fatal** — scan aborted.

### `src/scanner/types.ts` — Scanner Extension Points

Strategy-pattern interfaces designed for future plugin support (Phase 2). Phase 1 uses built-in implementations:

- **`FileSystemProvider`**: Abstracts `readdir`/`stat`/`readlink`. Enables cloud scanning or in-memory filesystems for testing. Returns `null` instead of throwing on common errors.
- **`IgnoreRuleProvider`**: Tri-state decision (`ignored` / `not-ignored` / `undecided`). Enables `.rnauditignore` support and organization-wide exclusion policies. Multiple providers consulted in order.
- **`WorkspaceResolver`**: Pluggable monorepo tool detection. `detect()` + `resolve()` interface. Enables Bazel, Buck, Lage support.
- **`FileFilter`**: Post-discovery, content-based filtering (e.g., "skip files with `@generated` comment"). Needs cross-file context.
- **`ProgressReporter`**: Lifecycle hooks (`onStart`, `onDirectory`, `onFile`, `onComplete`, `onWarning`). Enables progress bars in CLI/IDE.

---

## Layer 3: AST Engine (`src/ast/`)

### `src/ast/types.ts` — AST Type Contracts

The **abstraction layer** over ts-morph. Types reference TypeScript's `SyntaxKind` enum but **never** ts-morph classes directly — if we migrate to the raw TS Compiler API or a Rust parser, only implementation files change. Six core types:

- **`ASTNode`**: Opaque wrapper — `{ readonly _internal: unknown }`. The underscore prefix signals "do not access directly." Direct access indicates a missing abstraction in our API.
- **`ASTSourceFile`**: Wraps one parsed file. Provides `traverse(visitor: ASTVisitor)` (depth-first walk with subtree pruning) and `getRoot(): ASTNode`. Fields: `filePath`, `fileName`, `isParsed`, `parseErrors`.
- **`ASTProject`**: Owns all source files. Created once per audit run. Provides `getSourceFile(path): ASTSourceFile | undefined` and `getSourceFiles(): Iterable<ASTSourceFile>`. Fields: `root`, `fileCount`.
- **`ASTVisitor`**: Maps `SyntaxKind` numbers to handler functions — `{ [kind: number]: (node, ctx) => void }`. Same pattern as ESLint, Babel, and the TypeScript compiler.
- **`VisitorContext`**: Provides `sourceFile`, `parent`, `ancestors` (readonly array from root to parent), `depth`, and mutable `skipChildren` (set to `true` to prune subtree).
- **`ParseError`**: Structured with `code`, `message`, `severity` (Error/Warning), `filePath`, optional `line`/`column`.
- **`ASTCacheEntry`**: `contentHash` (SHA-256), `parsedAt` (ISO 8601), `parseSuccess`, `parseErrors`, `toolVersion` — for disk caching between runs.

### `src/ast/source-file.ts` — Source File Wrapper

`createASTSourceFile(fileModel, tsSourceFile, parseErrors)` — the bridge between ts-morph and our abstraction. Creates an `ASTSourceFile` object whose `traverse(visitor)` method:

1. Builds a `Set` of `SyntaxKind` values the visitor cares about (O(1) lookup per node)
2. Tracks an ancestor stack (array pushed/popped during recursion)
3. For each node:
   - Checks if its kind is in the visited set
   - If yes, builds `VisitorContext` and calls the handler with a wrapped node
   - If handler sets `ctx.skipChildren = true`, returns without recursing into children
   - Otherwise recurses into `node.forEachChild()`

`wrapNode(node: Node): ASTNode` is the **only place** in the entire codebase where ts-morph's `Node` gets wrapped — all other code passes `ASTNode` values around without touching `_internal`. This is the migration boundary.

Also re-exports `SyntaxKind` from ts-morph so consumers never need to add ts-morph as a direct dependency.

### `src/ast/project.ts` — AST Project Factory

`createASTProject(projectModel, sourceFiles, options?)`:

1. **Locates tsconfig.json**: Checks `<projectRoot>/tsconfig.json`. Returns null if not found (ts-morph uses sensible defaults).
2. **Creates ts-morph Project**: One constructor call with `tsConfigFilePath` + optional `compilerOptions` override. Collapses ~200 lines of manual `CompilerHost` + `ts.Program` + `DocumentRegistry` setup.
3. **Adds source files**: For each `FileModel`:
   - Checks file still exists (TOCTOU between scan and parse)
   - Enforces 10MB max file size (prevents OOM on enormous files)
   - Calls `tsMorphProject.addSourceFileAtPath()` — reads from disk, parses, adds to shared TypeScript Program. If the file was already added (via import resolution), returns the existing `SourceFile`.
   - Collects **syntactic** diagnostics only (not type errors — type errors are the rule engine's domain). Uses `ParseErrorCollector` to accumulate errors.
   - Creates `ASTSourceFile` wrapper via `createASTSourceFile()`
4. **Eager parsing**: If `options.eagerParsing` is true, touches `getRoot()` on every file to force parsing upfront (better for CI where every file is analyzed). Default is lazy — files parse on first access.
5. **Returns**: `ASTProject` with a `Map<string, ASTSourceFile>` for O(1) path-based lookup.

### `src/ast/visitors.ts` — Low-Level Traversal Primitives

Pure functions operating on `ASTNode`. This is the **only module besides `source-file.ts`** that touches `_internal`. Every function unwraps `node._internal as Node` to access ts-morph. Design: pure, composable, framework-agnostic.

**Introspection**:

- `getKind(node)` → `SyntaxKind`
- `getText(node)` → source text within node range
- `getFullText(node)` → text including leading/trailing trivia (comments, whitespace)
- `getStart(node)` / `getEnd(node)` → 0-based character offsets
- `getStartLine(node)` / `getStartColumn(node)` → 1-based position
- `getEndLine(node)` / `getEndColumn(node)` → 1-based position at exclusive end

**Navigation**:

- `getParent(node)` → `ASTNode | undefined` (undefined at SourceFile root)
- `getAncestors(node)` → `ASTNode[]` (parent to root)
- `getChildren(node)` → `ASTNode[]` (immediate children only)

**Traversal**:

- `visitChildren(node, callback)` — invokes callback for each immediate child; return `false` to stop iteration
- `visitDescendants(node, callback)` — full recursive walk; return `false` to prune that node's subtree

**Finding**:

- `findNodes(node, kind)` — depth-first search for all nodes of a given SyntaxKind
- `findNodesByKinds(node, kinds)` — single-pass multi-kind search (more efficient than calling `findNodes` N times)
- `findFirst(node, kind)` — early-exit on first match
- `filterNodes(nodes, predicate)` — convenience wrapper over `Array.filter`

### `src/ast/queries.ts` — Domain-Specific Pattern Search

High-level, named, documented query functions built on visitors. Design: **no analysis logic** — these FIND nodes, they don't judge correctness. That's the rule engine's job.

Naming convention: `find<Thing>` returns `ASTNode[]`, `has<Thing>` returns `boolean` (more efficient, early-exit), `get<Thing>` returns a single value.

**JSX queries**:

- `findJSXElements(node)` — both `JsxElement` and `JsxSelfClosingElement`. Does NOT include fragments.
- `findJSXAttributes(jsxElement)` — all `JsxAttribute` nodes on an element
- `findJSXAttributeByName(jsxElement, name)` — single attribute lookup
- `hasJSXAttribute(jsxElement, name)` — boolean early-exit check
- `getJSXTagName(jsxElement)` — returns `"View"`, `"FlatList"`, `"MyComponent"`, etc.

**Import queries**:

- `findImports(node)` — all `ImportDeclaration` nodes
- `hasImport(node, moduleName)` — checks module specifier string literal (strips quotes)

**Call expression queries**:

- `findCallExpressions(node)` — all function calls
- `findCallExpressionsByName(node, name)` — handles both `useState()` (Identifier) and `React.useState()` (PropertyAccessExpression) patterns by checking the last identifier in a property access chain

**Component queries**:

- `findComponentDeclarations(node)` — heuristic: function declarations + arrow functions assigned to PascalCase variables

**Hook queries**:

- `findHookCalls(node)` — matches `/^use[A-Z]/` on the called expression text. Catches built-in hooks (`useState`, `useEffect`) and custom hooks (`useAuth`, `useProducts`).

**Other**:

- `findObjectLiterals(node)` — all `ObjectLiteralExpression` nodes
- `findArrowFunctions(node)` — all `ArrowFunction` nodes
- `findIdentifiers(node)` / `findIdentifiersByName(node, name)`

### `src/ast/errors.ts` — Parse Error Handling

**`ParseErrorCode` enum**: 6 codes — `SYNTAX_ERROR`, `UNSUPPORTED_SYNTAX`, `FILE_READ_ERROR`, `UNSUPPORTED_EXTENSION`, `FILE_TOO_LARGE`, `TYPE_RESOLUTION_ERROR`. Stable across versions.

**`ParseErrorCollector` class**: Accumulator pattern. Call `add(code, message, line?, column?, severity?)` during parsing, then `freeze()` to get an immutable `readonly ParseError[]`. Provides `hasErrors` and `count` getters for early-exit checks.

**`fromTypeScriptDiagnostic(diagnostic, filePath)`**: Bridge function that maps TypeScript's diagnostic format (nested `messageText`, numeric `category`, numeric `code`) to our `ParseError`. Maps specific TS error codes:

- 2304, 2551 → `TYPE_RESOLUTION_ERROR`
- 1005, 1128, 1109, 1434, 1435, 1483, 1160 → `SYNTAX_ERROR`
- Unknown codes → classified by category (Error → `SYNTAX_ERROR`, Warning → `UNSUPPORTED_SYNTAX`)

### `src/ast/index.ts` — AST Public API Barrel

Re-exports everything as a single module: `createASTProject`, all types, `createASTSourceFile`, `SyntaxKind`, `ParseErrorCollector`, `ParseErrorCode`, `fromTypeScriptDiagnostic`, all visitor primitives, and all domain queries. This is what consumers import from — `import { ... } from "rn-audit/ast"`.

---

## Layer 4: Rule System (`src/rules/`)

### `src/rules/types.ts` — Rule SDK Contracts

The **stable, implementation-independent vocabulary** for rules. Rules depend on these contracts; framework implementations depend on them too. Keeping the dependency pointed at abstractions prevents coupling to the scanner, ts-morph, or a particular reporter.

**`RuleSeverity` enum**: `Off`, `Hint`, `Info`, `Warning`, `Error`. `Off` exists only in configuration — disabled rules are never executed, so findings never have severity `Off`.

**`RuleMetadata` interface** — 18 fields describing rule identity and capabilities:

- Identity: `id` (namespaced, globally unique), `name` (human-readable), `description` (one sentence)
- Classification: `category` (one of FindingCategory), `tags` (searchable labels), `recommended` (included in built-in preset)
- Behavior: `defaultSeverity`, `requiresTypeInformation`, `requiresJSX`
- Capabilities: `supportsAutoFix`, `supportsSuggestions`
- Effort: `estimatedImpact`, `estimatedFixTime`
- Versioning: `introducedVersion`, optional `deprecated` ({ `since`, `reason`, `replacedBy?` })
- Documentation: optional `RuleDocumentation` with `url`, `rationale`, `goodExamples`, `badExamples`

**`RuleContext<Options>`**: The capability object supplied to `rule.analyze()`. Provides read-only access to:

- `project: ProjectModel` — project metadata
- `ast: ASTProject` — all parsed files
- `file: FileModel` — current file metadata
- `sourceFile: ASTSourceFile` — current parsed AST
- `configuration: RuleConfiguration<Options>` — resolved severity + typed options
- `logger: RuleLogger` — structured debug/warn logging
- `services: RuleServices` — typed service lookup for plugins
- `signal: AbortSignal` — cooperative cancellation (CLI, IDE, worker threads)

**`Rule<Options>`**: The **only** interface rule authors implement:

```typescript
interface Rule<Options> {
  readonly meta: RuleMetadata;
  analyze(context: RuleContext<Options>): readonly Finding[] | Promise<readonly Finding[]>;
}
```

### `src/rules/finding.ts` — The Finding Domain Model

The **canonical, reporter-neutral output format**. Deeply immutable, JSON-safe data. Deliberately excludes AST nodes, filesystem handles, callbacks, and rendered output.

**`Finding` interface** — 16 fields:

- Identity: `id: FindingId` (branded string), `code: DiagnosticCode` (branded string)
- Origin: `ruleId`, optional `ruleVersion`, `plugin`
- Message: `title` + `description`
- Classification: `severity` (Hint/Info/Warning/Error), `category` (Performance/Accessibility/Correctness/Maintainability/Security)
- Location: `source: SourceReference` (uri + optional path/language), `location: SourceLocation` (start/end positions with 1-based lines/columns, 0-based UTF-16 offsets, half-open: start inclusive, end exclusive)
- Optional: `codeFrame`, `recommendation` (with optional documentation URL), `fix: SuggestedFix` (with `TextEdit[]` and `applicability: "safe" | "unsafe"`), `suggestions: Suggestion[]` (never applied implicitly), `metadata` (JSON-safe escape hatch for plugins)

**Enums**: `FindingCategory` (5 values), `FindingSeverity` (4 values, no Off), `FindingTag` (12 curated tags: BestPractice, Jsx, Styles, Performance, UserExperience, Rendering, Memory, Network, BundleSize, React, ReactNative, Expo), `EstimatedImpact` (Low/Medium/High), `EstimatedFixTime` (UnderFiveMinutes/FiveToFifteenMinutes/OverFifteenMinutes), `PositionEncoding` (Utf16 — matches JavaScript and LSP).

**`createFinding(input)`**: Validates every field — non-empty strings, positive integers for lines/columns, valid non-negative offsets, `end.offset >= start.offset`, all edits have valid ranges — then defensively copies arrays/objects and **deep freezes** the result. Throws `InvalidFindingError` on validation failure.

### `src/rules/engine.ts` — Rule Engine

`runRuleEngine(options)` — the execution harness. For each rule × each parsed source file:

1. **Collect parsed files**: Filters `options.files` to only those with a successfully-parsed `ASTSourceFile` (unparsed files are skipped — rules never see them).
2. **Resolve configuration**: Uses `options.configurations[ruleId]` if provided, otherwise `rule.meta.defaultSeverity` with empty options.
3. **Build context**: Constructs `RuleContext` with all models, configuration, logger, services, and abort signal.
4. **Execute**: Calls `rule.analyze(context)` inside try/catch — a rule crash **isolates to that file** and is recorded as a `RuleEngineFailure` rather than aborting the entire run.
5. **Collect**: Aggregates findings and failures. Checks `signal.aborted` between files for cooperative cancellation.

**`RuleEngineResult`**: Immutable output — `findings`, `failures`, `summary` (rule count, file count, finding count, failure count, total duration, per-rule summaries).

**`formatRuleEngineSummary(summary)`**: Produces a compact terminal string — one header line (`"Rule analysis complete in Xms · N rules · M files · P findings · Q failures"`) followed by one line per rule.

### `src/rules/inline-style.ts` — Inline Style Detection Rule

The **first concrete rule** implementing `Rule`. Two parts:

**Metadata** (`meta`):

- id: `"core/inline-style"`, name: `"Inline style detection"`
- category: Performance, defaultSeverity: Warning, recommended: true
- requiresTypeInformation: false, requiresJSX: true
- tags: [Jsx, Styles, Performance, ReactNative]
- estimatedImpact: Low, estimatedFixTime: UnderFiveMinutes
- supportsAutoFix: false, supportsSuggestions: false
- introducedVersion: "0.1.0"

**Analysis** (`analyze(context)`):

1. Traverses the AST with a visitor on `SyntaxKind.JsxAttribute`
2. For each attribute, `getInlineStyleObject()` checks:
   - Attribute name is `"style"` (found via `visitChildren` looking for `Identifier` with text "style")
   - Initializer is a `JsxExpression` containing an `ObjectLiteralExpression`
   - Returns the object literal node if found, `undefined` otherwise
3. **Current limitations** (documented): object literals inside style arrays are NOT reported; objects returned by functions or stored in variables are NOT followed; the rule does NOT determine whether a component is native
4. `createInlineStyleFinding()` builds a Finding with:
   - Location via `getStartLine`/`getStartColumn`/`getEndLine`/`getEndColumn`
   - Message: "Avoid inline style objects." / "Extract the style into StyleSheet.create() to improve readability and reduce unnecessary object allocations during rendering."
   - Recommendation: "Extract this object into a named style created with StyleSheet.create()."

**Detection pattern**:

```tsx
// ❌ Flagged
<View style={{ flex: 1, padding: 10 }} />

// ✅ Not flagged
<View style={styles.container} />
```

### `src/rules/descriptor.ts` — Rule Descriptor System

Separates **cheap, inspectable metadata** from the rule implementation. Registries, documentation generators, preset resolvers, and IDEs can inspect thousands of rules without importing their implementations. The loader is invoked only by a loading or execution boundary.

**ID format**: `<namespace>/<local-name>` with kebab-case segments. Namespaces may contain `/`, enabling scoped plugins like `@acme/mobile/no-legacy-image`. The final segment is always the local rule name.

**`RuleDescriptor<Options>`**: `id` (branded `RuleId`), `namespace` (branded `RuleNamespace`), `localName` (branded `RuleLocalName`), `metadata: RuleMetadata`, `source: RuleDescriptorSource` (kind: BuiltIn/Plugin/Package, optional name/version), `load: RuleLoader` (a deferred function — `() => Rule | Promise<Rule>`).

**`defineRuleDescriptor(input)`**: Validates the ID format via `parseRuleId()`, validates source (non-built-in requires a name), defensively copies all metadata (arrays, nested objects), deep-freezes the result. **Never invokes `load`.**

**`loadRule(descriptor)`**: Calls the loader and verifies the loaded rule's `meta.id` matches the descriptor's `id` — catches mislabeled plugins. Caching is a future concern; the loader function is the extension point.

### `src/rules/registry-diagnostics.ts` — Registry Validation Types

Structured diagnostics for rule registration problems. **Diagnostics are data, not exceptions** — callers can batch-validate an entire plugin and display every issue at once.

**`RegistryDiagnosticCode` enum**: 8 codes — `DuplicateId`, `DuplicateName`, `InvalidMetadata`, `ReservedNamespace`, `NamespaceConflict`, `VersionConflict`, `DeprecatedRule`, `ConfigurationConflict`.

**`RegistryDiagnostic`**: `code`, `severity` (Information/Warning/Error), `message`, optional `ruleId`/`namespace`/`details` (JSON-safe scalars).

**`createValidationResult(diagnostics)`**: Derives `valid` from the absence of error-severity diagnostics. Returns a frozen `RegistryValidationResult`.

**Error classes**: `RuleRegistryError` (base, carries `code`), `DuplicateRuleError` (carries `ruleId`), `NamespaceConflictError` (carries `namespace`), `MetadataValidationError` (carries multiple `diagnostics`), `RegistryIntegrityError` (for internal index inconsistency — indicates a bug, not user error).

---

## Layer 5: Orchestration & Output (`src/`)

### `src/audit.ts` — End-to-End Audit Pipeline

`runAudit(options?)` — wires together the **full MVP pipeline**:

1. `discoverProject()` → `ProjectModel`
2. `discoverSourceFiles(project)` → `SourceDiscoveryResult`
3. `createASTProject(project, sources.files, { eagerParsing: true })` → parses all files upfront
4. `runRuleEngine({ project, ast, files, rules: [new InlineStyleRule()] })` → findings
5. `reportAudit(...)` → terminal output

Tracks per-phase timing via `performance.now()`. Returns `AuditResult` with exit code:

- `0` = clean (no findings, no failures)
- `1` = diagnostics found (at least one finding)
- `2` = incomplete analysis (rule crashes or parse errors)

**Note**: `audit.ts` is NOT wired into the CLI (`cli.ts`). The CLI currently runs only Phase 1 (discovery) and Phase 2 (scanner). The audit pipeline can be used programmatically via `import { runAudit } from "rn-audit/audit"`.

### `src/reporters/console.ts` — Terminal Reporter

`reportAudit(input, write?)` — pure formatting function with no side effects beyond calling `write(line)` (defaults to `console.log`, injectable for testing).

Output structure:

1. **Header**: Project name, file count
2. **Findings**: Grouped by `FindingCategory` (Performance, Accessibility, etc.). Each finding printed with `⚠ title`, file location (`path:line:column`), description, and recommendation.
3. **Failures** (if any): Parse failures count, rule failures with per-failure details (`ruleId`, `filePath`, `error.message`)
4. **Summary**: File count, rule count, diagnostic count, parse errors, rule failures, per-phase timing (Discovery, Scanner, AST, Rules, Total), scanner warnings count

Uses a Unicode box-drawing divider (`"━".repeat(42)`) for visual separation.

### `src/cli.ts` — CLI Entry Point

Uses **Commander** to define the `rn-audit` binary. Declares:

- `-v, --version` — prints version (injected at build time via tsup `define`)
- `-h, --help` — prints help with examples

The **default action** (no subcommand) runs Phase 1 + Phase 2 only:

1. `discoverProject()` → prints project summary (name, version, root, framework, workflow, Expo Router status, RN/Expo/TypeScript versions, package manager, config file count)
2. `discoverSourceFiles(project)` → prints file counts (analyzable, ignored, total), traversal time, and extension breakdown

Error handling:

- `DiscoveryError` instances → clean error message with directory context, exit code 2
- Unexpected errors → re-thrown for full stack trace (aids debugging)

**Important**: Does NOT yet call `runAudit()` or the rule engine. The full audit pipeline (`audit.ts`) exists but the CLI's default action hasn't been updated to include Phase 3 (rule engine). This is the integration gap between the CLI and the rule system.

### `src/index.ts` — Public API Barrel

The **programmatic entry point** (`"main"` in package.json, `"exports"` field). Re-exports everything a consumer needs without pulling in CLI-specific dependencies (Commander, chalk, ora):

- Discovery: `discoverProject`, all error classes, `ProjectModel`, `ConfigFiles`, `DependencyMap`, `DiscoveryOptions`
- Scanner: `discoverSourceFiles`, `FileModel`, `SourceDiscoveryResult`, `FileExtension`
- AST: `createASTProject`, `SyntaxKind`, visitor primitives, domain queries, `ParseErrorCollector`, `ParseErrorCode`
- Rules: `Rule`, `RuleMetadata`, `RuleContext`, `RuleSeverity`, `RuleCategory`, `RuleEngineOptions`, `RuleEngineResult`
- Findings: `createFinding`, `Finding`, `FindingSeverity`, `FindingCategory`, `FindingTag`, `EstimatedImpact`, `EstimatedFixTime`
- Rule Engine: `runRuleEngine`, `formatRuleEngineSummary`
- Built-in rules: `InlineStyleRule`, `INLINE_STYLE_RULE_ID`

This separation from `cli.ts` ensures programmatic consumers (IDE extensions, CI scripts, other tools) don't pull in terminal-specific dependencies unnecessarily.

---

## Build Configuration

### `tsup.config.ts`

Uses **tsup** (esbuild-based bundler) with:

- Two entry points: `cli.ts` (binary with Node shebang) and `index.ts` (public API with type declarations)
- Output: ESM only (`format: ["esm"]`), target node18
- No code splitting (`splitting: false`) — self-contained files per entry
- Source maps enabled for readable stack traces
- `clean: true` — wipes `dist/` before each build
- `banner: { js: "#!/usr/bin/env node" }` — makes `dist/cli.js` directly executable
- `define: { RN_AUDIT_VERSION: ... }` — build-time constant injection (avoids reading package.json at runtime)
- Dependencies externalized (`commander`, `chalk`, `ora`, `cli-table3`, `ts-morph` — though the last one gets bundled into the ESM output since it's a dependency)

### `tsconfig.json`

- Target: ES2022, module: ESNext, moduleResolution: bundler
- Strict mode with `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
- `noEmit: true` — tsc is for type-checking only; tsup handles bundling
- `declaration: true` + `declarationMap: true` — tsup uses these for `.d.ts` generation

---

## Data Flow Summary

```
User runs: rn-audit
              │
              ▼
    ┌─────────────────────┐
    │   src/cli.ts         │  Commander parses argv, calls default action
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │   discovery/index.ts │  discoverProject()
    │                      │  → ProjectModel
    │   • root-finder.ts   │    (root, framework, versions, deps, configs)
    │   • validator.ts     │
    │   • type-detector.ts │
    │   • config-finder.ts │
    │   • metadata.ts      │
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │   scanner/index.ts   │  discoverSourceFiles(project)
    │                      │  → SourceDiscoveryResult
    │   • file-walker.ts   │    (active FileModel[], ignored FileModel[], stats)
    │   • ignore-resolver  │
    │   • workspace-resolv │
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │   ast/project.ts     │  createASTProject(project, files)
    │                      │  → ASTProject (ts-morph wrapper)
    │   • source-file.ts   │    (parsed AST for each file)
    │   • visitors.ts      │
    │   • queries.ts       │
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │   rules/engine.ts    │  runRuleEngine({ project, ast, files, rules })
    │                      │  → RuleEngineResult
    │   • inline-style.ts  │    (findings[], failures[], summary)
    │   • finding.ts       │
    │   • types.ts         │
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │ reporters/console.ts │  reportAudit(...)
    │                      │  → terminal output (grouped by category)
    └─────────────────────┘
```

---

## Current Status & Integration Gap

The CLI (`cli.ts`) currently runs only **Phase 1 (Discovery)** and **Phase 2 (Scanner)**. The full pipeline including the AST engine and rule engine is implemented in `src/audit.ts` but is **not yet wired into the CLI's default action**. The `InlineStyleRule` is fully implemented and tested — it can detect inline style objects — but you need to call `runAudit()` programmatically (or wire it into the CLI) to actually run it.
