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
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { BunContext } from "@effect/platform-bun";
import { runServer, ServerContext, type Client } from "./server";
import {
  StoreActionsService,
  makeStoreActionsLayer,
} from "./storeActionsService";
import type { StoreActions } from "./storeTypes";
import type * as Domain from "@effect/experimental/DevTools/Domain";
import { runLayerAnalysis, applyLayerSuggestion } from "./layerAnalysis";

export const PORT = 34437;

// Global analysis queue for triggering layer analysis from UI
let globalAnalysisQueue: Queue.Queue<string> | null = null;

// Global current analysis fiber - used to cancel previous analysis
let currentAnalysisFiber: Fiber.RuntimeFiber<void, unknown> | null = null;

// Global store actions layer for triggering apply from UI
let globalStoreActionsLayer: Layer.Layer<StoreActionsService> | null = null;

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
              yield* storeActions.addSpan(spanOrEvent);
              console.log(`[Runtime] Called storeActions.addSpan successfully`);
            } else if (spanOrEvent._tag === "SpanEvent") {
              console.log(
                `[Runtime] Calling storeActions.addSpanEvent for ${spanOrEvent.name}`,
              );
              yield* storeActions.addSpanEvent(spanOrEvent);
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
            yield* storeActions.updateMetrics(snapshot);
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

  // Subscribe to ALL clients and handle each concurrently
  // This ensures we get spans from all connected clients, not just the active one
  yield* clients.changes.pipe(
    Stream.flatMap(
      (clientSet) =>
        Effect.forEach(Array.from(clientSet), handleClient, {
          concurrency: "unbounded",
        }),
      { switch: true }, // Switch to new set of clients when clientSet changes
    ),
    Stream.runDrain,
    Effect.fork,
  );

  // Run the server
  yield* Effect.fork(runServer(PORT));

  // Wait for server to be ready
  yield* Effect.sleep("500 millis");
  yield* actions.setServerStatus("listening");
  console.log("[Runtime] Server is listening");

  // Create layer analysis queue
  const analysisQueue = yield* Queue.unbounded<string>();
  globalAnalysisQueue = analysisQueue;

  // Subscribe to layer analysis requests
  yield* Stream.runForEach(Stream.fromQueue(analysisQueue), (projectPath) =>
    Effect.gen(function* () {
      // Cancel previous analysis if running
      if (currentAnalysisFiber) {
        console.log("[Runtime] Cancelling previous analysis");
        yield* Fiber.interrupt(currentAnalysisFiber);
        currentAnalysisFiber = null;
      }

      console.log(`[Runtime] Triggering layer analysis for ${projectPath}`);
      const fiber = yield* runLayerAnalysis(projectPath).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const storeActions = yield* StoreActionsService;
            console.error("[Runtime] Layer analysis failed:", error);
            yield* storeActions.setLayerAnalysisError(String(error));
            yield* storeActions.setLayerAnalysisStatus("error");
          }),
        ),
        Effect.fork,
      );

      currentAnalysisFiber = fiber;
    }),
  ).pipe(Effect.fork);

  // Run forever
  yield* Effect.never;
});

let runtimeStarted = false;

/**
 * Start the Effect runtime with the provided store actions.
 *
 * The store actions are passed in from the Solid StoreProvider,
 * wrapped in a Layer, and provided to the Effect program.
 */
export function startRuntime(storeActions: StoreActions): void {
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

  // Compose all layers
  const MainLive = Layer.mergeAll(
    Layer.provide(ServerContext.Live, WebSocketLive),
    StoreActionsLive,
    BunContext.layer,
  );

  const runnable = program.pipe(Effect.provide(MainLive));

  // Run the Effect program (fire and forget)
  Effect.runFork(runnable);
}

/**
 * Trigger layer analysis from the UI
 * Queues an analysis request that will be processed by the Effect runtime
 */
export function triggerLayerAnalysis(
  projectPath: string = process.cwd(),
): void {
  if (globalAnalysisQueue) {
    Effect.runSync(Queue.offer(globalAnalysisQueue, projectPath));
  } else {
    console.warn("[Runtime] Analysis queue not initialized yet");
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
