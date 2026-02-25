/**
 * Effect DevTools Runtime
 *
 * This module runs the Effect DevTools server and demo client OUTSIDE of Solid.
 * It uses the global store actions that are set when the StoreProvider mounts.
 *
 * Span and metric data flow through SpanStore (Effect service) and are bridged
 * to Solid.js via the Solid bridge. Client/server status and layer analysis
 * still flow through StoreActionsService.
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
import { pipe } from "effect/Function";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { BunContext } from "@effect/platform-bun";
import type { SetStoreFunction } from "solid-js/store";
import { runServer, ServerContext, type Client } from "./server";
import {
  StoreActionsService,
  makeStoreActionsLayer,
} from "./storeActionsService";
import type { StoreActions, StoreState } from "./storeTypes";
import type * as Domain from "@effect/experimental/DevTools/Domain";
import { runLayerAnalysis, applyLayerSuggestion } from "./layerAnalysis";
import { runMcpServer, MCP_PORT } from "./mcp/server";
import { SpanStore, SpanStoreLive } from "./spanStore/service";
import { createSolidBridge } from "./spanStore/solidBridge";
import {
  simplifySpan,
  simplifySpanEvent,
  simplifyMetric,
} from "./spanStore/simplify";

export const PORT = 34437;

// =============================================================================
// Analysis Controller - manages layer analysis lifecycle
// =============================================================================

/** Commands that can be sent to the analysis controller */
type AnalysisCommand =
  | { _tag: "Start"; projectPath: string }
  | { _tag: "Cancel" };

/** Global command queue - the only module-level state we need */
const analysisCommandQueueRef: { current: Queue.Queue<AnalysisCommand> | null } = { current: null };

/** Global store actions layer for apply fix (needed for triggerLayerFix) */
const globalStoreActionsLayerRef: { current: Layer.Layer<StoreActionsService> | null } = { current: null };

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
  analysisCommandQueueRef.current = commandQueue;

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

// =============================================================================
// Client Handler
// =============================================================================

/**
 * Handles a connected client: subscribes to its span and metric streams,
 * simplifies Domain types, and writes them to SpanStore.
 */
const handleClient = (client: Client) =>
  Effect.gen(function* () {
    const spanStore = yield* SpanStore;

    console.log(
      `[Runtime] Starting span subscription for client ${client.name}`,
    );
    const spanQueue = yield* client.spans;

    // Subscribe to spans
    yield* pipe(
      Stream.fromQueue(spanQueue),
      Stream.runForEach((spanOrEvent: Domain.Span | Domain.SpanEvent) =>
        spanOrEvent._tag === "Span"
          ? spanStore.addSpan(simplifySpan(spanOrEvent), client.id)
          : spanStore.addSpanEvent(
              simplifySpanEvent(spanOrEvent),
              spanOrEvent.spanId,
              client.id,
            ),
      ),
      Effect.fork,
    );

    // Subscribe to metrics
    const metricsQueue = yield* client.metrics;
    yield* pipe(
      Stream.fromQueue(metricsQueue),
      Stream.runForEach((snapshot: Domain.MetricsSnapshot) =>
        spanStore.updateMetrics(
          (snapshot.metrics as Domain.Metric[]).map(simplifyMetric),
          client.id,
        ),
      ),
      Effect.fork,
    );

    // Poll for metrics every 500ms (similar to vscode-extension default)
    yield* pipe(
      client.requestMetrics,
      Effect.repeat(Schedule.spaced("500 millis")),
      Effect.fork,
    );

    // Keep the effect alive
    yield* Effect.never;
  }).pipe(Effect.scoped, Effect.ignoreLogged);

// =============================================================================
// Program
// =============================================================================

/**
 * Bridge arguments passed from the Solid StoreProvider.
 * When provided, the program forks the Solid bridge so SpanStore events
 * are reflected in the reactive UI store.
 */
interface BridgeArgs {
  readonly setStore: SetStoreFunction<StoreState>;
  readonly getActiveClient: () => Option.Option<Client>;
}

/**
 * The main Effect program that:
 * 1. Starts the DevTools WebSocket server
 * 2. Subscribes to client connections
 * 3. Subscribes to span streams from connected clients (ALL clients, not just active)
 * 4. Writes span/metric data to SpanStore
 * 5. Optionally forks the Solid bridge to sync SpanStore -> Solid store
 *
 * Uses SpanStore for data flow and StoreActionsService for client/server status.
 */
