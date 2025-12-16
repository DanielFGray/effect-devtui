#!/usr/bin/env bun
// Layer Resolver CLI with JSON output for TUI integration
// Usage: bun run layerResolverCli.ts [--json] [<tsconfig-path>]
//
// JSON Mode:
//   - Outputs structured JSON to stdout for programmatic consumption (TUI, scripts, etc.)
//   - Debug/status messages go to stderr (won't interfere with JSON parsing)
//   - Use --json flag to enable
//
// tsconfig Resolution:
//   1. If explicit path provided as argument, use it (with validation)
//   2. Check for tsconfig.json in current working directory
//   3. Search upward from cwd to find tsconfig.json (like tsc, eslint, etc.)
//   4. Fallback to script's own directory (for development/testing)
//   5. Throw error if none found

import path from "path";
import fs from "fs";
import {
  type MissingRequirement,
  type LayerDefinition,
  createProgram,
  getDiagnostics,
  findMissingRequirements,
  findLayerDefinitions,
  buildLayerIndex,
  resolveTransitiveDependencies,
  generateLayerCode,
} from "./layerResolverCore";

interface AnalysisResult {
  status: "success" | "error";
  missing: string[];
  resolved: Array<{
    service: string;
    layer: string;
    file: string;
    line: number;
    requires: string[];
  }>;
  candidates: Array<{
    service: string;
    layers: Array<{
      name: string;
      file: string;
      line: number;
      requires: string[];
    }>;
  }>;
  /** All layer definitions found in the project (for resolving transitive deps) */
  allLayers: Array<{
    name: string;
    provides: string | null;
    file: string;
    line: number;
    requires: string[];
  }>;
  generatedCode: string;
  resolutionOrder: string[];
  stillMissing: string[];
  errors: string[];
  targetFile: string | null; // File where Effect.runPromise() was called
  targetLine: number | null; // Line where Effect.runPromise() was called
}

/**
 * Search upward from startDir to find tsconfig.json
 * Returns null if not found before reaching root
 */
function findTsConfig(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const candidate = path.join(currentDir, "tsconfig.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    currentDir = path.dirname(currentDir);
  }

  // Check root as well
  const rootCandidate = path.join(root, "tsconfig.json");
  if (fs.existsSync(rootCandidate)) {
    return rootCandidate;
  }

  return null;
}

/**
 * Auto-detect the best tsconfig.json to use
 * Priority:
 * 1. Explicit path provided as argument
 * 2. tsconfig.json in current working directory
 * 3. Search upward from cwd for tsconfig.json
 * 4. tsconfig.json in the directory of this script (fallback)
 */
function resolveTsConfig(explicitPath?: string): string {
  // 1. Explicit path provided
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    throw new Error(`Specified tsconfig not found: ${resolved}`);
  }

  // 2. Check current working directory
  const cwdConfig = path.join(process.cwd(), "tsconfig.json");
  if (fs.existsSync(cwdConfig)) {
    return cwdConfig;
  }

  // 3. Search upward from cwd
  const foundConfig = findTsConfig(process.cwd());
  if (foundConfig) {
    return foundConfig;
  }

  // 4. Fallback to script directory (for development/testing)
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const scriptConfig = path.join(scriptDir, "tsconfig.json");
  if (fs.existsSync(scriptConfig)) {
    return scriptConfig;
  }

  throw new Error(
    "No tsconfig.json found. Please specify a path or run from a TypeScript project directory.",
  );
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const explicitPath = args.find((arg) => !arg.startsWith("--"));
  const resolvedPath = resolveTsConfig(explicitPath);

  if (!jsonMode) {
    console.error(`Using tsconfig: ${resolvedPath}`);
    console.error(`Working directory: ${process.cwd()}\n`);
  }

  try {
    // Get diagnostics
    const diagnostics = getDiagnostics(resolvedPath);
    const missingReqs = findMissingRequirements(diagnostics);

    if (missingReqs.length === 0) {
      if (jsonMode) {
        console.log(
          JSON.stringify(
            {
              status: "success",
              missing: [],
              resolved: [],
              candidates: [],
              allLayers: [],
              generatedCode: "",
              resolutionOrder: [],
              stillMissing: [],
              errors: [],
              targetFile: null,
              targetLine: null,
            },
            null,
            2,
          ),
        );
      } else {
        console.log("No Effect requirement mismatches found!");
      }
      return;
    }

    // Find layer definitions
    const program = createProgram(resolvedPath);
    if (!program) {
      throw new Error("Failed to create TypeScript program");
    }

    const layers = findLayerDefinitions(program);
    const layerIndex = buildLayerIndex(layers);

    const allMissing = Array.from(
      new Set(missingReqs.flatMap((r) => r.missingServices)),
    );
    const {
      resolved,
      missing: stillMissing,
      order,
    } = resolveTransitiveDependencies(allMissing, layerIndex);

    const generatedCode = generateLayerCode(resolved, layerIndex);

    // Get target file/line from first missing requirement
    const targetFile = missingReqs[0]?.file || null;
    const targetLine = missingReqs[0]?.line || null;

    // Build candidates map: for each missing service, list all available layers
    const candidates = allMissing.map((service) => ({
      service,
      layers: (layerIndex.get(service) || []).map((layer) => ({
        name: layer.name,
        file: layer.file,
        line: layer.line,
        requires: layer.requires,
        composedOf: layer.composedOf,
        compositionType: layer.compositionType,
      })),
    }));

    if (jsonMode) {
      const result: AnalysisResult = {
        status: "success",
        missing: allMissing,
        resolved: resolved.map((layer) => ({
          service: layer.provides || "",
          layer: layer.name,
          file: layer.file,
          line: layer.line,
          requires: layer.requires,
        })),
        candidates,
        allLayers: layers.map((layer) => ({
          name: layer.name,
          provides: layer.provides,
          file: layer.file,
          line: layer.line,
          requires: layer.requires,
          composedOf: layer.composedOf,
          compositionType: layer.compositionType,
        })),
        generatedCode,
        resolutionOrder: order,
        stillMissing,
        errors: [],
        targetFile,
        targetLine,
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Missing: ${allMissing.join(", ")}`);
      console.log(`Resolved: ${order.join(" -> ")}`);
      console.log(`\nGenerated code:\n${generatedCode}`);
    }
  } catch (error) {
    if (jsonMode) {
      console.log(
        JSON.stringify(
          {
            status: "error",
            missing: [],
            resolved: [],
            candidates: [],
            allLayers: [],
            generatedCode: "",
            resolutionOrder: [],
            stillMissing: [],
            errors: [String(error)],
            targetFile: null,
            targetLine: null,
          },
          null,
          2,
        ),
      );
    } else {
      console.error("Error:", error);
      process.exit(1);
    }
  }
}

main().catch(console.error);
