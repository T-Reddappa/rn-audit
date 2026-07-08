import { Command } from "commander";
import { discoverProject, DiscoveryError } from "./discovery/index.js";
import { discoverSourceFiles } from "./scanner/index.js";
import type { ProjectModel } from "./types/project.js";

/**
 * Build-time constant injected by tsup.
 *
 * In tsup.config.ts, the `define` option replaces every occurrence of
 * `RN_AUDIT_VERSION` with the actual version string from package.json.
 * This is declared here so TypeScript knows about it during type-checking.
 * The `declare` keyword tells TypeScript: "trust me, this exists at runtime."
 * esbuild strips this declaration from the output; only the usage remains.
 */
declare const RN_AUDIT_VERSION: string;

const program = new Command();

program
  .name("rn-audit")
  .description(
    "Static analysis and performance auditing for React Native and Expo projects",
  )
  .version(RN_AUDIT_VERSION, "-v, --version", "Output the current version")
  .helpOption("-h, --help", "Display help information")
  .addHelpText(
    "after",
    `
Examples:
  $ rn-audit                    Run a full audit
  $ rn-audit --help             Show help
  $ rn-audit --version          Print version

Documentation: https://github.com/treddappa/rn-audit
`,
  );

/**
 * Default behavior: discover the project and print a summary.
 *
 * Pipeline (Milestone 1.1):
 * 1. findProjectRoot — walk up from cwd to find the RN/Expo root
 * 2. validateProject — verify it's a supported project type
 * 3. detectProjectType — classify the project framework and workflow
 * 4. discoverConfigFiles — find all known config files
 * 5. extractMetadata — read versions, deps, and package manager
 * 6. Assemble and return the ProjectModel
 *
 * Future milestones will feed this model into the scanner, parser,
 * and rule engine.
 */
program.action(() => {
  try {
    // --- Phase 1: Project Discovery ---
    const project: ProjectModel = discoverProject();

    console.log(`rn-audit initialized successfully.\n`);
    console.log(`  Project: ${project.name}@${project.version}`);
    console.log(`  Root: ${project.root}`);
    console.log(`  Framework: ${project.framework}`);
    if (project.workflow) {
      console.log(`  Workflow: ${project.workflow}`);
    }
    if (project.hasExpoRouter) {
      console.log("  Expo Router: yes");
    }
    if (project.reactNativeVersion) {
      console.log(`  React Native: ${project.reactNativeVersion}`);
    }
    if (project.expoVersion) {
      console.log(`  Expo SDK: ${project.expoVersion}`);
    }
    if (project.typescriptVersion) {
      console.log(`  TypeScript: ${project.typescriptVersion}`);
    }
    console.log(`  Package manager: ${project.packageManager}`);
    console.log(`  Config files found: ${countConfigFiles(project)}`);

    // --- Phase 2: Source Discovery ---
    const sourceResult = discoverSourceFiles(project);

    console.log(`\n  Source files:`);
    console.log(`    Analyzable: ${sourceResult.files.length}`);
    console.log(`    Ignored:    ${sourceResult.ignored.length}`);
    console.log(`    Total:      ${sourceResult.files.length + sourceResult.ignored.length}`);
    console.log(`    Traversal:  ${sourceResult.traversalTimeMs}ms`);

    // Show extension breakdown
    const extCounts = countByExtension(sourceResult.files);
    if (Object.keys(extCounts).length > 0) {
      const breakdown = Object.entries(extCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([ext, count]) => `${ext}: ${count}`)
        .join(", ");
      console.log(`    Extensions: ${breakdown}`);
    }
  } catch (error) {
    if (error instanceof DiscoveryError) {
      // User-facing error: the project is not valid or not supported.
      // Print a clean error message without a stack trace.
      console.error(`\nError: ${error.message}`);
      console.error(`  Directory: ${error.directory}`);
      console.error("\nRun `rn-audit --help` for usage information.");
      process.exit(2);
    }

    // Unexpected error: re-throw so Node.js prints the full stack trace.
    // This helps with debugging and bug reports.
    throw error;
  }
});

/**
 * Count how many configuration files were discovered.
 * Quick summary for the terminal output.
 */
function countConfigFiles(project: ProjectModel): number {
  const { configFiles } = project;
  let count = 0;
  for (const value of Object.values(configFiles)) {
    if (value !== null) count++;
  }
  return count;
}

/**
 * Count files by extension for terminal display.
 */
function countByExtension(files: Array<{ extension: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) {
    counts[file.extension] = (counts[file.extension] ?? 0) + 1;
  }
  return counts;
}

// Parse command-line arguments.
// program.parse() defaults to process.argv when called with no arguments.
program.parse();
