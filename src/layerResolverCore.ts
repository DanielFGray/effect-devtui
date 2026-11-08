/**
 * Shared core module for Effect Layer analysis and resolution
 * Used by both CLI and TUI implementations
 *
 * TypeScript 7 runs the compiler in a separate process. The checker, program and
 * type objects are proxies, so every call that reaches the compiler returns a
 * Promise. Callers must close the session returned by openProject().
 */

import fs from "fs";
import path from "path";
import * as recast from "recast";
import {
  API,
  ObjectFlags,
  TypeFlags,
  type Checker,
  type Diagnostic,
  type Program,
  type Type,
  type TypeReference,
} from "typescript/unstable/async";
import {
  isCallExpression,
  isIdentifier,
  isPropertyAccessExpression,
  isVariableDeclaration,
  type Expression,
  type Node,
  type SourceFile,
  type VariableDeclaration,
} from "typescript/unstable/ast";

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
  /** Names of child layers if this is a composed layer (e.g., Layer.mergeAll, Layer.provide) */
  composedOf: string[];
  /** Type of composition used to create this layer */
  compositionType: "mergeAll" | "merge" | "provide" | "provideMerge" | "none";
}

export interface RunPromiseCall {
  file: string;
  line: number;
  column: number;
}

/** A TypeScript project opened through the compiler API. */
export interface ProjectSession {
  readonly program: Program;
  readonly checker: Checker;
  /** Stops the compiler process. Required, or the process outlives the analysis. */
  readonly close: () => Promise<void>;
}

/**
 * Locates the native compiler copied next to a compiled release binary.
 *
 * A Bun-compiled executable cannot find the TypeScript platform package in
 * node_modules, so the release build ships `tsc` beside the executable. In
 * development this returns undefined and the API resolves the package itself.
 */
const shippedCompilerPath = (): string | undefined => {
  const name = process.platform === "win32" ? "tsc.exe" : "tsc";
  const candidate = path.join(path.dirname(process.execPath), "lib", name);
  return fs.existsSync(candidate) ? candidate : undefined;
};

/**
 * Open the project described by a tsconfig.json.
 * Returns null when the compiler finds no project for the file.
 */
export async function openProject(
  configPath: string,
): Promise<ProjectSession | null> {
  const api = new API({ tsserverPath: shippedCompilerPath() });
  try {
    const snapshot = await api.updateSnapshot({ openProjects: [configPath] });
    const project = (await snapshot.getProjects())[0];
    if (!project) {
      await api.close();
      return null;
    }
    return {
      program: project.program,
      checker: project.checker,
      close: () => api.close(),
    };
  } catch (error) {
    await api.close();
    throw error;
  }
}

/**
 * Compile the project and collect every diagnostic the program reports
 */
export async function getDiagnostics(program: Program): Promise<Diagnostic[]> {
  return [
    ...(await program.getConfigFileParsingDiagnostics()),
    ...(await program.getProgramDiagnostics()),
    ...(await program.getGlobalDiagnostics()),
    ...(await program.getSyntacticDiagnostics()),
    ...(await program.getSemanticDiagnostics()),
  ];
}

// Matches: Effect<..., ..., ServiceA | ServiceB> is not assignable to Effect<..., ..., never>
const EFFECT_REQUIREMENT_PATTERN =
  /Effect<[^>]*,\s*[^>]*,\s*([^>]+)>'?\s+is not assignable.*Effect<[^>]*,\s*[^>]*,\s*never>/;

/**
 * Parse TypeScript diagnostics to find Effect requirement mismatches.
 *
 * Still parses diagnostic messages: the compiler has already done the type
 * checking, and re-implementing Effect's requirement inference is out of scope.
 * Union member order follows the compiler, so callers must not depend on it.
 */
