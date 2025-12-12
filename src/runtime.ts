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
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { runServer, ServerContext, type Client } from "./server";
import { getGlobalActions, type StoreActions } from "./store";
import type * as Domain from "@effect/experimental/DevTools/Domain";

export const PORT = 34437;

/**
 * Wait for global store actions to be available (set by StoreProvider)
 */
function waitForActions(): Effect.Effect<StoreActions> {
  return Effect.gen(function* () {
    let attempts = 0;
    while (attempts < 100) {
      const actions = getGlobalActions();
      if (actions) {
        console.log("[Runtime] Got global store actions");
        return actions;
      }
      yield* Effect.sleep("50 millis");
      attempts++;
    }
    throw new Error("Store actions not available after 5 seconds");
  });
}

/**
 * The main Effect program that:
 * 1. Waits for Solid store to be ready
 * 2. Starts the DevTools WebSocket server
 * 3. Subscribes to client connections
 * 4. Subscribes to span streams from connected clients (ALL clients, not just active)
 * 5. Writes all data to the store via actions
 *
 * NOTE: We call getGlobalActions() every time we need actions, rather than
 * capturing them once. This allows hot reload to work - when StoreProvider
 * re-initializes, it updates globalStoreActions, and we pick up the new reference.
 */
const program = Effect.gen(function* () {
  // Wait for Solid store to be ready
  yield* waitForActions();

  const { clients, activeClient: activeClientRef } = yield* ServerContext;

  // Subscribe to client changes and update the store
  yield* Stream.runForEach(clients.changes, (clientSet) =>
    Effect.sync(() => {
      const actions = getGlobalActions();
      if (!actions) {
        console.log(
          "[Runtime] WARNING: No actions available in clients.changes handler",
        );
        return;
      }
      actions.setClientsFromHashSet(clientSet);
      console.log(`[Runtime] Clients updated: ${HashSet.size(clientSet)}`);
    }),
  ).pipe(Effect.fork);

  // Subscribe to active client changes
  yield* Stream.runForEach(activeClientRef.changes, (maybeClient) =>
    Effect.sync(() => {
      const actions = getGlobalActions();
      if (!actions) {
        console.log(
          "[Runtime] WARNING: No actions available in activeClient.changes handler",
        );
        return;
      }
      actions.setActiveClient(maybeClient);
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
          Effect.sync(() => {
            const actions = getGlobalActions();
            if (!actions) {
              console.log(
                "[Runtime] WARNING: No actions available in span handler",
              );
              return;
            }

            console.log(
              `[Runtime] Received ${spanOrEvent._tag} from ${client.name}`,
            );
            if (spanOrEvent._tag === "Span") {
              console.log(
                `[Runtime] Calling actions.addSpan for ${spanOrEvent.name}`,
              );
              try {
                actions.addSpan(spanOrEvent);
                console.log(`[Runtime] Called actions.addSpan successfully`);
              } catch (e) {
                console.log(`[Runtime] Error calling actions.addSpan: ${e}`);
              }
            } else if (spanOrEvent._tag === "SpanEvent") {
              console.log(
                `[Runtime] Calling actions.addSpanEvent for ${spanOrEvent.name}`,
              );
              try {
                actions.addSpanEvent(spanOrEvent);
                console.log(
                  `[Runtime] Called actions.addSpanEvent successfully`,
                );
              } catch (e) {
                console.log(
                  `[Runtime] Error calling actions.addSpanEvent: ${e}`,
                );
              }
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
          Effect.sync(() => {
            const actions = getGlobalActions();
            if (!actions) {
              console.log(
                "[Runtime] WARNING: No actions available in metrics handler",
              );
              return;
            }

            try {
              actions.updateMetrics(snapshot);
            } catch (e) {
              console.log(`[Runtime] Error updating metrics: ${e}`);
            }
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
  const actions = getGlobalActions();
  if (actions) {
    actions.setServerStatus("listening");
  }
  console.log("[Runtime] Server is listening");

  // Run forever
  yield* Effect.never;
});

let runtimeStarted = false;

/**
 * Start the Effect runtime.
 * Uses a singleton pattern - only starts once even if called multiple times.
 * This prevents issues with hot reload creating duplicate runtimes.
 */
export function startRuntime(): void {
  if (runtimeStarted) {
    console.log("[Runtime] Runtime already started, skipping");
    return;
  }

  runtimeStarted = true;
  console.log("[Runtime] Starting Effect runtime");

  // Provide WebSocketConstructor for the server
  const WebSocketLive = NodeSocket.layerWebSocketConstructor;

  // Only run the server - do NOT connect a DevTools client to ourselves
  // (that would create a feedback loop of spans)
  const MainLive = Layer.provide(ServerContext.Live, WebSocketLive);

  const runnable = Effect.provide(program, MainLive);

  // Run the Effect program (fire and forget)
  Effect.runFork(runnable);
}
