/**
 * MCP Server Integration
 *
 * This module creates the MCP server layer using effect/ai McpServer.
 * It registers the DevTools toolkit and provides the StoreReader dependency.
 * The SpanStore dependency must be provided by the caller (from the main
 * program's layer context) so the MCP tools share the same span data.
 */

import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";
import * as HttpRouter from "effect/http/HttpRouter";
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
  // Registration layer: builds the DevTools tools on the McpServer.
  // DevToolsToolkitHandlers requires SpanStore, which stays a requirement of the layer.
  const ToolkitRegistration = McpServer.toolkit(DevToolsToolkit).pipe(
    // Provide the handlers for our toolkit
    Layer.provide(DevToolsToolkitHandlers),
    // Provide the store reader so handlers can access client state
    Layer.provide(makeStoreReaderLayer(getStore)),
  );

  // Streamable HTTP endpoint, registered on the unified HttpRouter
  const McpLive = McpServer.layerHttp({
    name: "effect-devtui",
    version: "1.0.0",
    path: MCP_PATH,
    protocols: [McpProtocol.v2025_06_18],
    registrations: ToolkitRegistration,
  });

  // Serve the router on its own HTTP port using Bun
  return HttpRouter.serve(McpLive).pipe(
    Layer.provide(BunHttpServer.layer({ port: MCP_PORT })),
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
