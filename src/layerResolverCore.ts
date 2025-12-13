/**
 * Shared core module for Effect Layer analysis and resolution
 * Used by both CLI and TUI implementations
 */

import ts from "typescript";
import path from "path";
import * as recast from "recast";

const b = recast.types.builders;
const n = recast.types.namedTypes;

export interface MissingRequirement {
  file: string;
  line: number;
  column: number;
  missingServices: string[];
  fullError: string;
}

export interface LayerDefinition {
  name: string;
  file: string;
  line: number;
  provides: string | null;
  requires: string[];
}

export interface RunPromiseCall {
  file: string;
  line: number;
  column: number;
}

/**
 * Compile the project and extract TypeScript diagnostics
 */
export function getDiagnostics(configPath: string): readonly ts.Diagnostic[] {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return [];
  }

  const basePath = path.dirname(configPath);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    basePath,
  );

  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
  });

  return ts.getPreEmitDiagnostics(program);
}

/**
 * Create a TypeScript program from tsconfig
 * Useful when you need both diagnostics and program for layer scanning
 */
export function createProgram(configPath: string): ts.Program | null {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return null;
  }

  const basePath = path.dirname(configPath);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    basePath,
  );

  return ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
  });
}

/**
 * Parse TypeScript diagnostics to find Effect requirement mismatches
 * Improved approach: Still parses diagnostic messages but more robustly
 *
 * Note: This still uses regex on diagnostic messages because:
 * 1. Diagnostics are error messages (strings), not AST nodes
 * 2. The TypeScript Compiler has already done the type checking
 * 3. Alternative would be to re-implement Effect's type checking logic
 *
 * Future improvement: Could use program + checker to inspect the actual
 * Effect call sites and extract requirements programmatically before errors occur
 */
export function findMissingRequirements(
  diagnostics: readonly ts.Diagnostic[],
): MissingRequirement[] {
  const results: MissingRequirement[] = [];

  for (const diag of diagnostics) {
    if (diag.code !== 2345) continue; // TS2345: Argument not assignable

    const messageText = ts.flattenDiagnosticMessageText(diag.messageText, "\n");

    // Look for Effect requirement mismatch pattern
    // Matches: Effect<..., ..., ServiceA | ServiceB> is not assignable to Effect<..., ..., never>
    const effectPattern =
      /Effect<[^>]*,\s*[^>]*,\s*([^>]+)>'?\s+is not assignable.*Effect<[^>]*,\s*[^>]*,\s*never>/;
    const match = messageText.match(effectPattern);

    if (match) {
      const servicesStr = match[1];
      // More robust parsing: handle whitespace and complex type names
      const services = servicesStr
        .split("|")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (diag.file) {
        const { line, character } = diag.file.getLineAndCharacterOfPosition(
          diag.start || 0,
        );
        results.push({
          file: diag.file.fileName,
          line: line + 1,
          column: character + 1,
          missingServices: services,
          fullError: messageText,
        });
      }
    }
  }

  return results;
}

/**
 * Scan source files for Layer definitions
 * Finds variables like: const DatabaseLive = Layer.succeed(DatabaseService, ...)
 * Uses TypeScript Compiler API to directly inspect type structure instead of string parsing
 */
export function findLayerDefinitions(program: ts.Program): LayerDefinition[] {
  const layers: LayerDefinition[] = [];
  const checker = program.getTypeChecker();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes("node_modules")) continue;

    ts.forEachChild(sourceFile, function visit(node) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const name = node.name.getText(sourceFile);
        const type = checker.getTypeAtLocation(node);

        // Check if this is a Layer type by examining the type alias
        if (isLayerType(type)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(),
          );

          // Extract generic type arguments: Layer<Out, Err, In>
          const typeArgs = getTypeArguments(type);

          const provides = typeArgs[0]
            ? checker.typeToString(typeArgs[0])
            : null;
          const requires = typeArgs[2]
            ? extractUnionMembers(typeArgs[2], checker)
            : [];

          layers.push({
            name,
            file: sourceFile.fileName,
            line: line + 1,
            provides,
            requires,
          });
        }
      }

      ts.forEachChild(node, visit);
    });
  }

  return layers;
}

