/**
 * Effect DevTools Runtime
 *
 * This module runs the Effect DevTools server and demo client OUTSIDE of Solid.
 * It uses the global store actions that are set when the StoreProvider mounts.
 */

import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Queue from "effect/Queue";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { BunContext } from "@effect/platform-bun";
import { runServer, ServerContext, type Client } from "./server";
import {
  StoreActionsService,
  makeStoreActionsLayer,
} from "./storeActionsService";
import type { StoreActions, StoreState } from "./storeTypes";
import type * as Domain from "@effect/experimental/DevTools/Domain";
import { runLayerAnalysis, applyLayerSuggestion } from "./layerAnalysis";
import { runMcpServer, MCP_PORT } from "./mcp/server";

export const PORT = 34437;

// =============================================================================
// Analysis Controller - manages layer analysis lifecycle
// =============================================================================

/** Commands that can be sent to the analysis controller */
type AnalysisCommand =
  | { _tag: "Start"; projectPath: string }
  | { _tag: "Cancel" };

/** Global command queue - the only module-level state we need */
let analysisCommandQueue: Queue.Queue<AnalysisCommand> | null = null;

/** Global store actions layer for apply fix (needed for triggerLayerFix) */
let globalStoreActionsLayer: Layer.Layer<StoreActionsService> | null = null;

/**
 * Creates an analysis controller that manages the analysis fiber lifecycle
 * using Effect Refs instead of module-level mutable state.
 */
const createAnalysisController = Effect.gen(function* () {
  // Ref to track the current analysis fiber
  const currentFiberRef = yield* Ref.make<Fiber.RuntimeFiber<
    void,
    unknown
  > | null>(null);

  // Command queue for analysis requests
  const commandQueue = yield* Queue.unbounded<AnalysisCommand>();

  // Expose the queue globally for the UI to send commands
  analysisCommandQueue = commandQueue;

  return {
    commandQueue,
    currentFiberRef,
  };
});

/**
 * Runs the analysis controller loop, processing commands from the queue
 */
const runAnalysisController = (controller: {
  commandQueue: Queue.Queue<AnalysisCommand>;
  currentFiberRef: Ref.Ref<Fiber.RuntimeFiber<void, unknown> | null>;
}) =>
  Effect.gen(function* () {
    const { commandQueue, currentFiberRef } = controller;

    yield* Stream.runForEach(Stream.fromQueue(commandQueue), (command) =>
      Effect.gen(function* () {
        const actions = yield* StoreActionsService;

        switch (command._tag) {
          case "Cancel": {
            const currentFiber = yield* Ref.get(currentFiberRef);
            if (currentFiber) {
              console.log("[Runtime] Cancelling layer analysis");
              yield* Fiber.interrupt(currentFiber);
              yield* Ref.set(currentFiberRef, null);
              yield* actions.setLayerAnalysisStatus("idle");
              yield* actions.setLayerAnalysisProgress(null);
            }
            break;
          }

          case "Start": {
            // Cancel previous analysis if running
            const currentFiber = yield* Ref.get(currentFiberRef);
            if (currentFiber) {
              console.log("[Runtime] Cancelling previous analysis");
              yield* Fiber.interrupt(currentFiber);
            }

            console.log(
              `[Runtime] Triggering layer analysis for ${command.projectPath}`,
            );

            // Fork the analysis and track the fiber
            const fiber = yield* runLayerAnalysis(command.projectPath).pipe(
              Effect.ensuring(
                // Clear the fiber ref when analysis completes (success or failure)
                Ref.set(currentFiberRef, null),
              ),
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  const storeActions = yield* StoreActionsService;
                  console.error("[Runtime] Layer analysis failed:", error);
                  yield* storeActions.setLayerAnalysisError(String(error));
                  yield* storeActions.setLayerAnalysisStatus("error");
                  yield* storeActions.setLayerAnalysisProgress(null);
                }),
              ),
              Effect.fork,
            );

            yield* Ref.set(currentFiberRef, fiber);
            break;
          }
        }
      }),
    );
  });

