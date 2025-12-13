/**
 * Worker thread for layer analysis
 * Runs the TypeScript analysis in a separate thread to keep UI responsive
 */

import {
  type MissingRequirement,
  type LayerDefinition,
  getDiagnostics,
  findMissingRequirements,
  createProgram,
  findLayerDefinitions,
  buildLayerIndex,
  resolveTransitiveDependencies,
  generateLayerCode,
} from "./layerResolverCore";

interface AnalysisRequest {
  tsconfigPath: string;
  projectPath?: string;
}

interface AnalysisResultMessage {
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
  targetFile: string | null;
  targetLine: number | null;
}

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { tsconfigPath } = event.data;

  try {
    console.log(`[LayerResolverWorker] Starting analysis on ${tsconfigPath}`);

    // Get diagnostics
    const diagnostics = getDiagnostics(tsconfigPath);
    const missingReqs = findMissingRequirements(diagnostics);

    if (missingReqs.length === 0) {
      const result: AnalysisResultMessage = {
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
      self.postMessage(result);
      return;
    }

    // Find layer definitions
    const program = createProgram(tsconfigPath);
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
      })),
    }));

    const result: AnalysisResultMessage = {
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
      })),
      generatedCode,
      resolutionOrder: order,
      stillMissing,
      errors: [],
      targetFile,
      targetLine,
    };

    console.log(`[LayerResolverWorker] Analysis complete`);
    self.postMessage(result);
  } catch (error) {
    const result: AnalysisResultMessage = {
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
    console.error(`[LayerResolverWorker] Error:`, error);
    self.postMessage(result);
  }
};