/**
 * Check if a type is a Layer type (Layer.Layer<...> or Layer<...>)
 */
function isLayerType(type: ts.Type): boolean {
  // Check if type has an alias symbol named "Layer"
  if (type.aliasSymbol) {
    return type.aliasSymbol.name === "Layer";
  }

  // Fallback to string check for edge cases
  const typeString = type.getSymbol()?.getName() || "";
  return typeString === "Layer";
}

/**
 * Extract type arguments from a generic type
 */
function getTypeArguments(type: ts.Type): ts.Type[] {
  // For type aliases like Layer<A, B, C>, aliasTypeArguments contains [A, B, C]
  if (type.aliasTypeArguments) {
    return type.aliasTypeArguments as ts.Type[];
  }

  // For direct references, check if type is a TypeReference
  const typeRef = type as ts.TypeReference;
  if (typeRef.typeArguments) {
    return typeRef.typeArguments as ts.Type[];
  }

  return [];
}

/**
 * Extract members from a union type (A | B | C => ["A", "B", "C"])
 * Returns empty array for "never" type, single element for non-union types
 */
function extractUnionMembers(type: ts.Type, checker: ts.TypeChecker): string[] {
  // Check if it's the "never" type
  if (type.flags & ts.TypeFlags.Never) {
    return [];
  }

  // Check if it's a union type (A | B | C)
  if (type.flags & ts.TypeFlags.Union) {
    const unionType = type as ts.UnionType;
    return unionType.types.map((t) => checker.typeToString(t));
  }

  // Single type, not a union
  return [checker.typeToString(type)];
}

/**
 * Find all Effect.runPromise/runFork/runSync calls in the codebase
 * Used to identify where to insert layer composition code
 */
export function findRunPromiseCalls(program: ts.Program): RunPromiseCall[] {
  const calls: RunPromiseCall[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes("node_modules")) continue;

    ts.forEachChild(sourceFile, function visit(node) {
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(sourceFile);
        if (
          text.includes("Effect.runPromise") ||
          text.includes("Effect.runFork") ||
          text.includes("Effect.runSync")
        ) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(),
          );
          calls.push({
            file: sourceFile.fileName,
            line: line + 1,
            column: character + 1,
          });
        }
      }

      ts.forEachChild(node, visit);
    });
  }

  return calls;
}

/**
 * Build a lookup index: service name -> layers that provide it
 */
export function buildLayerIndex(
  layers: LayerDefinition[],
): Map<string, LayerDefinition[]> {
  const index = new Map<string, LayerDefinition[]>();
  for (const layer of layers) {
    if (layer.provides) {
      const existing = index.get(layer.provides) || [];
      existing.push(layer);
      index.set(layer.provides, existing);
    }
  }
  return index;
}

/**
 * Resolve transitive dependencies using topological sort
 * Returns the layers needed to satisfy all services, including dependencies
 */
export function resolveTransitiveDependencies(
  services: string[],
  layerIndex: Map<string, LayerDefinition[]>,
  selections?: Map<string, string>, // Optional user selections: service -> layer name
): { resolved: LayerDefinition[]; missing: string[]; order: string[] } {
  const resolved = new Map<string, LayerDefinition>();
  const missing: string[] = [];
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(service: string, path: Set<string> = new Set()): boolean {
    if (visited.has(service)) return true;
    if (path.has(service)) {
      // Circular dependency
      return false;
    }

    const available = layerIndex.get(service);
    if (!available || available.length === 0) {
      if (!missing.includes(service)) {
        missing.push(service);
      }
      return false;
    }

    // Use user-selected layer if available, otherwise first available layer
    let layer: LayerDefinition | undefined;
    if (selections && selections.has(service)) {
      const selectedName = selections.get(service);
      layer = available.find((l) => l.name === selectedName);
      if (!layer) {
        console.warn(
          `[resolveTransitiveDependencies] Selected layer "${selectedName}" not found for ${service}, using default`,
        );
        layer = available[0];
      }
    } else {
      layer = available[0];
    }

    path.add(service);

    // Recursively visit dependencies
    for (const req of layer.requires) {
      visit(req, new Set(path));
    }

    visited.add(service);

    if (!resolved.has(service)) {
      resolved.set(service, layer);
      order.push(layer.name);
    }

    return true;
  }

  for (const service of services) {
    visit(service);
  }

  return {
    resolved: Array.from(resolved.values()),
    missing,
    order,
  };
}

