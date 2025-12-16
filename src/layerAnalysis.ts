// Layer Analysis Service
// Runs layer analysis synchronously in a deferred context to avoid blocking

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
 * Run layer analysis on a TypeScript project
 * Runs analysis synchronously but schedules it to avoid blocking
 */
export const runLayerAnalysis = (projectPath: string = process.cwd()) =>
  Effect.gen(function* () {
    const actions = yield* StoreActionsService;

    yield* actions.setLayerAnalysisStatus("analyzing");
    // Keep previous results while re-analyzing so graph persists
    yield* actions.setLayerAnalysisError(null);

    // Find tsconfig.json in project path
    const tsconfigPath = yield* findTsConfig(projectPath);

    if (!tsconfigPath) {
      const error = `No tsconfig.json found in ${projectPath}`;
      yield* actions.setLayerAnalysisError(error);
      yield* actions.setLayerAnalysisStatus("error");
      console.log(error);
      return;
    }

    console.log(`Running layer analysis on ${tsconfigPath}`);

    // Run analysis in an async context to avoid blocking
    const result = yield* Effect.tryPromise({
      try: async () => {
        return await new Promise<AnalysisResult>((resolve, reject) => {
          // Schedule the analysis to run asynchronously
          setImmediate(() => {
            try {
              const analysis = performAnalysis(tsconfigPath);
              resolve(analysis);
            } catch (error) {
              reject(error);
            }
          });
        });
      },
      catch: (error) => new Error(String(error)),
    });

    // Handle the result
    yield* Effect.gen(function* () {
      const actions = yield* StoreActionsService;

      if (result.status === "error") {
        yield* actions.setLayerAnalysisError(result.errors.join("\n"));
        yield* actions.setLayerAnalysisStatus("error");
      } else if (result.missing.length === 0) {
        yield* actions.setLayerAnalysisStatus("complete");
        yield* actions.setLayerAnalysisResults({
          missing: [],
          resolved: [],
          candidates: result.candidates || [],
          generatedCode: "",
          message: "No missing layer requirements found!",
        });
      } else {
        console.log(
          `[LayerAnalysis] Setting results with ${result.candidates?.length || 0} candidate groups`,
        );
        yield* actions.setLayerAnalysisStatus("complete");
        yield* actions.setLayerAnalysisResults({
          missing: result.missing,
          resolved: result.resolved,
          candidates: result.candidates || [],
          allLayers: result.allLayers || [],
          generatedCode: result.generatedCode,
          targetFile: result.targetFile,
          targetLine: result.targetLine,
          stillMissing: result.stillMissing,
          resolutionOrder: result.resolutionOrder,
        });
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const actions = yield* StoreActionsService;
          yield* actions.setLayerAnalysisError(`Analysis failed: ${error}`);
          yield* actions.setLayerAnalysisStatus("error");
        }),
      ),
    );
  });

/**
 * Perform the actual layer analysis
 * This is called in a deferred async context to allow UI updates
 */
function performAnalysis(tsconfigPath: string): AnalysisResult {
  try {
    console.log(`[LayerAnalysis] Starting analysis on ${tsconfigPath}`);

    // Get diagnostics
    const diagnostics = getDiagnostics(tsconfigPath);
    const missingReqs = findMissingRequirements(diagnostics);

    if (missingReqs.length === 0) {
      const result: AnalysisResult = {
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
      };
      return result;
    }

    // Find layer definitions
    const program = createProgram(tsconfigPath);
    if (!program) {
      throw new Error("Failed to create TypeScript program");
    }

    const layers = findLayerDefinitions(program);
    const layerIndex = buildLayerIndex(layers);

    const allMissing = Array.from(
      new Set(missingReqs.flatMap((r: any) => r.missingServices)),
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

    const result: AnalysisResult = {
      status: "success",
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
      errors: [],
      targetFile,
      targetLine,
    };

    console.log(`[LayerAnalysis] Analysis complete`);
    return result;
  } catch (error) {
    const result: AnalysisResult = {
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
    };
    console.error(`[LayerAnalysis] Error:`, error);
    return result;
  }
}

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
