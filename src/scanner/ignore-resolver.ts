/**
 * Ignore Resolver
 *
 * Determines whether a file should be excluded from analysis based on
 * three layers of ignore rules:
 *
 * 1. **Hardcoded directories** — Well-known directories that are never
 *    source code: `node_modules`, `.git`, `dist`, `build`, `coverage`,
 *    `ios`, `android`, `.expo`, `.next`.
 *
 * 2. **.gitignore files** — The project's existing gitignore rules.
 *    Parsed at the project root and any nested `.gitignore` files found
 *    during traversal. Most React Native projects already configure
 *    `.gitignore` to exclude generated code and build artifacts.
 *
 * 3. **Future: .rnauditignore** — rn-audit-specific ignore patterns
 *    that override or supplement `.gitignore`. Designed but not
 *    implemented in Phase 1.
 *
 * ## Pattern matching
 *
 * Gitignore patterns use a glob-like syntax with special rules:
 * - `*` matches anything except `/`
 * - `?` matches a single character except `/`
 * - `**` matches zero or more directories (including nested)
 * - Patterns without `/` match at any directory depth
 * - Patterns starting with `/` are anchored to the gitignore file's directory
 * - Patterns ending with `/` match only directories
 * - `!` prefix negates a previous matching pattern
 *
 * ## Precedence
 *
 * 1. Hardcoded directories (cannot be overridden by .gitignore)
 * 2. .gitignore patterns (later rules override earlier; nested .gitignore
 *    overrides parent for files in that subtree)
 * 3. Future: .rnauditignore
 * 4. Future: config `exclude` patterns
 *
 * @module scanner/ignore-resolver
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, dirname, sep, join } from "node:path";
import { ALWAYS_IGNORED_DIRECTORIES, IGNORE_FILE_NAMES } from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single compiled gitignore pattern, ready for efficient matching.
 */
interface CompiledPattern {
  /** The original pattern text (for debugging and `ignoreReason`). */
  original: string;

  /** Compiled regular expression for matching file paths. */
  regex: RegExp;

  /** Whether this is a negation pattern (starts with `!`). */
  negated: boolean;

  /** Whether this only matches directories (ends with `/`). */
  directoryOnly: boolean;

  /** The directory this pattern is relative to (the .gitignore location). */
  source: string;

  /** Line number in the source .gitignore file (for debugging). */
  lineNumber: number;
}

/**
 * A collection of compiled patterns from a .gitignore file.
 */
interface IgnoreFile {
  /** Path to the .gitignore file. */
  path: string;

  /** Directory the .gitignore applies to. */
  directory: string;

