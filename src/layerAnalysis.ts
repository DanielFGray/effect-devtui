// Layer Analysis Service
// Runs layer analysis with progress reporting at each stage

import { Effect } from "effect";
import * as path from "path";
import * as fs from "fs/promises";
import { StoreActionsService } from "./storeActionsService";
import { applyLayerFix, type LayerFix } from "./codemod";
import {
  getDiagnostics,
  findMissingRequirements,
  createProgram,
  findLayerDefinitions,
  buildLayerIndex,
  resolveTransitiveDependencies,
  generateLayerCode,
} from "./layerResolverCore";
import type { AnalysisProgressStep } from "./storeTypes";

export interface AnalysisResult {
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
  allLayers?: Array<{
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
  targetFile: string | null;
  targetLine: number | null;
}

/**
 * Helper to update progress and yield to the event loop for UI updates
 */
const setProgress = (step: AnalysisProgressStep) =>
  Effect.gen(function* () {
    const actions = yield* StoreActionsService;
    yield* actions.setLayerAnalysisProgress(step);
    // Yield to the JS event loop to allow Solid.js to re-render
    // Using setTimeout(0) to ensure we actually yield to the event loop
    yield* Effect.sleep("1 millis");
  });

/**
 * Run layer analysis on a TypeScript project
 * Reports progress at each stage to allow UI updates
 */
export const runLayerAnalysis = (projectPath: string = process.cwd()) =>
  Effect.gen(function* () {
    const actions = yield* StoreActionsService;

    yield* actions.setLayerAnalysisStatus("analyzing");
    yield* actions.setLayerAnalysisProgress(null);
    yield* actions.setLayerAnalysisError(null);

    // Step 1: Find tsconfig.json
    yield* setProgress("finding_tsconfig");
    const tsconfigPath = yield* findTsConfig(projectPath);

    if (!tsconfigPath) {
      const error = `No tsconfig.json found in ${projectPath}`;
      yield* actions.setLayerAnalysisError(error);
      yield* actions.setLayerAnalysisStatus("error");
      yield* actions.setLayerAnalysisProgress(null);
      console.log(error);
      return;
    }

    console.log(`Running layer analysis on ${tsconfigPath}`);

    // Create TypeScript program (part of getting diagnostics)
    const program = yield* Effect.try({
      try: () => createProgram(tsconfigPath),
      catch: (error) =>
        new Error(`Failed to create TypeScript program: ${error}`),
    });

    if (!program) {
      yield* actions.setLayerAnalysisError(
        "Failed to create TypeScript program",
      );
      yield* actions.setLayerAnalysisStatus("error");
      yield* actions.setLayerAnalysisProgress(null);
      return;
    }

    // Step 3: Get diagnostics
    yield* setProgress("getting_diagnostics");
    const diagnostics = yield* Effect.try({
      try: () => getDiagnostics(tsconfigPath),
      catch: (error) => new Error(`Failed to get diagnostics: ${error}`),
    });

    // Step 4: Find missing requirements
    yield* setProgress("finding_requirements");
    const missingReqs = yield* Effect.try({
      try: () => findMissingRequirements(diagnostics),
      catch: (error) =>
        new Error(`Failed to find missing requirements: ${error}`),
    });

    if (missingReqs.length === 0) {
      yield* actions.setLayerAnalysisStatus("complete");
      yield* actions.setLayerAnalysisProgress(null);
      yield* actions.setLayerAnalysisResults({
        missing: [],
        resolved: [],
        candidates: [],
        generatedCode: "",
        message: "No missing layer requirements found!",
      });
      return;
    }

    // Step 5: Find layer definitions
    yield* setProgress("finding_layers");
    const layers = yield* Effect.try({
      try: () => findLayerDefinitions(program),
      catch: (error) => new Error(`Failed to find layer definitions: ${error}`),
    });

    // Step 6: Build layer index
    yield* setProgress("building_index");
    const layerIndex = yield* Effect.try({
      try: () => buildLayerIndex(layers),
      catch: (error) => new Error(`Failed to build layer index: ${error}`),
    });

    // Step 7: Resolve dependencies
    yield* setProgress("resolving_deps");
    const allMissing = Array.from(
      new Set(missingReqs.flatMap((r: any) => r.missingServices)),
    );
    const {
      resolved,
      missing: stillMissing,
      order,
    } = yield* Effect.try({
      try: () => resolveTransitiveDependencies(allMissing, layerIndex),
      catch: (error) => new Error(`Failed to resolve dependencies: ${error}`),
    });

    // Step 8: Generate code
    yield* setProgress("generating_code");
    const generatedCode = yield* Effect.try({
      try: () => generateLayerCode(resolved, layerIndex),
      catch: (error) => new Error(`Failed to generate code: ${error}`),
    });

    // Get target file/line from first missing requirement
    const targetFile = missingReqs[0]?.file || null;
    const targetLine = missingReqs[0]?.line || null;

    // Build candidates map: for each missing service, list all available layers
    const candidates = allMissing.map((service: any) => ({
      service,
      layers: (layerIndex.get(service) || []).map((layer: any) => ({
        name: layer.name,
        file: layer.file,
        line: layer.line,
        requires: layer.requires,
        composedOf: layer.composedOf,
        compositionType: layer.compositionType,
      })),
    }));

    // Complete!
    console.log(
      `[LayerAnalysis] Setting results with ${candidates.length} candidate groups`,
    );
    yield* actions.setLayerAnalysisStatus("complete");
    yield* actions.setLayerAnalysisProgress(null);
    yield* actions.setLayerAnalysisResults({
      missing: allMissing as any,
      resolved: resolved.map((layer: any) => ({
        service: layer.provides || "",
        layer: layer.name,
        file: layer.file,
        line: layer.line,
        requires: layer.requires,
      })),
      candidates,
      allLayers: layers.map((layer: any) => ({
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
      targetFile,
      targetLine,
    });
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const actions = yield* StoreActionsService;
        console.error("[LayerAnalysis] Error:", error);
        yield* actions.setLayerAnalysisError(`Analysis failed: ${error}`);
        yield* actions.setLayerAnalysisStatus("error");
        yield* actions.setLayerAnalysisProgress(null);
      }),
    ),
  );

/**
 * Apply the suggested layer fix by modifying the source file
 */
export const applyLayerSuggestion = () =>
  Effect.gen(function* () {
    console.log("[LayerAnalysis] applyLayerSuggestion called");
    const actions = yield* StoreActionsService;

    console.log("[LayerAnalysis] Getting analysis results from store");
    const results = yield* actions.getLayerAnalysisResults();
    console.log(
      "[LayerAnalysis] Analysis results:",
      results ? "found" : "null",
    );

    if (!results || !results.targetFile || !results.targetLine) {
      console.error("[LayerAnalysis] Invalid analysis results");
      yield* actions.setLayerAnalysisError(
        "No valid analysis results to apply",
      );
      return;
    }

    if (!results.candidates || results.candidates.length === 0) {
      console.error("[LayerAnalysis] No candidates found");
      yield* actions.setLayerAnalysisError(
        "No layer candidates found in analysis results",
      );
      return;
    }

    // Get user selections from store
    console.log("[LayerAnalysis] Getting user selections from store");
    const selections = yield* actions.getLayerSelections();

    // Only apply fixes for services that have explicit selections
    const selectedServices = Array.from(selections.keys());

    if (selectedServices.length === 0) {
      console.log("[LayerAnalysis] No layers selected - nothing to apply");
      yield* actions.addAnalysisLog(
        "⚠️ No layers selected. Select layers for services you want to fix.",
      );
      return;
    }

    console.log(
      `[LayerAnalysis] Applying layer fix to ${results.targetFile}:${results.targetLine}`,
    );
    console.log(
      `[LayerAnalysis] User selections:`,
      Object.fromEntries(selections),
    );

    // Regenerate code with user selections
    yield* Effect.sync(() => {
      // Use allLayers from analysis if available (includes transitive deps)
      // Otherwise fall back to rebuilding from candidates (legacy behavior)
      let layersForIndex: any[];

      if (results.allLayers && results.allLayers.length > 0) {
        // New path: use all layers from the project
        layersForIndex = results.allLayers;
        console.log(
          `[LayerAnalysis] Using allLayers (${layersForIndex.length} layers) for dependency resolution`,
        );
      } else {
        // Fallback: rebuild layer index from candidates only
        console.log(
          "[LayerAnalysis] allLayers not available, falling back to candidates",
        );
        layersForIndex = [];
        for (const candidate of results.candidates!) {
          for (const layer of candidate.layers) {
            layersForIndex.push({
              name: layer.name,
              file: layer.file,
              line: layer.line,
              provides: candidate.service,
              requires: layer.requires,
            });
          }
        }
      }

      const layerIndex = buildLayerIndex(layersForIndex);

      // Resolve only the services that have explicit selections (plus their transitive deps)
      const { resolved } = resolveTransitiveDependencies(
        selectedServices,
        layerIndex,
        selections,
      );

      // Generate code with selected layers
      const generatedCode = generateLayerCode(resolved, layerIndex);

      const fix: LayerFix = {
        targetFile: results.targetFile!,
        targetLine: results.targetLine!,
        generatedCode,
        layerNames: resolved.map((r: any) => r.name),
      };

      const codemodResult = applyLayerFix(fix);

      return { codemodResult };
    }).pipe(
      Effect.flatMap(({ codemodResult }) =>
        Effect.gen(function* () {
          const actions = yield* StoreActionsService;

          // Log all codemod debug messages to the console
          for (const logMsg of codemodResult.logs) {
            yield* actions.addAnalysisLog(logMsg);
          }

          if (codemodResult.success) {
            yield* actions.addAnalysisLog(
              `✅ Successfully modified ${codemodResult.modifiedFile}`,
            );
            for (const change of codemodResult.changes) {
              yield* actions.addAnalysisLog(`  - ${change}`);
            }

            // Re-analyze to show remaining missing services
            yield* runLayerAnalysis(path.dirname(codemodResult.modifiedFile));
          } else {
            yield* actions.setLayerAnalysisError(
              `Failed to apply fix:\n${codemodResult.errors.join("\n")}`,
            );
            for (const errMsg of codemodResult.errors) {
              yield* actions.addAnalysisLog(`❌ ${errMsg}`);
            }
          }
        }),
      ),
    );
  });

/**
 * Find tsconfig.json in project path
 * Searches current directory and walks up parent directories
 */
const findTsConfig = (startPath: string) =>
  Effect.gen(function* () {
    let currentPath = path.resolve(startPath);
    const root = path.parse(currentPath).root;

    while (currentPath !== root) {
      const tsconfigPath = path.join(currentPath, "tsconfig.json");

      // Try to access the file, catching errors with Effect.catchAll
      const result = yield* Effect.tryPromise({
        try: () => fs.access(tsconfigPath).then(() => tsconfigPath),
        catch: () => null,
      });

      if (result) {
        console.log(`Found tsconfig.json at ${result}`);
        return result;
      }

      // File doesn't exist, try parent directory
      currentPath = path.dirname(currentPath);
    }

    return null;
  });