export async function findMissingRequirements(
  program: Program,
  diagnostics: readonly Diagnostic[],
): Promise<MissingRequirement[]> {
  const results: MissingRequirement[] = [];

  for (const diag of diagnostics) {
    if (diag.code !== 2345) continue; // TS2345: Argument not assignable
    if (!diag.fileName) continue;

    const match = diag.text.match(EFFECT_REQUIREMENT_PATTERN);
    if (!match) continue;

    const services = match[1]
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const sourceFile = await program.getSourceFile(diag.fileName);
    if (!sourceFile) continue;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      diag.pos,
    );
    results.push({
      file: diag.fileName,
      line: line + 1,
      column: character + 1,
      missingServices: services,
      fullError: diag.text,
    });
  }

  return results;
}

/**
 * Scan source files for Layer definitions
 * Finds variables like: const DatabaseLive = Layer.succeed(DatabaseService, ...)
 * Uses the compiler's checker to read each declaration's Layer<Out, Err, In> type arguments
 */
export async function findLayerDefinitions(
  program: Program,
  checker: Checker,
): Promise<LayerDefinition[]> {
  const layers: LayerDefinition[] = [];

  for (const fileName of await program.getSourceFileNames()) {
    if (fileName.includes("node_modules")) continue;
    const sourceFile = await program.getSourceFile(fileName);
    if (!sourceFile || sourceFile.isDeclarationFile) continue;

    for (const node of collectVariableDeclarations(sourceFile)) {
      if (!node.initializer) continue;

      const type = await checker.getTypeAtLocation(node);
      if (!type || !(await isLayerType(type))) continue;

      const name = node.name.getText(sourceFile);
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

      const typeArgs = await getTypeArguments(type, checker);
      const provides = typeArgs[0] ? await checker.typeToString(typeArgs[0]) : null;
      const requires = typeArgs[2] ? await extractUnionMembers(typeArgs[2], checker) : [];

      // Extract composition information (for merged/provided layers)
      const { composedOf, compositionType } = extractCompositionInfo(
        node.initializer,
        sourceFile,
      );

      layers.push({
        name,
        file: sourceFile.fileName,
        line: line + 1,
        provides,
        requires,
        composedOf,
        compositionType,
      });
    }
  }

  return layers;
}

/**
 * Every variable declaration in a file, in source order. Collected synchronously
 * because the AST walk cannot await the checker calls made for each declaration.
 */
function collectVariableDeclarations(root: SourceFile): VariableDeclaration[] {
  const found: VariableDeclaration[] = [];
  const visit = (node: Node): void => {
    if (isVariableDeclaration(node)) found.push(node);
    node.forEachChild(visit);
  };
  root.forEachChild(visit);
  return found;
}

/**
 * Check if a type is a Layer type (Layer.Layer<...> or Layer<...>)
 */
async function isLayerType(type: Type): Promise<boolean> {
  // Type aliases carry their own symbol; interfaces such as Effect v4's Layer do not
  const aliasSymbol = await type.getAliasSymbol();
  if (aliasSymbol) {
    return aliasSymbol.name === "Layer";
  }

  const symbol = await type.getSymbol();
  return (symbol?.name ?? "") === "Layer";
}

/**
 * Extract composition information from a layer initializer expression
 * Detects patterns like:
 * - Layer.mergeAll(A, B, C)
 * - Layer.merge(A, B)
 * - Layer.provide(A, B) or A.pipe(Layer.provide(B))
 * - Layer.provideMerge(A, B)
 */
