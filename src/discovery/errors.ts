/**
 * Discovery Error Classes
 *
 * Custom error types for the discovery subsystem. Each error carries a
 * machine-readable `code` that the CLI layer can switch on to produce
 * appropriate user-facing messages and exit codes.
 *
 * Design principle: errors are data, not just messages. The caller
 * should never need to parse `error.message` to understand what happened.
 *
 * @module discovery/errors
 */

import { DiscoveryErrorCode } from "../types/discovery.js";

/**
 * Base error for all discovery failures.
 *
 * All discovery errors extend this class. The `code` property is the
 * canonical identifier for the error type. Callers can use
 * `instanceof DiscoveryError` to catch all discovery errors, or
 * switch on `error.code` for specific handling.
 *
 * @example
 * ```typescript
 * try {
 *   const project = await discoverProject();
 * } catch (error) {
 *   if (error instanceof DiscoveryError) {
 *     switch (error.code) {
 *       case DiscoveryErrorCode.NO_PACKAGE_JSON:
 *         console.error("No package.json found.");
 *         process.exit(2);
 *       // ... other cases
 *     }
 *   }
 *   throw error; // Re-throw unexpected errors
 * }
 * ```
 */
export class DiscoveryError extends Error {
  /**
   * Machine-readable error code.
   * Consumers switch on this value; they do NOT parse `message`.
   */
  public readonly code: DiscoveryErrorCode;

  /**
   * The directory path that was being examined when the error occurred.
   * Helps with debugging and user-facing error messages.
   */
  public readonly directory: string;

  constructor(code: DiscoveryErrorCode, message: string, directory: string) {
    // Pass the message to the Error constructor so stack traces include it
    super(message);

    // Set the prototype explicitly for correct instanceof checks.
    // This is required when extending built-in classes in TypeScript
    // when targeting ES2015+. Without it, `error instanceof DiscoveryError`
    // returns false.
    Object.setPrototypeOf(this, DiscoveryError.prototype);

    this.code = code;
    this.directory = directory;

    // Capture a clean stack trace, excluding this constructor frame
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DiscoveryError);
    }
  }

  /**
   * Human-readable representation for debugging.
   */
  override toString(): string {
    return `[${this.code}] ${this.message} (directory: ${this.directory})`;
  }
}

/**
 * Error thrown when no package.json can be found.
 *
 * The root-finder walks up from `process.cwd()` to the filesystem root.
 * If no directory in that chain contains a `package.json`, this error
 * is thrown.
 */
export class NoPackageJsonError extends DiscoveryError {
  constructor(directory: string) {
    super(
      DiscoveryErrorCode.NO_PACKAGE_JSON,
      `No package.json found. Searched from "${directory}" up to the filesystem root. ` +
        "Are you inside a React Native or Expo project?",
      directory,
    );
    Object.setPrototypeOf(this, NoPackageJsonError.prototype);
  }
}

/**
 * Error thrown when a package.json exists but the project is not
 * a React Native or Expo project.
 *
 * The validator checks for `react-native` or `expo` in dependencies.
 * If neither is found, the project is not something rn-audit can audit.
 */
export class NotReactNativeProjectError extends DiscoveryError {
  constructor(directory: string) {
    super(
      DiscoveryErrorCode.NOT_A_REACT_NATIVE_PROJECT,
      `This does not appear to be a React Native or Expo project. ` +
        `Could not find "react-native" or "expo" in dependencies at "${directory}". ` +
        "rn-audit only works with React Native and Expo projects.",
      directory,
    );
    Object.setPrototypeOf(this, NotReactNativeProjectError.prototype);
  }
}

/**
 * Error thrown when the project type is explicitly unsupported.
 *
 * Example: a project using a React Native version below our minimum
 * supported version, or a project framework we've explicitly excluded.
 */
export class UnsupportedProjectError extends DiscoveryError {
  public readonly reason: string;

  constructor(directory: string, reason: string) {
    super(
      DiscoveryErrorCode.UNSUPPORTED_PROJECT_TYPE,
      `This project is not supported by rn-audit: ${reason}`,
      directory,
    );
    Object.setPrototypeOf(this, UnsupportedProjectError.prototype);
    this.reason = reason;
  }
}

/**
 * Error thrown when a configuration file exists but cannot be parsed.
 *
 * Example: `package.json` exists but contains invalid JSON.
 */
export class InvalidConfigurationError extends DiscoveryError {
  public readonly filePath: string;

  constructor(directory: string, filePath: string, detail: string) {
    super(
      DiscoveryErrorCode.INVALID_CONFIGURATION,
      `Invalid configuration in "${filePath}": ${detail}`,
      directory,
    );
    Object.setPrototypeOf(this, InvalidConfigurationError.prototype);
    this.filePath = filePath;
  }
}