/**
 * The main Effect program that:
 * 1. Starts the DevTools WebSocket server
 * 2. Subscribes to client connections
 * 3. Subscribes to span streams from connected clients (ALL clients, not just active)
 * 4. Writes all data to the store via actions
 *
 * Now uses StoreActionsService via dependency injection instead of getGlobalActions().
 */
const program = Effect.gen(function* () {
  const actions = yield* StoreActionsService;
  const { clients, activeClient: activeClientRef } = yield* ServerContext;

  // Subscribe to client changes and update the store
  yield* Stream.runForEach(clients.changes, (clientSet) =>
    Effect.gen(function* () {
      yield* actions.setClientsFromHashSet(clientSet);
      console.log(`[Runtime] Clients updated: ${HashSet.size(clientSet)}`);
    }),
  ).pipe(Effect.fork);

  // Subscribe to active client changes
  yield* Stream.runForEach(activeClientRef.changes, (maybeClient) =>
    Effect.gen(function* () {
      yield* actions.setActiveClient(maybeClient);
      if (Option.isSome(maybeClient)) {
        console.log(`[Runtime] Active client set to ${maybeClient.value.name}`);
      } else {
        console.log("[Runtime] Active client cleared");
      }
    }),
  ).pipe(Effect.fork);

  // Handle each client's span stream and metrics
  // This is similar to TracerProvider.ts and MetricsProvider.ts in vscode-extension
  const handleClient = (client: Client) =>
    Effect.gen(function* () {
      const storeActions = yield* StoreActionsService;

      console.log(
        `[Runtime] Starting span subscription for client ${client.name}`,
      );
      const spanQueue = yield* client.spans;
      console.log(
        `[Runtime] Got span queue for client ${client.name}, starting stream`,
      );

      // Subscribe to spans
      yield* Stream.runForEach(
        Stream.fromQueue(spanQueue),
        (spanOrEvent: Domain.Span | Domain.SpanEvent) =>
          Effect.gen(function* () {
            console.log(
              `[Runtime] Received ${spanOrEvent._tag} from ${client.name}`,
            );
            if (spanOrEvent._tag === "Span") {
              console.log(
                `[Runtime] Calling storeActions.addSpan for ${spanOrEvent.name}`,
              );
              yield* storeActions.addSpan(spanOrEvent, client.id);
              console.log(`[Runtime] Called storeActions.addSpan successfully`);
            } else if (spanOrEvent._tag === "SpanEvent") {
              console.log(
                `[Runtime] Calling storeActions.addSpanEvent for ${spanOrEvent.name}`,
              );
              yield* storeActions.addSpanEvent(spanOrEvent, client.id);
              console.log(
                `[Runtime] Called storeActions.addSpanEvent successfully`,
              );
            }
          }),
      ).pipe(Effect.fork);

      // Subscribe to metrics
      console.log(
        `[Runtime] Starting metrics subscription for client ${client.name}`,
      );
      const metricsQueue = yield* client.metrics;
      yield* Stream.runForEach(
        Stream.fromQueue(metricsQueue),
        (snapshot: Domain.MetricsSnapshot) =>
          Effect.gen(function* () {
            yield* storeActions.updateMetrics(snapshot, client.id);
          }),
      ).pipe(Effect.fork);

      // Poll for metrics every 500ms (similar to vscode-extension default)
      yield* client.requestMetrics.pipe(
        Effect.repeat(Schedule.spaced("500 millis")),
        Effect.fork,
      );

      // Keep the effect alive
      yield* Effect.never;
    }).pipe(Effect.scoped, Effect.ignoreLogged);

  // Track active client fibers to manage their lifecycle
  const clientFibers = new Map<number, Fiber.RuntimeFiber<void, unknown>>();

  // Subscribe to ALL clients and handle each concurrently
  // This ensures we get spans from all connected clients, not just the active one
  // We track clients by ID to avoid restarting subscriptions when the set changes
  yield* clients.changes.pipe(
    Stream.runForEach((clientSet) =>
      Effect.gen(function* () {
        const currentIds = new Set(Array.from(clientSet).map((c) => c.id));

        // Stop fibers for clients that are no longer present
        for (const [id, fiber] of clientFibers) {
          if (!currentIds.has(id)) {
            console.log(`[Runtime] Client ${id} disconnected, stopping fiber`);
            yield* Fiber.interrupt(fiber);
            clientFibers.delete(id);
          }
        }

        // Start fibers for new clients
        for (const client of clientSet) {
          if (!clientFibers.has(client.id)) {
            console.log(
              `[Runtime] New client ${client.name} (${client.id}), starting fiber`,
            );
            const fiber = yield* handleClient(client).pipe(Effect.fork);
            clientFibers.set(client.id, fiber);
          }
        }
      }),
    ),
    Effect.fork,
  );

  // Run the server
  yield* Effect.fork(runServer(PORT));

  // Wait for server to be ready
  yield* Effect.sleep("500 millis");
  yield* actions.setServerStatus("listening");
  console.log("[Runtime] Server is listening");

  // Create and run the analysis controller
  const analysisController = yield* createAnalysisController;
  yield* Effect.fork(runAnalysisController(analysisController));

  // Run forever
  yield* Effect.never;
});