const makeProgram = (bridgeArgs?: BridgeArgs) =>
  Effect.gen(function* () {
    const actions = yield* StoreActionsService;
    const { clients, activeClient: activeClientRef } = yield* ServerContext;

    // Subscribe to client changes and update the store
    yield* pipe(
      Stream.runForEach(clients.changes, (clientSet) =>
        Effect.gen(function* () {
          yield* actions.setClientsFromHashSet(clientSet);
          console.log(`[Runtime] Clients updated: ${HashSet.size(clientSet)}`);
        }),
      ),
      Effect.fork,
    );

    // Subscribe to active client changes
    yield* pipe(
      Stream.runForEach(activeClientRef.changes, (maybeClient) =>
        Effect.gen(function* () {
          yield* actions.setActiveClient(maybeClient);
          if (Option.isSome(maybeClient)) {
            console.log(
              `[Runtime] Active client set to ${maybeClient.value.name}`,
            );
          } else {
            console.log("[Runtime] Active client cleared");
          }
        }),
      ),
      Effect.fork,
    );

    // Track active client fibers to manage their lifecycle
    const clientFibers = new Map<number, Fiber.RuntimeFiber<void, unknown>>();

    // Subscribe to ALL clients and handle each concurrently
    // This ensures we get spans from all connected clients, not just the active one
    // We track clients by ID to avoid restarting subscriptions when the set changes
    yield* pipe(
      clients.changes,
      Stream.runForEach((clientSet) =>
        Effect.gen(function* () {
          const currentIds = new Set(Array.from(clientSet).map((c) => c.id));

          // Stop fibers for clients that are no longer present
          yield* Effect.forEach(
            Array.from(clientFibers.entries()).filter(
              ([id]) => !currentIds.has(id),
            ),
            ([id, fiber]) =>
              Effect.gen(function* () {
                console.log(
                  `[Runtime] Client ${id} disconnected, stopping fiber`,
                );
                yield* Fiber.interrupt(fiber);
                clientFibers.delete(id);
              }),
            { discard: true },
          );

          // Start fibers for new clients
          yield* Effect.forEach(
            Array.from(clientSet).filter((c) => !clientFibers.has(c.id)),
            (client) =>
              Effect.gen(function* () {
                console.log(
                  `[Runtime] New client ${client.name} (${client.id}), starting fiber`,
                );
                const fiber = yield* handleClient(client).pipe(Effect.fork);
                clientFibers.set(client.id, fiber);
              }),
            { discard: true },
          );
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

    // Start the Solid bridge if bridge args are provided
    if (bridgeArgs) {
      yield* Effect.fork(
        createSolidBridge(bridgeArgs.setStore, bridgeArgs.getActiveClient).pipe(
          Effect.scoped,
          Effect.catchAllCause((cause) =>
            Effect.sync(() =>
              console.error("[Runtime] Solid bridge error:", cause),
            ),
          ),
        ),
      );
      console.log("[Runtime] Solid bridge started");
    }

    // Run forever
    yield* Effect.never;
  });

const runtimeStartedRef = { current: false };

/**
 * Start the Effect runtime with the provided store actions, store getter,
 * and optional Solid store setter for the SpanStore bridge.
 *
 * The store actions are passed in from the Solid StoreProvider,
 * wrapped in a Layer, and provided to the Effect program.
 * The store getter provides read-only access to the current store state for MCP tools.
 * The setStore enables the SpanStore -> Solid bridge for reactive UI updates.
 */
export function startRuntime(
  storeActions: StoreActions,
  getStore?: () => StoreState,
  setStore?: SetStoreFunction<StoreState>,
): void {
  if (runtimeStartedRef.current) {
    console.log("[Runtime] Runtime already started, skipping");
    return;
  }

  runtimeStartedRef.current = true;
  console.log("[Runtime] Starting Effect runtime");

  // Provide WebSocketConstructor for the server
  const WebSocketLive = NodeSocket.layerWebSocketConstructor;

  // Create the StoreActionsService layer from the real Solid actions
  const StoreActionsLive = makeStoreActionsLayer(storeActions);
  globalStoreActionsLayerRef.current = StoreActionsLive;

  // Compose all layers including SpanStoreLive
  const MainLive = Layer.mergeAll(
    Layer.provide(ServerContext.Live, WebSocketLive),
    StoreActionsLive,
    SpanStoreLive,
    BunContext.layer,
  );

  // Build bridge args if setStore is provided
  const bridgeArgs: BridgeArgs | undefined =
    setStore && getStore
      ? {
          setStore,
          getActiveClient: () => getStore().activeClient,
        }
      : undefined;

  const runnable = makeProgram(bridgeArgs).pipe(Effect.provide(MainLive));

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
  if (analysisCommandQueueRef.current) {
    Effect.runSync(
      Queue.offer(analysisCommandQueueRef.current, {
        _tag: "Start",
        projectPath,
      }),
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
  if (analysisCommandQueueRef.current) {
    Effect.runSync(
      Queue.offer(analysisCommandQueueRef.current, { _tag: "Cancel" }),
    );
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
  if (globalStoreActionsLayerRef.current) {
    console.log(
      "[Runtime] globalStoreActionsLayer is available, running applyLayerSuggestion",
    );
    // Run applyLayerSuggestion in the runtime
    Effect.runPromise(
      applyLayerSuggestion().pipe(
        Effect.provide(globalStoreActionsLayerRef.current),
      ),
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
