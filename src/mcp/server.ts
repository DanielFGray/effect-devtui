/**
 * MCP Server Integration
 *
 * This module creates the MCP server layer using @effect/ai's McpServer.
 * It registers the DevTools toolkit and provides the StoreReader dependency.
 */

import * as McpServer from "@effect/ai/McpServer";
import { HttpRouter, HttpServer } from "@effect/platform";
import { BunHttpServer } from "@effect/platform-bun";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import { DevToolsToolkit, DevToolsToolkitHandlers } from "./tools";
import { makeStoreReaderLayer } from "../storeReaderService";
import type { StoreState } from "../storeTypes";

/**
 * MCP server configuration
 */
export const MCP_PORT = 34438;
export const MCP_PATH = "/mcp";

/**
 * Create the MCP server layer.
 *
 * This layer:
 * 1. Creates an HTTP server on a separate port
 * 2. Creates an MCP server at the specified path
 * 3. Registers the DevTools toolkit with all tools
 * 4. Provides the StoreReader service for tool handlers
 *
 * @param getStore - Function to get the current store state
 */
export const makeMcpLayer = (getStore: () => StoreState) => {
  // Create MCP toolkit layer that registers tools with the server
  const ToolkitLayer = McpServer.toolkit(DevToolsToolkit);

  // MCP layer with toolkit registration
  const McpLive = Layer.mergeAll(
    // The MCP HTTP layer creates the server and registers routes on HttpRouter.Default
    McpServer.layerHttp({
      name: "effect-devtools",
      version: "1.0.0",
      path: MCP_PATH,
    }),
    // Register our toolkit with the server
    ToolkitLayer,
  ).pipe(
    // Provide the handlers for our toolkit
    Layer.provide(DevToolsToolkitHandlers),
    // Provide the store reader so handlers can access state
    Layer.provide(makeStoreReaderLayer(getStore)),
  );

  // HTTP server layer using Bun
  const HttpServerLive = BunHttpServer.layer({ port: MCP_PORT });

  // Combine everything: serve the router with MCP routes
  return HttpRouter.Default.unwrap(HttpServer.serve()).pipe(
    HttpServer.withLogAddress,
    Layer.provide(McpLive),
    Layer.provide(HttpServerLive),
  );
};

/**
 * Run the MCP server as an Effect (for use in forked fiber)
 */
export const runMcpServer = (getStore: () => StoreState) =>
  Effect.gen(function* () {
    console.log(`[MCP] Starting MCP server on port ${MCP_PORT}...`);
    yield* Layer.launch(makeMcpLayer(getStore));
  });
