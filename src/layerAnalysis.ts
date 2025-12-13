// Layer Analysis Service
// Uses a Worker thread to run layer analysis without blocking the UI

import { Effect } from "effect";
import * as path from "path";
import * as fs from "fs/promises";
import { StoreActionsService } from "./storeActionsService";
import { applyLayerFix, type LayerFix } from "./codemod";
import {
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
 * Uses a Worker thread to avoid blocking the UI
 */
export const runLayerAnalysis = (projectPath: string = process.cwd()) =>
  Effect.gen(function* () {
    const actions = yield* StoreActionsService;

    yield* actions.setLayerAnalysisStatus("analyzing");
    yield* actions.setLayerAnalysisResults(null);
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

    // Run analysis in a Worker thread
    const result = yield* Effect.async<AnalysisResult, Error>((resume) => {
      try {
        const worker = new Worker(
          new URL("./layerResolverWorker.ts", import.meta.url),
        );

        const timeout = setTimeout(() => {
          worker.terminate();
          resume(
            Effect.fail(
              new Error("Layer analysis timed out after 60 seconds"),
            ),
          );
        }, 60000);

        worker.onmessage = (event: MessageEvent<AnalysisResult>) => {
          clearTimeout(timeout);
          worker.terminate();
          resume(Effect.succeed(event.data));
        };

        worker.onerror = (error: ErrorEvent) => {
          clearTimeout(timeout);
          worker.terminate();
          resume(Effect.fail(new Error(error.message)));
        };

        console.log(`[LayerAnalysis] Posting analysis request for ${tsconfigPath}`);
        worker.postMessage({ tsconfigPath, projectPath });
      } catch (error) {
        resume(Effect.fail(new Error(String(error))));
      }
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

      // Resolve with user selections
      const { resolved } = resolveTransitiveDependencies(
        results.missing,
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
            yield* actions.setLayerAnalysisStatus("applied");
            yield* actions.addAnalysisLog(
              `✅ Successfully modified ${codemodResult.modifiedFile}`,
            );
            for (const change of codemodResult.changes) {
              yield* actions.addAnalysisLog(`  - ${change}`);
            }
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
