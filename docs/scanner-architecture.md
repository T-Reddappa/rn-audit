# Scanner Architecture

> Milestone 1.3 — Production Hardening
> Last updated: 2026-07-08

---

## Overview

The scanner subsystem discovers every source file in a React Native / Expo project that should be analyzed. It is the bridge between the filesystem and the analysis pipeline.

```
ProjectModel → discoverSourceFiles() → SourceDiscoveryResult
                                            ├── files: FileModel[]     (active)
                                            ├── ignored: FileModel[]   (excluded)
                                            ├── warnings: Error[]      (non-fatal)
                                            └── stats: timing + counts
```

---

## Module Map

```
src/scanner/
├── index.ts              Orchestrator: wires modules together
├── file-walker.ts        Recursive directory traversal
├── ignore-resolver.ts    .gitignore parsing and pattern matching
├── workspace-resolver.ts Monorepo workspace detection (npm/yarn/pnpm)
├── constants.ts          Shared constants (always-ignored dirs, limits)
├── errors.ts             Typed error hierarchy
├── types.ts              Extension point interfaces
└── (future) cache.ts     File metadata cache for incremental scans
```

---

## Lifecycle

### 1. Cold Scan (first run, no cache)

```
discoverSourceFiles(project)
  │
  ├─ 1. createIgnorePredicate(project.root)
  │     Reads .gitignore at project root
  │     Compiles patterns to regex
  │     Returns: (absPath) => [boolean, reason]
  │
  ├─ 2. resolveWorkspaces(project.root)
  │     Detects tool (npm/yarn/pnpm), extracts patterns
  │     Resolves globs → directories → validates package.json
  │     Returns: WorkspacePackage[]
  │
  ├─ 3. For each workspace package:
  │     walkSourceFiles({ projectRoot, isIgnored, ... })
  │       ├─ walk(dir, depth)
  │       │   ├─ readdirSync(dir) → entries
  │       │   ├─ For each entry:
  │       │   │   ├─ Directory → prune if always-ignored, else recurse
  │       │   │   ├─ Symlink → resolve, check loop, follow or skip
  │       │   │   └─ File → check extension → stat → check ignore → FileModel
  │       │   └─ Track: filesFound, filesAccepted, errors, symlinksFollowed
  │       └─ Return [FileModel[], WalkStatistics]
  │
  ├─ 4. Deduplicate by absolute path
  │
  ├─ 5. Partition → active + ignored
  │
  └─ 6. Return SourceDiscoveryResult
```

### 2. Warm Scan (with cache — Phase 2)

Same as cold scan, but:

- File metadata (size, mtime) is cached per absolute path
- Files with unchanged mtime skip stat() and ignore checks
- Cache is invalidated when .gitignore changes (tracked via mtime)

### 3. Incremental Scan (watch mode — Phase 3)

Same as warm scan, plus:

- File watcher notifies of changes (fs.watch / chokidar)
- Only changed files are re-scanned
- New files are discovered, deleted files are pruned
- Result is diffed against previous scan

---

## Error Handling

### Error Classification

| Severity    | Error Types                                                                                       | Action                               |
| ----------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Fatal**   | `TraversalLimitError` (no onWarning callback)                                                     | Abort scan                           |
| **Warning** | `PermissionDeniedError`, `BrokenSymlinkError`, `InvalidWorkspaceError`, `UnsupportedPatternError` | Continue scan, collect in warnings[] |
| **Silent**  | `FileNotFoundError` (TOCTOU race)                                                                 | Skip file, no warning                |

### Error Flow

```
walkSourceFiles()
  │
  ├─ readdirSync() fails (EACCES)
  │   → PermissionDeniedError
  │   → onWarning(error)
  │   → stats.errors++
  │   → continue (skip this directory)
  │
  ├─ symlink target missing (ENOENT)
  │   → BrokenSymlinkError
  │   → onWarning(error)
  │   → stats.errors++
  │   → continue (skip this symlink)
  │
  └─ stat() fails (ENOENT on file)
      → Silently skip (TOCTOU race)
      → No warning, no error increment
```

---

## Performance Characteristics

### Time Complexity

| Operation           | Complexity     | Notes                                                                         |
| ------------------- | -------------- | ----------------------------------------------------------------------------- |
| Directory traversal | O(D + F)       | D = directories visited, F = files found                                      |
| Per-file stat       | O(1)           | One stat call per source file                                                 |
| Ignore predicate    | O(P) per file  | P = number of patterns (~10-50); compiled regex is O(n) where n = path length |
| Overall             | O(F × (1 + P)) | Linear in file count × pattern count                                          |

### Memory

| Data structure             | Size for 10,000 files      |
| -------------------------- | -------------------------- |
| FileModel[] (active)       | ~2 MB (200 bytes each)     |
| FileModel[] (ignored)      | ~200 KB                    |
| Ignore patterns (compiled) | ~10 KB (50 regex patterns) |
| WalkStatistics             | ~100 bytes                 |
| **Total**                  | **~2.5 MB**                |

### Bottleneck: stat() calls

`statSync()` is the most expensive operation per file (system call overhead). For 10,000 source files, that's 10,000 stat calls. Each call is ~0.01ms on SSD, so the total is ~100ms.

The cache (Phase 2) eliminates stat() for unchanged files, reducing warm-scan time to O(changed files) instead of O(total files).

### Bottleneck: readdir() for large directories

A directory with 10,000 files (e.g., a flat `components/` directory) takes longer to read than 1,000 directories with 10 files each. This is a filesystem characteristic, not something we can optimize — but we document it so users understand deep trees are faster than wide directories.

---

## Extension Points

### Adding a new workspace tool

1. Implement `WorkspaceResolver` interface
2. Register in the workspace resolver chain
3. No scanner core changes needed

