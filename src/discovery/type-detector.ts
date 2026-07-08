/**
 * Project Type Detector
 *
 * Determines the specific project type, framework, and workflow of a
 * discovered React Native project. This is the third step of the discovery
 * pipeline.
 *
 * ## Detection matrix
 *
 * | Condition | Framework | Workflow | hasExpoRouter |
 * |-----------|-----------|----------|---------------|
 * | `expo` in deps, no `ios/`/`android/` dirs | Expo | Managed | Depends on `expo-router` in deps |
 * | `expo` in deps, has `ios/`/`android/` dirs | Expo | Bare | Depends on `expo-router` in deps |
 * | `react-native` in deps, no `expo` | ReactNativeCLI | undefined | Depends on `expo-router` in deps |
 *
 * ## Future extensibility
 *
 * To add a new project type (e.g., Nx monorepo, TurboRepo):
 * 1. Add the detection logic to `detectProjectType()`.
 * 2. If needed, add a new value to `ProjectFramework`.
 * 3. Update the detection matrix in this module's JSDoc.
 *
 * No other modules need to change — the TypeDetectionResult interface
 * is consumed only by the orchestrator.
 *
 * @module discovery/type-detector
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ProjectFramework, ExpoWorkflow } from "../types/project.js";
import type { TypeDetectionResult } from "../types/discovery.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the project type from package.json dependencies and filesystem
 * structure.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param dependencies - Production dependencies from package.json.
 * @param devDependencies - Dev dependencies from package.json.
 * @returns A structured result for the orchestrator to merge into the
 *   ProjectModel.
 */
export function detectProjectType(
  projectRoot: string,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
): TypeDetectionResult {
  const allDeps = new Set([
    ...Object.keys(dependencies),
    ...Object.keys(devDependencies),
  ]);

  const hasExpo = allDeps.has("expo");
  const hasReactNative = allDeps.has("react-native");

  // ------------------------------------------------------------------
  // Step 1: Determine the framework
  // ------------------------------------------------------------------

  let framework: ProjectFramework;

  if (hasExpo) {
    framework = ProjectFramework.Expo;
  } else if (hasReactNative) {
    framework = ProjectFramework.ReactNativeCLI;
  } else {
    // This shouldn't happen — the validator already checked for these.
    // But we handle it defensively.
    framework = ProjectFramework.ReactNativeCLI;
  }

  // ------------------------------------------------------------------
  // Step 2: Determine the workflow (Expo only)
  // ------------------------------------------------------------------

  let workflow: ExpoWorkflow | undefined;

  if (framework === ProjectFramework.Expo) {
    const hasIosDir = existsSync(resolve(projectRoot, "ios"));
    const hasAndroidDir = existsSync(resolve(projectRoot, "android"));

    // Both ios/ and android/ must exist for bare workflow.
    // A project with only one native directory is likely a misconfigured
    // managed project — we classify it as managed.
    if (hasIosDir && hasAndroidDir) {
      workflow = ExpoWorkflow.Bare;
    } else {
      workflow = ExpoWorkflow.Managed;
    }
  }

  // ------------------------------------------------------------------
  // Step 3: Check for Expo Router
  // ------------------------------------------------------------------

  const hasExpoRouter = allDeps.has("expo-router");

  // ------------------------------------------------------------------
  // Step 4: Assemble result
  // ------------------------------------------------------------------

  return {
    framework,
    isSupported: true, // Validator already confirmed this
    workflow,
    hasExpoRouter,
  };
}