/**
 * Generate layer composition code
 *
 * For layers with dependencies, we use:
 *   Layer.mergeAll(
 *     IndependentLayer1,
 *     IndependentLayer2,
 *     DependentLayer.pipe(Layer.provide(DependencyLayer))
 *   )
 *
 * Example:
 *   CacheLive requires ConfigService
 *   ConfigLive provides ConfigService
 *
 *   Result:
 *   Layer.mergeAll(
 *     DatabaseLive,
 *     LoggingLive,
 *     CacheLive.pipe(Layer.provide(ConfigLive))
 *   )
 */
export function generateLayerCode(
  layers: LayerDefinition[],
  _layerIndex: Map<string, LayerDefinition[]>,
): string {
  if (layers.length === 0) {
    return "";
  }

  // Build a map of service -> layer that provides it
  const serviceToLayer = new Map<string, LayerDefinition>();
  for (const layer of layers) {
    if (layer.provides) {
      serviceToLayer.set(layer.provides, layer);
    }
  }

  // Separate layers into those with no internal dependencies and those with dependencies
  const independentLayers: LayerDefinition[] = [];
  const dependentLayers: LayerDefinition[] = [];

  for (const layer of layers) {
    // Check if this layer's requirements are satisfied by other layers in the list
    const hasInternalDependencies = layer.requires.some((req) => {
      return layers.some((other) => other.provides === req);
    });

    if (hasInternalDependencies) {
      dependentLayers.push(layer);
    } else {
      independentLayers.push(layer);
    }
  }

  // If all layers are independent, just use mergeAll
  if (dependentLayers.length === 0) {
    const mergeCall = buildLayerMergeAll(layers.map((l) => l.name));
    return recast.print(mergeCall).code;
  }

  // Build Layer.mergeAll with:
  // - Independent layers that are NOT only used as dependencies
  // - Dependent layers wrapped with .pipe(Layer.provide(dependency))
  const mergeArgs: any[] = [];

  // Track which layers are used as providers for dependent layers
  const usedAsProvider = new Set<string>();
  for (const layer of dependentLayers) {
    for (const req of layer.requires) {
      const provider = serviceToLayer.get(req);
      if (provider) {
        usedAsProvider.add(provider.name);
      }
    }
  }

  // Add independent layers that are NOT only used as providers
  for (const layer of independentLayers) {
    if (!usedAsProvider.has(layer.name)) {
      mergeArgs.push(b.identifier(layer.name));
    }
  }

  // Add dependent layers wrapped with their providers
  for (const layer of dependentLayers) {
    // Find the layers that provide this layer's requirements
    const providerLayers = layer.requires
      .map((req) => serviceToLayer.get(req))
      .filter(Boolean) as LayerDefinition[];

    if (providerLayers.length === 0) {
      // No internal providers, add as-is
      mergeArgs.push(b.identifier(layer.name));
    } else {
      // Wrap with .pipe(Layer.provide(provider1), Layer.provide(provider2), ...)
      const pipeArgs = providerLayers.map((provider) =>
        b.callExpression(
          b.memberExpression(b.identifier("Layer"), b.identifier("provide")),
          [b.identifier(provider.name)],
        ),
      );

      const wrappedLayer = b.callExpression(
        b.memberExpression(b.identifier(layer.name), b.identifier("pipe")),
        pipeArgs,
      );

      mergeArgs.push(wrappedLayer);
    }
  }

  // Build Layer.mergeAll(...)
  const mergeAllCall = b.callExpression(
    b.memberExpression(b.identifier("Layer"), b.identifier("mergeAll")),
    mergeArgs,
  );

  return recast.print(mergeAllCall).code;
}

/**
 * Build Layer.mergeAll(layer1, layer2, ...) call expression
 */
function buildLayerMergeAll(layerNames: string[]) {
  return b.callExpression(
    b.memberExpression(b.identifier("Layer"), b.identifier("mergeAll")),
    layerNames.map((name) => b.identifier(name)),
  );
}