  /** Compiled patterns in order of appearance. */
  patterns: CompiledPattern[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a predicate that tests whether a file path should be ignored.
 *
 * The returned function is called for every file during traversal. It
 * checks:
 * 1. Is the file in an always-ignored directory?
 * 2. Does any .gitignore pattern match?
 *
 * The predicate also returns the reason for ignoring (if applicable),
 * which is stored in the FileModel for debugging.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns A function that tests a file path and returns `[shouldIgnore, reason]`.
 *
 * @example
 * ```typescript
 * const isIgnored = createIgnorePredicate("/path/to/project");
 * const [shouldIgnore, reason] = isIgnored("/path/to/project/src/App.tsx");
 * ```
 */
export function createIgnorePredicate(
  projectRoot: string,
): (absolutePath: string) => [boolean, string | undefined] {
  // Parse .gitignore at the project root
  const rootIgnore = parseIgnoreFile(projectRoot);

  // Cache for nested .gitignore files parsed on-demand during traversal
  const nestedIgnores = new Map<string, IgnoreFile | null>();

  /**
   * The ignore predicate. Called for every file during traversal.
   */
  return function isIgnored(
    absolutePath: string,
  ): [boolean, string | undefined] {
    const relativePath = relative(projectRoot, absolutePath);

    // --- Check 1: Always-ignored directories ---
    // Split the relative path into segments and check each segment
    // against the always-ignored set. This catches files at any depth
    // within these directories.
    const segments = relativePath.split(sep);
    for (const segment of segments) {
      if (ALWAYS_IGNORED_DIRECTORIES.has(segment)) {
        return [true, `${segment} (built-in)`];
      }
    }

    // --- Check 2: Root .gitignore patterns ---
    if (rootIgnore) {
      const matched = matchPatterns(relativePath, rootIgnore.patterns);
      if (matched) {
        return [true, `.gitignore:${matched.original} (line ${matched.lineNumber})`];
      }
    }

    // --- Check 3: Nested .gitignore patterns ---
    // Walk up from the file's directory to the project root, checking
    // for nested .gitignore files at each level.
    let currentDir = dirname(absolutePath);
    while (currentDir.startsWith(projectRoot) && currentDir !== projectRoot) {
      // Check cache first
      let nestedIgnore = nestedIgnores.get(currentDir);
      if (nestedIgnore === undefined) {
        nestedIgnore = parseIgnoreFile(currentDir);
        nestedIgnores.set(currentDir, nestedIgnore);
      }

      if (nestedIgnore) {
        // Make the path relative to the nested .gitignore's directory
        const relToNested = relative(nestedIgnore.directory, absolutePath);
        const matched = matchPatterns(relToNested, nestedIgnore.patterns);
        if (matched) {
          return [
            true,
            `${nestedIgnore.path}:${matched.original} (line ${matched.lineNumber})`,
          ];
        }
      }

      currentDir = dirname(currentDir);
    }

    // --- Not ignored ---
    return [false, undefined];
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a `.gitignore` file if it exists at the given directory.
 *
 * Returns `null` if no `.gitignore` file exists at that location.
 * Returns an `IgnoreFile` with compiled patterns otherwise.
 *
 * @param directory - Directory to look for `.gitignore` in.
 * @returns Parsed ignore file or null.
 */
function parseIgnoreFile(directory: string): IgnoreFile | null {
  // Check each supported ignore file name
  for (const fileName of IGNORE_FILE_NAMES) {
    const filePath = join(directory, fileName);

    if (!existsSync(filePath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      // Permission denied or other read error — skip this ignore file
      return null;
    }

    return {
      path: filePath,
      directory,
      patterns: parseIgnoreContent(content, directory, filePath),
    };
  }

  return null;
}

/**
 * Parse the content of a .gitignore file into compiled patterns.
 *
 * Each non-empty, non-comment line becomes a CompiledPattern.
 * Lines are processed in order; later patterns override earlier ones
 * (via negation or more specific matching).
 */
function parseIgnoreContent(
  content: string,
  _directory: string,
  filePath: string,
): CompiledPattern[] {
  const patterns: CompiledPattern[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    let line = lines[i]!;

    // Remove trailing whitespace (gitignore spec: trailing spaces are
    // ignored unless escaped with backslash)
    line = line.replace(/(?<!\\)\s+$/, "");

    // Skip blank lines and comments
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    // Detect negation
    const negated = line.startsWith("!");
    if (negated) {
      line = line.slice(1);
    }

    // Detect directory-only patterns (trailing `/`)
    const directoryOnly = line.endsWith("/");
    if (directoryOnly) {
      line = line.slice(0, -1);
    }

    // Skip empty patterns after stripping modifiers
    if (line.length === 0) continue;

    // Convert gitignore glob pattern to regex
    const regex = globToRegex(line);

    patterns.push({
      original: (negated ? "!" : "") + line + (directoryOnly ? "/" : ""),
      regex,
      negated,
      directoryOnly,
      source: filePath,
      lineNumber,
    });
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Test a relative path against a list of compiled patterns.
 *
 * Patterns are evaluated in order. The last matching pattern determines
 * the outcome — this is gitignore's "last match wins" semantics.
 *
 * Algorithm:
 * - Walk patterns in forward order.
 * - If a non-negated pattern matches → remember it as the current result.
 * - If a negated pattern matches → clear the current result (un-ignore).
 * - After all patterns are evaluated, the last remembered match wins.
 * - If no pattern matched, or the last match was negated, the file is NOT ignored.
 *
 * @returns The matching pattern that caused the file to be ignored,
 *   or null if the file is not ignored.
 */
function matchPatterns(
  relativePath: string,
  patterns: CompiledPattern[],
): CompiledPattern | null {
  let lastMatch: CompiledPattern | null = null;

  for (const pattern of patterns) {
    if (pattern.regex.test(relativePath)) {
      if (pattern.negated) {
        // Negation cancels any previous match for this path
        lastMatch = null;
      } else {
        // Non-negated pattern becomes the current result
        lastMatch = pattern;
      }
    }
  }

  return lastMatch;
}

// ---------------------------------------------------------------------------
// Glob to regex conversion
// ---------------------------------------------------------------------------

/**
 * Convert a gitignore glob pattern to a regular expression.
 *
 * Gitignore glob syntax differs from standard glob in subtle ways:
 * - `*` matches anything except `/` (path separator)
 * - `?` matches a single character except `/`
 * - `**` matches zero or more directories (including nested)
 * - Patterns without `/` match at any directory depth
 * - Patterns with `/` (not at start/end) are anchored to the pattern's
 *   containing directory
 *
 * @param pattern - A single gitignore pattern (modifiers already stripped).
 * @returns A compiled RegExp that tests file paths against the pattern.
 */
function globToRegex(pattern: string): RegExp {
  // Determine if the pattern contains a path separator (anchored pattern)
  // A pattern with a slash (except trailing slash, already stripped) is
  // anchored — it matches relative to the .gitignore location.
  const hasSlash =
    pattern.includes("/") ||
    (pattern.startsWith("/") && pattern.length > 1);

  // Build the regex string
  let regexStr = "";

  // If the pattern doesn't contain a slash, it can match at any depth.
  // We prepend an optional path prefix.
  if (!hasSlash && !pattern.startsWith("**/")) {
    regexStr += "(^|.*/)";
  }

  // If the pattern starts with **/, it matches at any depth including root.
  // The `(.*/)?` allows the match at any directory depth.
  if (pattern.startsWith("**/")) {
    regexStr += "(.*/)?";
    pattern = pattern.slice(3);
  }

  // Process the pattern character by character
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;

    switch (ch) {
      case "*": {
        // Check for ** (globstar)
        if (pattern[i + 1] === "*") {
          // **/ or /** — matches zero or more path segments
          if (
            pattern[i + 2] === "/" ||
            (pattern[i + 2] === undefined && i === pattern.length - 2)
          ) {
            regexStr += ".*";
            i += 2;
            // If followed by /, consume it and optionally match a leading /
            if (pattern[i] === "/") {
              regexStr += "/?";
              i += 1;
            }
            break;
          }
        }
        // Single * — matches anything except /
        regexStr += "[^/]*";
        i += 1;
        break;
      }

      case "?": {
        // Single character except /
        regexStr += "[^/]";
        i += 1;
        break;
      }

      case ".":
      case "(":
      case ")":
      case "+":
      case "^":
      case "$":
      case "|":
      case "{":
      case "}":
      case "[":
      case "]":
      case "\\": {
        // Escape regex special characters
        regexStr += "\\" + ch;
        i += 1;
        break;
      }

      case "/": {
        // Path separator — match platform separator
        regexStr += "/";
        i += 1;
        break;
      }

      default: {
        regexStr += ch;
        i += 1;
        break;
      }
    }
  }

  // Anchor: match the entire path segment
  // If the pattern ends with something that already acts as an anchor
  // (like .* from **), we don't need the full $ anchor.
  if (!regexStr.endsWith(".*")) {
    regexStr += "$";
  }

  return new RegExp(regexStr);
}
