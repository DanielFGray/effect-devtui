/**
 * Interactive Effect Test Client
 *
 * An interactive app that generates different spans based on keyboard input.
 * Connect this to the DevTools TUI server to test navigation.
 *
 * Controls:
 *  1 - Run userWorkflow (nested: fetchUser, processUser [validateEmail, enrichData], saveUser)
 *  2 - Run databaseQuery (nested: connect, executeQuery, parseResults)
 *  3 - Run apiRequest (nested: authenticate, fetchData [rateLimit, transform], cacheResponse)
 *  t - Toggle auto-timer (runs userWorkflow every 3s)
 *  q - Quit
 */

import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Fiber from "effect/Fiber";
import * as Schedule from "effect/Schedule";
import * as Layer from "effect/Layer";
import { DevTools } from "@effect/experimental";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as readline from "node:readline";

// Connect to the DevTools TUI server
const DEVTOOLS_URL = "ws://localhost:34437";

// ============================================================================
// Workflow 1: User Workflow
// ============================================================================

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

const saveUser = (user: any) =>
  Effect.gen(function* () {
    yield* Effect.log(`Saving user ${user.name}`);
    yield* Effect.sleep("75 millis");
  }).pipe(Effect.withSpan("saveUser", { attributes: { userId: user.id } }));

const userWorkflow = (userId: number) =>
  Effect.gen(function* () {
    const user = yield* fetchUser(userId);
    const processed = yield* processUser(user);
    yield* saveUser(processed);
    yield* Effect.log(`Completed workflow for user ${userId}`);
  }).pipe(Effect.withSpan("userWorkflow", { attributes: { userId } }));

// ============================================================================
// Workflow 2: Database Query
// ============================================================================

const connectToDatabase = Effect.gen(function* () {
  yield* Effect.log("Connecting to database");
  yield* Effect.sleep("80 millis");
}).pipe(Effect.withSpan("connect"));

const executeQuery = (query: string) =>
  Effect.gen(function* () {
    yield* Effect.log(`Executing query: ${query}`);
    yield* Effect.sleep("120 millis");
    return [
      { id: 1, data: "row1" },
      { id: 2, data: "row2" },
    ];
  }).pipe(Effect.withSpan("executeQuery", { attributes: { query } }));

const parseResults = (results: any[]) =>
  Effect.gen(function* () {
    yield* Effect.log(`Parsing ${results.length} results`);
    yield* Effect.sleep("40 millis");
    return results.map((r) => ({ ...r, parsed: true }));
  }).pipe(Effect.withSpan("parseResults"));

const databaseQuery = (query: string) =>
  Effect.gen(function* () {
    yield* connectToDatabase;
    const results = yield* executeQuery(query);
    const parsed = yield* parseResults(results);
    yield* Effect.log(`Database query completed with ${parsed.length} rows`);
  }).pipe(Effect.withSpan("databaseQuery", { attributes: { query } }));

// ============================================================================
// Workflow 3: API Request
// ============================================================================

const authenticate = Effect.gen(function* () {
  yield* Effect.log("Authenticating API request");
  yield* Effect.sleep("60 millis");
  return "token-12345";
}).pipe(Effect.withSpan("authenticate"));

const fetchData = (_token: string, endpoint: string) =>
  Effect.gen(function* () {
    yield* Effect.log(`Fetching data from ${endpoint}`);
    yield* Effect.sleep("90 millis");

    // Nested: check rate limit
    yield* Effect.gen(function* () {
      yield* Effect.log("Checking rate limit");
      yield* Effect.sleep("15 millis");
    }).pipe(Effect.withSpan("rateLimit"));

    // Nested: transform data
    yield* Effect.gen(function* () {
      yield* Effect.log("Transforming response data");
      yield* Effect.sleep("25 millis");
    }).pipe(Effect.withSpan("transform"));

    return { data: "api-response", endpoint };
  }).pipe(Effect.withSpan("fetchData", { attributes: { endpoint } }));

const cacheResponse = (_response: any) =>
  Effect.gen(function* () {
    yield* Effect.log("Caching API response");
    yield* Effect.sleep("35 millis");
  }).pipe(Effect.withSpan("cacheResponse"));

const apiRequest = (endpoint: string) =>
  Effect.gen(function* () {
    const token = yield* authenticate;
    const response = yield* fetchData(token, endpoint);
    yield* cacheResponse(response);
    yield* Effect.log(`API request to ${endpoint} completed`);
  }).pipe(Effect.withSpan("apiRequest", { attributes: { endpoint } }));

// ============================================================================
// Helper for reading input
// ============================================================================

const readLine = (prompt: string): Effect.Effect<string> =>
  Effect.async<string>((resume) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resume(Effect.succeed(answer));
    });
  });

// ============================================================================
// Interactive Program
// ============================================================================

const program = Effect.gen(function* () {
  const timerRunning = yield* Ref.make(false);
  const timerFiber = yield* Ref.make<Fiber.RuntimeFiber<any, any> | null>(null);

  console.log("\n=== Interactive Effect Test Client ===");
  console.log("Connected to DevTools at " + DEVTOOLS_URL);
  console.log("\nControls:");
  console.log(
    "  1 - Run userWorkflow (fetchUser -> processUser [validateEmail, enrichData] -> saveUser)",
  );
  console.log(
    "  2 - Run databaseQuery (connect -> executeQuery -> parseResults)",
  );
  console.log(
    "  3 - Run apiRequest (authenticate -> fetchData [rateLimit, transform] -> cacheResponse)",
  );
  console.log("  t - Toggle auto-timer (runs userWorkflow every 3s)");
  console.log("  q - Quit\n");

  // Main input loop
  while (true) {
    const input = yield* readLine("> ");

    if (input === "q") {
      console.log("Quitting...");
      // Stop timer if running
      const fiber = yield* Ref.get(timerFiber);
      if (fiber) {
        yield* Fiber.interrupt(fiber);
      }
      break;
    } else if (input === "1") {
      console.log("Running userWorkflow...");
      yield* Effect.fork(userWorkflow(1));
    } else if (input === "2") {
      console.log("Running databaseQuery...");
      yield* Effect.fork(databaseQuery("SELECT * FROM users"));
    } else if (input === "3") {
      console.log("Running apiRequest...");
      yield* Effect.fork(apiRequest("/api/v1/data"));
    } else if (input === "t") {
      const running = yield* Ref.get(timerRunning);
      if (running) {
        // Stop timer
        const fiber = yield* Ref.get(timerFiber);
        if (fiber) {
          yield* Fiber.interrupt(fiber);
        }
        yield* Ref.set(timerRunning, false);
        console.log("Auto-timer stopped.");
      } else {
        // Start timer
        const fiber = yield* Effect.fork(
          Effect.repeat(
            Effect.gen(function* () {
              console.log("[Timer] Running userWorkflow...");
              yield* userWorkflow(1);
            }),
            Schedule.spaced("3 seconds"),
          ),
        );
        yield* Ref.set(timerFiber, fiber);
        yield* Ref.set(timerRunning, true);
        console.log("Auto-timer started (runs every 3s).");
      }
    } else {
      console.log(`Unknown command: ${input}`);
    }
  }
}).pipe(
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

// Run the program
Effect.runFork(program.pipe(Effect.provide(MainLive)));
