// Codemod service for automatically applying layer fixes
// Uses recast for AST manipulation to insert Effect.provide() calls

import * as recast from "recast";
import * as fs from "fs";
import * as typescriptParser from "recast/parsers/typescript";

const b = recast.types.builders;
const n = recast.types.namedTypes;

export interface CodemodResult {
  success: boolean;
  modifiedFile: string;
  changes: string[];
  errors: string[];
  logs: string[];
}

export interface LayerFix {
  targetFile: string;
  targetLine: number;
  generatedCode: string;
  layerNames: string[];
}

/**
 * Apply layer fix by inserting layer composition before the Effect.run call
 * and wrapping the effect with Effect.provide()
 *
 * Handles two cases:
 * 1. No AppLayer exists - create new declaration and wrap Effect.run with Effect.provide
 * 2. AppLayer already exists - merge new layers into existing Layer.mergeAll()
 */
export function applyLayerFix(fix: LayerFix): CodemodResult {
  const result: CodemodResult = {
    success: false,
    modifiedFile: fix.targetFile,
    changes: [],
    errors: [],
    logs: [],
  };

  const log = (msg: string, data?: any) => {
    const fullMsg = data ? `${msg} ${JSON.stringify(data)}` : msg;
    result.logs.push(fullMsg);
  };

  log("[Codemod] applyLayerFix called with:", {
    targetFile: fix.targetFile,
    targetLine: fix.targetLine,
    layerNames: fix.layerNames,
    generatedCodePreview: fix.generatedCode.substring(0, 100),
  });

  try {
    const sourceText = fs.readFileSync(fix.targetFile, "utf-8");
    log(`[Codemod] Read source file, length: ${sourceText.length}`);

    const ast = recast.parse(sourceText, {
      parser: typescriptParser,
    });
    log("[Codemod] Parsed AST successfully");

    // First, check if AppLayer already exists
    let existingAppLayerDecl: any = null;
    let existingLayerNames: string[] = [];

    recast.visit(ast, {
      visitVariableDeclaration(path) {
        const decl = path.node;
        for (const declarator of decl.declarations) {
          if (
            n.VariableDeclarator.check(declarator) &&
            n.Identifier.check(declarator.id) &&
            declarator.id.name === "AppLayer"
          ) {
            log("[Codemod] Found existing AppLayer declaration");
            existingAppLayerDecl = path;

            // Try to extract existing layer names from Layer.mergeAll(...)
            if (
              n.CallExpression.check(declarator.init) &&
              n.MemberExpression.check(declarator.init.callee) &&
              n.Identifier.check(declarator.init.callee.object) &&
              declarator.init.callee.object.name === "Layer" &&
              n.Identifier.check(declarator.init.callee.property) &&
              declarator.init.callee.property.name === "mergeAll"
            ) {
              for (const arg of declarator.init.arguments) {
                if (n.Identifier.check(arg)) {
                  existingLayerNames.push(arg.name);
                }
              }
              log("[Codemod] Existing layers in AppLayer:", existingLayerNames);
            }
            return false;
          }
        }
        this.traverse(path);
      },
    });

    // Check if Effect.run call is already wrapped with Effect.provide
    let effectRunAlreadyWrapped = false;
    let insertionStatement: any = null;
    let effectRunPath: any = null;

    recast.visit(ast, {
      visitCallExpression(path) {
        const node = path.node;
        const { start } = node.loc || {};

        if (!start) {
          this.traverse(path);
          return;
        }

        // Check if this call is on the target line
        if (start.line === fix.targetLine) {
          // Check if this is an Effect.run* call
          if (
            n.MemberExpression.check(node.callee) &&
            n.Identifier.check(node.callee.property)
          ) {
            const methodName = node.callee.property.name;

            if (
              ["runPromise", "runFork", "runSync", "runCallback"].includes(
                methodName,
              )
            ) {
              log(`[Codemod] Found Effect.run* call: ${methodName}`);
              effectRunPath = path;

              // Find the containing statement
              let currentPath = path;
              while (currentPath && !n.Statement.check(currentPath.node)) {
                currentPath = currentPath.parent;
              }
              if (currentPath) {
                insertionStatement = currentPath;
              }

              // Check if the argument is already an Effect.provide call
              if (node.arguments.length > 0) {
                const arg = node.arguments[0];
                if (
                  n.CallExpression.check(arg) &&
                  n.MemberExpression.check(arg.callee) &&
                  n.Identifier.check(arg.callee.object) &&
                  arg.callee.object.name === "Effect" &&
                  n.Identifier.check(arg.callee.property) &&
                  arg.callee.property.name === "provide"
                ) {
                  log(
                    "[Codemod] Effect.run is already wrapped with Effect.provide",
                  );
                  effectRunAlreadyWrapped = true;
                }
              }

              return false;
            }
          }
        }

        this.traverse(path);
      },
    });

    if (!effectRunPath) {
      result.errors.push(
        `Could not find Effect.run* call on line ${fix.targetLine}`,
      );
      log("[Codemod] Could not find Effect.run* call");
      return result;
    }

    // Determine what we need to do
    if (existingAppLayerDecl) {
      // Case 2: Merge new layers into existing AppLayer
      log("[Codemod] Case 2: Merging into existing AppLayer");
      log("[Codemod] Existing layers:", existingLayerNames);
      log("[Codemod] New layers:", fix.layerNames);

      // Parse the generated layer code to get its AST
      const layerExprAST = recast.parse(`(${fix.generatedCode})`, {
        parser: typescriptParser,
      });
      const newLayerExpr = layerExprAST.program.body[0].expression;

      const decl = existingAppLayerDecl.node.declarations[0];

      // If existing is already Layer.mergeAll, add new layers to its arguments
      // Otherwise, wrap both in a new Layer.mergeAll
      if (
        n.CallExpression.check(decl.init) &&
        n.MemberExpression.check(decl.init.callee) &&
        n.Identifier.check(decl.init.callee.object) &&
        decl.init.callee.object.name === "Layer" &&
        n.Identifier.check(decl.init.callee.property) &&
        decl.init.callee.property.name === "mergeAll"
      ) {
        // Extract arguments from new expression if it's also Layer.mergeAll, otherwise add directly
        if (
          n.CallExpression.check(newLayerExpr) &&
          n.MemberExpression.check(newLayerExpr.callee) &&
          n.Identifier.check(newLayerExpr.callee.object) &&
          newLayerExpr.callee.object.name === "Layer" &&
          n.Identifier.check(newLayerExpr.callee.property) &&
          newLayerExpr.callee.property.name === "mergeAll"
        ) {
          // Flatten: add each argument from the new Layer.mergeAll
          for (const arg of newLayerExpr.arguments) {
            decl.init.arguments.push(arg);
          }
          log("[Codemod] Flattened and appended Layer.mergeAll arguments");
        } else {
          // Add the expression directly
          decl.init.arguments.push(newLayerExpr);
          log("[Codemod] Appended to existing Layer.mergeAll");
        }
      } else {
        // Wrap existing and new in Layer.mergeAll
        const mergedExpr = b.callExpression(
          b.memberExpression(b.identifier("Layer"), b.identifier("mergeAll")),
          [decl.init, newLayerExpr],
        );
        decl.init = mergedExpr;
        log("[Codemod] Wrapped in new Layer.mergeAll");
      }

      result.changes.push(
        `Added layers to AppLayer: ${fix.layerNames.join(", ")}`,
      );
    } else {
      // Case 1: Create new AppLayer and wrap Effect.run
      log("[Codemod] Case 1: Creating new AppLayer");

      if (!insertionStatement) {
        result.errors.push("Could not find containing statement for insertion");
        log("[Codemod] No insertion statement found");
        return result;
      }

      // Parse the generated layer code
      const layerAST = recast.parse(`const AppLayer = ${fix.generatedCode}`, {
        parser: typescriptParser,
      });
      const layerDeclaration = layerAST.program.body[0];

      // Insert the layer declaration before the statement
      insertionStatement.insertBefore(layerDeclaration);
      result.changes.push("Inserted AppLayer variable with layer composition");
    }

    // Wrap Effect.run argument with Effect.provide if not already wrapped
    if (!effectRunAlreadyWrapped) {
      log("[Codemod] Wrapping Effect.run argument with Effect.provide");

      const node = effectRunPath.node;
      const effectArg = node.arguments[0];
      const provideCall = b.callExpression(
        b.memberExpression(b.identifier("Effect"), b.identifier("provide")),
        [effectArg, b.identifier("AppLayer")],
      );
      node.arguments[0] = provideCall;

      result.changes.push(
        "Modified Effect.run call to use Effect.provide(..., AppLayer)",
      );
    } else {
      log("[Codemod] Effect.run already wrapped, skipping");
      result.changes.push("Effect.run already wrapped with Effect.provide");
    }

    log("[Codemod] Generating modified code with recast.print");

    // Generate the modified code
    const output = recast.print(ast, {
      quote: "double",
      trailingComma: false,
    }).code;

    log(`[Codemod] Writing file: ${fix.targetFile}`);

    fs.writeFileSync(fix.targetFile, output, "utf-8");
    result.success = true;

    log("[Codemod] File written successfully, success=true");

    return result;
  } catch (error) {
    log(`[Codemod] Error caught: ${error}`);
    result.errors.push(String(error));
    return result;
  }
}

/**
 * Get character position from line number (1-based)
 */
function getPositionFromLine(sourceText: string, lineNumber: number): number {
  const lines = sourceText.split("\n");
  if (lineNumber < 1 || lineNumber > lines.length) {
    return -1;
  }

  let position = 0;
  for (let i = 0; i < lineNumber - 1; i++) {
    position += lines[i].length + 1; // +1 for newline
  }

  return position;
}

/**
 * Get character position from line and column (both 1-based in recast)
 */
function getPositionFromLocation(
  sourceText: string,
  line: number,
  column: number,
): number {
  const lines = sourceText.split("\n");
  if (line < 1 || line > lines.length) {
    return -1;
  }

  let position = 0;
  for (let i = 0; i < line - 1; i++) {
    position += lines[i].length + 1;
  }
  position += column;

  return position;
}
