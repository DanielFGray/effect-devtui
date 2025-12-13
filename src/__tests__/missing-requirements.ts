/**
 * Test file for layer analyzer
 *
 * Tests:
 * 1. Detection of missing service requirements
 * 2. Resolution of available layer candidates
 * 3. Transitive dependency resolution (CacheLive depends on ConfigService)
 * 4. Multiple candidates per service for user selection
 */
import { Effect, Context, Layer } from "effect";

// ============================================================================
// SERVICE DEFINITIONS
// ============================================================================

class DatabaseService extends Context.Tag("DatabaseService")<
  DatabaseService,
  { readonly query: (sql: string) => Effect.Effect<unknown[]> }
>() {}

class LoggingService extends Context.Tag("LoggingService")<
  LoggingService,
  { readonly log: (msg: string) => Effect.Effect<void> }
>() {}

class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  { readonly get: (key: string) => Effect.Effect<string> }
>() {}

class CacheService extends Context.Tag("CacheService")<
  CacheService,
  { readonly get: (key: string) => Effect.Effect<string | null> }
>() {}

// ============================================================================
// LAYER IMPLEMENTATIONS
// ============================================================================

// Database layers - no dependencies
const DatabaseLive = Layer.succeed(DatabaseService, {
  query: (sql) => Effect.succeed([{ id: 1, name: "Alice" }]),
});

const DatabaseTest = Layer.succeed(DatabaseService, {
  query: (sql) => Effect.succeed([{ id: 999, test: true }]),
});

// Logging layers - no dependencies
const LoggingLive = Layer.succeed(LoggingService, {
  log: (msg) => Effect.log(msg),
});

const LoggingTest = Layer.succeed(LoggingService, {
  log: (msg) => Effect.sync(() => console.log("[TEST]", msg)),
});

// Config layers - no dependencies
const ConfigLive = Layer.succeed(ConfigService, {
  get: (key) => Effect.succeed(process.env[key] ?? ""),
});

const ConfigTest = Layer.succeed(ConfigService, {
  get: (key) => Effect.succeed("test-value"),
});

// Cache layers - DEPENDS ON ConfigService (tests transitive resolution)
const CacheLive = Layer.effect(
  CacheService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ttl = yield* config.get("CACHE_TTL");
    return {
      get: (key: string) => Effect.succeed(null as string | null),
    };
  }),
);

const CacheTest = Layer.effect(
  CacheService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    return {
      get: (key: string) => Effect.succeed(("cached-" + key) as string | null),
    };
  }),
);

// ============================================================================
// PROGRAM THAT REQUIRES SERVICES
// ============================================================================

const myProgram = Effect.gen(function* () {
  const db = yield* DatabaseService;
  const logger = yield* LoggingService;
  const cache = yield* CacheService;

  yield* logger.log("Starting query");

  // Check cache first
  const cached = yield* cache.get("users");
  if (cached) {
    yield* logger.log("Cache hit");
    return JSON.parse(cached);
  }

  // Query database
  const results = yield* db.query("SELECT * FROM users");
  yield* logger.log(`Found ${results.length} users`);

  return results;
});

// ============================================================================
// This line should trigger the layer analyzer
// The program requires: DatabaseService, LoggingService, CacheService
// CacheLive transitively requires: ConfigService
// ============================================================================

// This will fail type checking - no layers provided!
const runnable = Effect.runPromise(myProgram);
