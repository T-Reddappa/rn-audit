import { Command } from "commander";
import { resolve } from "node:path";
import chalk from "chalk";
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
  .option("--verbose", "Show every finding location (default shows condensed summary)")
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
 * Print a progress message to stderr.
 *
 * When stderr is a TTY (interactive terminal), each phase overwrites the
 * previous one on the same line using ANSI escape codes, giving a clean
 * inline-progress effect without a spinner dependency.
 *
 * When stderr is piped or redirected, each phase prints on its own line
 * so the output remains readable in logs and CI.
 */
function progress(label: string): void {
  const text = chalk.dim(`  ${label}...`);
  if (process.stderr.isTTY) {
    process.stderr.write(`\x1b[2K\r${text}`);
  } else {
    process.stderr.write(`${text}\n`);
  }
}

/** Clear the progress line (TTY only — no-op when piped). */
function progressDone(): void {
  if (process.stderr.isTTY) {
    process.stderr.write(`\x1b[2K\r`);
  }
}

program.action(async (projectPath: string, options: { verbose?: boolean }) => {
  try {
    const result = await runAudit({
      cwd: resolve(projectPath),
      verbose: options.verbose ?? false,
      onProgress: progress,
    });

    progressDone();
    process.exitCode = result.exitCode;
  } catch (error) {
    progressDone();
    if (error instanceof DiscoveryError) {
      // User-facing error: the project is not valid or not supported.
      // Print a clean error message without a stack trace.
      console.error(chalk.red(`\nError: ${error.message}`));
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
