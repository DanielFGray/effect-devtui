/**
 * Effect Test Application
 *
 * A simple Effect app that connects to the DevTools TUI server
 * and generates spans for testing the tree view.
 */

import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Layer from "effect/Layer";
import { DevTools } from "@effect/experimental";
import * as NodeSocket from "@effect/platform-node/NodeSocket";

// Connect to the DevTools TUI server
const DEVTOOLS_URL = "ws://localhost:34437";

/**
 * Simulates fetching user data from a database
 */
const fetchUser = (userId: number) =>
  Effect.gen(function* () {
    yield* Effect.log(`Fetching user ${userId}`);
    yield* Effect.sleep("100 millis");
    return {
      id: userId,
      name: `User ${userId}`,
      email: `user${userId}@example.com`,
    };
  }).pipe(Effect.withSpan("fetchUser", { attributes: { userId } }));

/**
 * Simulates processing user data
 */
const processUser = (user: { id: number; name: string; email: string }) =>
  Effect.gen(function* () {
    yield* Effect.log(`Processing user ${user.name}`);
    yield* Effect.sleep("50 millis");

    // Nested span: validate email
    yield* Effect.gen(function* () {
      yield* Effect.log(`Validating email ${user.email}`);
      yield* Effect.sleep("20 millis");
    }).pipe(Effect.withSpan("validateEmail"));

    // Nested span: enrich data
    yield* Effect.gen(function* () {
      yield* Effect.log(`Enriching user data`);
      yield* Effect.sleep("30 millis");
    }).pipe(Effect.withSpan("enrichData"));

    return { ...user, processed: true };
  }).pipe(Effect.withSpan("processUser"));

/**
 * Simulates saving to database
 */
const saveUser = (user: any) =>
  Effect.gen(function* () {
    yield* Effect.log(`Saving user ${user.name}`);
    yield* Effect.sleep("75 millis");
  }).pipe(Effect.withSpan("saveUser", { attributes: { userId: user.id } }));

/**
 * Main workflow that orchestrates the operations
 */
const userWorkflow = (userId: number) =>
  Effect.gen(function* () {
    const user = yield* fetchUser(userId);
    const processed = yield* processUser(user);
    yield* saveUser(processed);
    yield* Effect.log(`Completed workflow for user ${userId}`);
  }).pipe(Effect.withSpan("userWorkflow", { attributes: { userId } }));

/**
 * Main program that runs multiple workflows with DevTools connection retry
 */
const program = Effect.gen(function* () {
  yield* Effect.log("Starting Effect test app");
  yield* Effect.log(`Connecting to DevTools at ${DEVTOOLS_URL}`);

  // Run workflows periodically
  yield* Effect.repeat(
    Effect.gen(function* () {
      // Process 3 users in parallel
      yield* Effect.all([userWorkflow(1), userWorkflow(2), userWorkflow(3)], {
        concurrency: 3,
      });
    }),
    Schedule.spaced("3 seconds"),
  );
}).pipe(
  // Retry the entire program if DevTools connection fails
  Effect.retry(
    Schedule.spaced("2 seconds").pipe(Schedule.intersect(Schedule.recurs(5))),
  ),
  Effect.tapError((error) =>
    Effect.log(`Program error: ${error}, retrying connection...`),
  ),
);

// Setup Effect runtime with DevTools
const DevToolsLive = DevTools.layer(DEVTOOLS_URL);
const WebSocketLive = NodeSocket.layerWebSocketConstructor;
const MainLive = Layer.provide(DevToolsLive, WebSocketLive);

// Run the program with retry logic
Effect.runFork(Effect.provide(program, MainLive));

console.log(
  `Effect test app started. Will retry connection up to 5 times. Press Ctrl+C to exit.`,
);