function extractCompositionInfo(
  initializer: Expression,
  sourceFile: SourceFile,
): {
  composedOf: string[];
  compositionType: LayerDefinition["compositionType"];
} {
  const composedOf: string[] = [];
  let compositionType: LayerDefinition["compositionType"] = "none";

  // Helper to extract identifier name from an expression
  const getExpressionName = (expr: Expression): string | null => {
    if (isIdentifier(expr)) {
      return expr.text;
    }
    if (isPropertyAccessExpression(expr)) {
      // Handle cases like Module.LayerName
      return expr.getText(sourceFile);
    }
    return null;
  };

  // Helper to check if a call is a Layer.X method
  const getLayerMethodName = (expr: Expression): string | null => {
    if (isPropertyAccessExpression(expr)) {
      const obj = expr.expression;
      const method = expr.name.text;
      if (isIdentifier(obj) && obj.text === "Layer") {
        return method;
      }
    }
    return null;
  };

  // Check for direct Layer.mergeAll/merge/provide calls
  if (isCallExpression(initializer)) {
    const methodName = getLayerMethodName(initializer.expression);

    if (methodName === "mergeAll" || methodName === "merge") {
      compositionType = methodName;
      for (const arg of initializer.arguments) {
        const name = getExpressionName(arg);
        if (name) composedOf.push(name);
      }
    } else if (methodName === "provide" || methodName === "provideMerge") {
      compositionType = methodName;
      // Layer.provide(layerToProvide, providerLayer)
      for (const arg of initializer.arguments) {
        const name = getExpressionName(arg);
        if (name) composedOf.push(name);
      }
    }
  }

  // Check for pipe pattern: A.pipe(Layer.provide(B))
  if (isCallExpression(initializer)) {
    const expr = initializer.expression;
    if (isPropertyAccessExpression(expr) && expr.name.text === "pipe") {
      // Get the subject of the pipe (A in A.pipe(...))
      const subject = expr.expression;
      const subjectName = getExpressionName(subject);

      // Look through pipe arguments for Layer.provide/provideMerge calls
      for (const arg of initializer.arguments) {
        if (isCallExpression(arg)) {
          const pipeMethodName = getLayerMethodName(arg.expression);
          if (
            pipeMethodName === "provide" ||
            pipeMethodName === "provideMerge"
          ) {
            compositionType = pipeMethodName;
            if (subjectName) composedOf.push(subjectName);
            // Add the provider layer(s) from the Layer.provide call
            for (const providerArg of arg.arguments) {
              const providerName = getExpressionName(providerArg);
              if (providerName) composedOf.push(providerName);
            }
          }
        }
      }
    }
  }

  return { composedOf, compositionType };
}

/**
 * Type arguments of a generic type. Aliases such as `type Layer<A, B, C>` expose
 * their arguments through the alias; interface instantiations such as Effect v4's
 * `Layer<A, B, C>` are type references.
 */
async function getTypeArguments(type: Type, checker: Checker): Promise<readonly Type[]> {
  const aliasArgs = await type.getAliasTypeArguments();
  if (aliasArgs.length > 0) {
    return aliasArgs;
  }
  if (type.isObjectType() && type.objectFlags & ObjectFlags.Reference) {
    return checker.getTypeArguments(type as TypeReference);
  }
  return [];
}

/**
 * Extract members from a union type (A | B | C => ["A", "B", "C"])
 * Returns empty array for "never" type, single element for non-union types
 */
async function extractUnionMembers(type: Type, checker: Checker): Promise<string[]> {
  // Check if it's the "never" type
  if (type.flags & TypeFlags.Never) {
    return [];
  }

  // Check if it's a union type (A | B | C)
  if (type.isUnionType()) {
    const members = await type.getTypes();
    return Promise.all(members.map((t) => checker.typeToString(t)));
  }

  // Single type, not a union
  return [await checker.typeToString(type)];
}

/**
 * Find all Effect.runPromise/runFork/runSync calls in the codebase
 * Used to identify where to insert layer composition code
 */
export async function findRunPromiseCalls(program: Program): Promise<RunPromiseCall[]> {
  const calls: RunPromiseCall[] = [];

  for (const fileName of await program.getSourceFileNames()) {
    if (fileName.includes("node_modules")) continue;
    const sourceFile = await program.getSourceFile(fileName);
    if (!sourceFile || sourceFile.isDeclarationFile) continue;

    const visit = (node: Node): void => {
      if (isCallExpression(node)) {
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
      node.forEachChild(visit);
    };
    sourceFile.forEachChild(visit);
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
