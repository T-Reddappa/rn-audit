import { Command } from "commander";
import { resolve } from "node:path";
import { runAudit } from "./audit.js";
import { DiscoveryError } from "./discovery/index.js";

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
  .description("Static analysis and performance auditing for React Native and Expo projects")
  .version(RN_AUDIT_VERSION, "-v, --version", "Output the current version")
  .helpOption("-h, --help", "Display help information")
  .argument("[path]", "Project directory to audit", ".")
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
program.action(async (projectPath: string) => {
  try {
    const result = await runAudit({ cwd: resolve(projectPath) });
    process.exitCode = result.exitCode;
  } catch (error) {
    if (error instanceof DiscoveryError) {
      // User-facing error: the project is not valid or not supported.
      // Print a clean error message without a stack trace.
      console.error(`\nError: ${error.message}`);
      console.error(`  Directory: ${error.directory}`);
      console.error("\nRun `rn-audit --help` for usage information.");
      process.exitCode = 2;
      return;
    }

    // Unexpected error: re-throw so Node.js prints the full stack trace.
    // This helps with debugging and bug reports.
    throw error;
  }
});

// Parse command-line arguments.
// program.parse() defaults to process.argv when called with no arguments.
await program.parseAsync();