### Adding a custom ignore file (.rnauditignore)

1. Add `".rnauditignore"` to `IGNORE_FILE_NAMES` in `constants.ts`
2. The ignore resolver already handles any file name in that list
3. No logic changes needed

### Adding a new supported file extension

1. Add the extension to `SOURCE_EXTENSIONS` in `constants.ts`
2. Add it to the `SUPPORTED_EXTENSIONS` set in `src/types/file.ts`
3. Add it to the `FileExtension` union type in `src/types/file.ts`
4. Update the parser (future milestone) to handle the new extension
5. No scanner logic changes needed

### Cloud scanning (Phase 4)

1. Implement `FileSystemProvider` backed by a remote API
2. Inject the custom provider into the file walker
3. The walker doesn't know whether files are local or remote

---

## Engineering Review

### Architecture: 8/10

**Strengths:**

- Clear module boundaries: each module has a single, well-defined responsibility
- Dependency inversion: the walker depends on injected `isIgnored` predicate, not on the ignore resolver
- Extension points designed for future plugins without core changes
- Data flow is unidirectional: `ProjectModel → scanner → SourceDiscoveryResult`

**Deductions (-2):**

- The workspace resolver has its own glob resolution logic that partially overlaps with the ignore resolver's pattern matching. These could share a common "glob-to-regex" utility. Justification: the glob syntax for workspaces is simpler than gitignore (no negation, no anchoring), so merging them would add complexity without benefit until Phase 2.
- The `maxFileCount` safety limit is tracked but the counter is the `files.length` which includes ignored files. A project with 500K source files + 500K ignored files wouldn't trigger the limit correctly. Fix: count files before ignore filtering.

### Maintainability: 8/10

**Strengths:**

- Shared constants extracted to a single module (DRY fixed)
- Typed error hierarchy means callers don't parse error messages
- Clear JSDoc on every public function
- Statistics tracking enables debugging ("why is my scan slow?")

**Deductions (-2):**

- The gitignore pattern compiler (`globToRegex`) is 60+ lines of character-by-character state machine. It's well-tested through integration tests but hard to read. A comment explaining the state machine states would improve maintainability.
- Nested helper functions in `walkSourceFiles` (the `walk` and `processFile` closures) make the function long (~150 lines). Extracting these to module-level functions would improve testability, but the closures capture `options` for performance (no argument passing).

### Performance: 7/10

**Strengths:**

- Eager directory pruning eliminates ~95% of traversal work
- `readdirSync` with `withFileTypes: true` avoids per-entry `stat` calls
- Compiled regex patterns make ignore checks O(path length)
- Sync operations are fast for Node.js CLI tools (no event loop overhead)

**Deductions (-3):**

- No caching yet (Phase 2). Cold scans re-stat every file every time.
- Single-threaded. 100K files means 100K sequential operations. Worker threads would parallelize but TS Compiler API (next milestone) is sync.
- `statSync` is called for every file even when the file's mtime hasn't changed since the last scan. A lightweight in-memory check against a previous scan would help.

### Testability: 8/10

**Strengths:**

- Most functions are pure (input → output) with no hidden state
- Dependency injection (ignore predicate) makes unit testing trivial
- Fixture-based tests create real directory structures for integration coverage
- Error classes are testable in isolation

**Deductions (-2):**

- The file walker's deeply nested `walk()` function is hard to unit test in isolation (it's a closure). Extracting it would enable testing the traversal logic without a real filesystem.
- No snapshot tests for scan output format. Adding these would catch regressions in FileModel structure.

### Extensibility: 9/10

**Strengths:**

- Five well-defined extension point interfaces (FileSystemProvider, IgnoreRuleProvider, WorkspaceResolver, FileFilter, ProgressReporter)
- Workspace tools are detected via a pluggable chain (even if Phase 1 only has one resolver)
- Config file patterns are data-driven (add to array, no logic change)

**Deductions (-1):**

- Extension points are designed but not yet usable from outside the package. Phase 2 needs a plugin loader to discover and instantiate implementations.

### Readability: 8/10

**Strengths:**

- Consistent naming: all scanner modules are kebab-case, functions are camelCase, types are PascalCase
- JSDoc on every exported function explains "what," "why," and "when to use"
- Error messages are complete sentences (not error codes) for easy debugging

**Deductions (-2):**

- The `globToRegex` function is dense regex-generation code. A few inline comments would help.
- Some functions use numeric constants inline (e.g., depth limit checks). These are now in `constants.ts`.

### Open-Source Readiness: 8/10

**Strengths:**

- Apache 2.0 license
- Comprehensive test suite with stress/benchmark coverage
- Architecture documentation (this file)
- Clear contribution path (extension points are documented)

**Deductions (-2):**

- No CONTRIBUTING.md section specific to the scanner (planned for project-wide CONTRIBUTING.md)
- No changelog entries yet (project is pre-release)

### Overall: 8.0/10

A solid production foundation. The primary gaps (caching, incremental scanning, plugin loader) are explicitly deferred to Phase 2 — they are not oversights, they are roadmap items.

---

## Recommendations (Post-Phase-1)

1. **Extract `walk()` closure** to a module-level function with explicit parameters. Enables unit testing the traversal algorithm without a filesystem.
2. **Add snapshot tests** for SourceDiscoveryResult on a known fixture project. Catches regressions in FileModel structure.
3. **Implement file metadata cache** (Phase 2) to eliminate redundant `stat()` calls on warm scans.
4. **Add a `maxFileCount` safety check** that counts files BEFORE ignore filtering, not after.
5. **Document the `globToRegex` state machine** with inline state labels for the character-by-character parser.
6. **Implement the `.rnauditignore` file** support by adding one entry to `IGNORE_FILE_NAMES` in constants.ts.
