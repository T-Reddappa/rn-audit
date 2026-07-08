/**
 * rn-audit — Public API
 *
 * This module is the programmatic entry point for rn-audit.
 * It is what users import when they write:
 *
 *   import { discoverProject } from 'rn-audit';
 *
 * The CLI entry point (src/cli.ts) is a separate module designed
 * for terminal use. This separation ensures that programmatic
 * consumers (IDE extensions, CI scripts, other tools) don't
 * pull in Commander, chalk, ora, or other terminal-specific
 * dependencies unnecessarily.
 *
 * @packageDocumentation
 */

// Project Discovery (Milestone 1.1)
export {
  discoverProject,
  DiscoveryError,
  NoPackageJsonError,
  NotReactNativeProjectError,
  UnsupportedProjectError,
  InvalidConfigurationError,
} from "./discovery/index.js";

// Source Discovery (Milestone 1.2)
export { discoverSourceFiles } from "./scanner/index.js";

// Types
export type {
  ProjectModel,
  ConfigFiles,
  DependencyMap,
  DiscoveryOptions,
} from "./discovery/index.js";

export type {
  FileModel,
  SourceDiscoveryResult,
  FileExtension,
} from "./types/file.js";

export { ProjectFramework, ExpoWorkflow, PackageManager } from "./types/project.js";