let runtimeStarted = false;

/**
 * Start the Effect runtime with the provided store actions and store getter.
 *
 * The store actions are passed in from the Solid StoreProvider,
 * wrapped in a Layer, and provided to the Effect program.
 * The store getter provides read-only access to the current store state for MCP tools.
 */
export function startRuntime(
  storeActions: StoreActions,
  getStore?: () => StoreState,
): void {
  if (runtimeStarted) {
    console.log("[Runtime] Runtime already started, skipping");
    return;
  }

  runtimeStarted = true;
  console.log("[Runtime] Starting Effect runtime");

  // Provide WebSocketConstructor for the server
  const WebSocketLive = NodeSocket.layerWebSocketConstructor;

  // Create the StoreActionsService layer from the real Solid actions
  const StoreActionsLive = makeStoreActionsLayer(storeActions);
  globalStoreActionsLayer = StoreActionsLive;
  // Compose all layers (no longer includes MCP - it runs separately)
  const MainLive = Layer.mergeAll(
    Layer.provide(ServerContext.Live, WebSocketLive),
    StoreActionsLive,
    BunContext.layer,
  );

  const runnable = program.pipe(Effect.provide(MainLive));

  // Run the Effect program (fire and forget)
  Effect.runFork(runnable);

  // Start MCP server on separate port if store getter is provided
  if (getStore) {
    console.log(`[Runtime] Starting MCP server on port ${MCP_PORT}`);
    Effect.runFork(
      runMcpServer(getStore).pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() =>
            console.error("[Runtime] MCP server error:", cause),
          ),
        ),
      ),
    );
  }
}

/**
 * Trigger layer analysis from the UI
 * Sends a Start command to the analysis controller
 */
export function triggerLayerAnalysis(
  projectPath: string = process.cwd(),
): void {
  if (analysisCommandQueue) {
    Effect.runSync(
      Queue.offer(analysisCommandQueue, { _tag: "Start", projectPath }),
    );
  } else {
    console.warn("[Runtime] Analysis command queue not initialized yet");
  }
}

/**
 * Cancel the currently running layer analysis
 * Sends a Cancel command to the analysis controller
 */
export function cancelLayerAnalysis(): void {
  if (analysisCommandQueue) {
    Effect.runSync(Queue.offer(analysisCommandQueue, { _tag: "Cancel" }));
  } else {
    console.warn("[Runtime] Analysis command queue not initialized yet");
  }
}

/**
 * Trigger application of layer fix with user selections
 * This is called from the UI when user presses Enter/Apply
 */
export function triggerLayerFix(): void {
  console.log("[Runtime] triggerLayerFix called");
  if (globalStoreActionsLayer) {
    console.log(
      "[Runtime] globalStoreActionsLayer is available, running applyLayerSuggestion",
    );
    // Run applyLayerSuggestion in the runtime
    Effect.runPromise(
      applyLayerSuggestion().pipe(Effect.provide(globalStoreActionsLayer)),
    )
      .then(() => {
        console.log("[Runtime] applyLayerSuggestion completed successfully");
      })
      .catch((error) => {
        console.error("[Runtime] Failed to apply layer fix:", error);
      });
  } else {
    console.warn(
      "[Runtime] Runtime not initialized yet - globalStoreActionsLayer is null",
    );
  }
}
