/**
 * Scanner Constants
 *
 * Shared constants used across the scanner subsystem. Centralized here
 * to prevent duplication between the file walker and ignore resolver.
 *
 * ## When to add a constant here
 *
 * If the same value is used in two or more scanner modules, it belongs
 * here. Single-use constants should stay in their consuming module to
 * avoid unnecessary coupling.
 *
 * @module scanner/constants
 */

// ---------------------------------------------------------------------------
// Always-ignored directories
// ---------------------------------------------------------------------------

/**
 * Directories that the scanner never enters during traversal.
 *
 * These are pruned at the directory level — the scanner doesn't even
 * call `readdir` on them. This is the single biggest performance
 * optimization in the scanner.
 *
 * Each entry is the directory name (not path). A match against any
 * path segment triggers exclusion.
 *
 * | Directory | Why excluded |
 * |-----------|-------------|
 * | `node_modules` | Dependencies (10K–100K files) — not project source |
 * | `.git` | Git internals — binary objects and refs |
 * | `dist` | Build output — generated, not authored |
 * | `build` | Alternative build output directory |
 * | `coverage` | Code coverage reports — auto-generated HTML/JSON |
 * | `ios` | Xcode project — Obj-C/Swift, not JS/TS |
 * | `android` | Android project — Java/Kotlin, not JS/TS |
 * | `.expo` | Expo cache and build artifacts |
 * | `.next` | Next.js build output (monorepo with web target) |
 */
export const ALWAYS_IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "ios",
  "android",
  ".expo",
  ".next",
]);

// ---------------------------------------------------------------------------
// Source file extensions
// ---------------------------------------------------------------------------

/**
 * File extensions the scanner recognizes as source code.
 *
 * Used by the file walker for extension filtering.
 * Also re-exported from {@link ../types/file.ts} for the type system.
 *
 * Future: `.mts`, `.cts`, `.mjs`, `.cjs`
 */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".tsx", ".js", ".jsx"]);

// ---------------------------------------------------------------------------
// Safety limits
// ---------------------------------------------------------------------------

/**
 * Maximum directory depth for recursive traversal.
 *
 * Prevents infinite recursion from circular symlinks or pathological
 * directory structures. A depth of 50 accommodates deeply nested
 * `node_modules` (which can reach 20+ levels) with a generous margin.
 */
export const MAX_TRAVERSAL_DEPTH = 50;

/**
 * Maximum number of files the scanner will process in a single run.
 *
 * A safety limit to prevent memory exhaustion on extremely large
 * projects or accidentally scanning `/`. 500,000 files is well above
 * any realistic React Native project.
 */
export const MAX_FILE_COUNT = 500_000;

/**
 * Maximum symlink resolution depth.
 *
 * Prevents infinite loops from circular symlinks. Each symlink
 * resolution step increments a counter; when this limit is hit,
 * the symlink is treated as broken.
 */
export const MAX_SYMLINK_DEPTH = 20;

// ---------------------------------------------------------------------------
// Ignore file names
// ---------------------------------------------------------------------------

/**
 * File names recognized as ignore rule sources.
 *
 * These files are parsed for patterns during traversal. They are
 * checked at each directory level — a `.gitignore` in a subdirectory
 * applies to files in that directory and below.
 *
 * Future: `.rnauditignore` for rn-audit-specific ignore rules that
 * supplement or override `.gitignore`.
 */
export const IGNORE_FILE_NAMES: readonly string[] = [".gitignore"];
