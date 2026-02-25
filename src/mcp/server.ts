/**
 * MCP Server Integration
 *
 * This module creates the MCP server layer using @effect/ai's McpServer.
 * It registers the DevTools toolkit and provides the StoreReader dependency.
 * The SpanStore dependency must be provided by the caller (from the main
 * program's layer context) so the MCP tools share the same span data.
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
 * 4. Provides the StoreReader service for client-list queries
 *
 * NOTE: SpanStore is NOT provided here. DevToolsToolkitHandlers requires
 * SpanStore, so it bubbles up as a requirement on the returned layer.
 * The caller of runMcpServer must ensure SpanStore is in the environment.
 *
 * @param getStore - Function to get the current store state (for StoreReader)
 */
export const makeMcpLayer = (getStore: () => StoreState) => {
  // Create MCP toolkit layer that registers tools with the server
  const ToolkitLayer = McpServer.toolkit(DevToolsToolkit);

  // MCP layer with toolkit registration
  // DevToolsToolkitHandlers depends on SpanStore | StoreReader.
  // We provide StoreReader here; SpanStore must come from outside.
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
    // Provide the store reader so handlers can access client state
    Layer.provide(makeStoreReaderLayer(getStore)),
  );

  // HTTP server layer using Bun
  const HttpServerLive = BunHttpServer.layer({ port: MCP_PORT });

  // Combine everything: serve the router with MCP routes
  // SpanStore requirement bubbles up through the layer composition
  return HttpRouter.Default.unwrap(HttpServer.serve()).pipe(
    Layer.provide(McpLive),
    Layer.provide(HttpServerLive),
  );
};

/**
 * Run the MCP server as an Effect (for use in forked fiber).
 *
 * This Effect requires SpanStore in its environment. When called from
 * makeProgram (which provides SpanStoreLive), the MCP tools will share
 * the same SpanStore instance as the rest of the application.
 */
export const runMcpServer = (getStore: () => StoreState) =>
  Effect.gen(function* () {
    console.log(`[MCP] Starting MCP server on port ${MCP_PORT}...`);
    yield* Layer.launch(makeMcpLayer(getStore));
  });
