import { describe, test, expect } from "bun:test"
import * as Effect from "effect/Effect"
import * as Array from "effect/Array"
import * as PubSub from "effect/PubSub"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import { pipe } from "effect/Function"
import type { SimpleSpan, SimpleSpanEvent, SimpleMetric } from "../storeTypes"
import { type SourceKey, type StoreEvent, MAX_SPANS } from "./types"
import { SpanStore, SpanStoreLive } from "./service"

// =============================================================================
// Test Helpers
// =============================================================================

const makeSpan = (overrides: Partial<SimpleSpan> = {}): SimpleSpan => ({
  spanId: "span-1",
  traceId: "trace-1",
  name: "test-span",
  parent: null,
  status: "running",
  startTime: 1_000_000n,
  endTime: null,
  attributes: {},
  events: [],
  ...overrides,
})

const makeEvent = (overrides: Partial<SimpleSpanEvent> = {}): SimpleSpanEvent => ({
  name: "test-event",
  startTime: 2_000_000n,
  attributes: {},
  ...overrides,
})

const makeMetric = (overrides: Partial<SimpleMetric> = {}): SimpleMetric => ({
  name: "test-metric",
  type: "Counter",
  value: 42,
  tags: {},
  ...overrides,
})

const source: SourceKey = 1

/** Run an Effect that needs SpanStore, providing the Live layer */
const runWithStore = <A, E>(effect: Effect.Effect<A, E, SpanStore>): Promise<A> =>
  Effect.runPromise(pipe(effect, Effect.provide(SpanStoreLive)))

/** Run an Effect that needs SpanStore + Scope (for PubSub.subscribe) */
const runScopedWithStore = <A, E>(effect: Effect.Effect<A, E, SpanStore | Scope.Scope>): Promise<A> =>
  Effect.runPromise(pipe(effect, Effect.scoped, Effect.provide(SpanStoreLive)))

const allSpansFromState = (
  state: { spansBySource: HashMap.HashMap<SourceKey, ReadonlyArray<SimpleSpan>> },
  src: SourceKey,
): ReadonlyArray<SimpleSpan> =>
  pipe(
    HashMap.get(state.spansBySource, src),
    Option.getOrElse((): ReadonlyArray<SimpleSpan> => []),
  )

// =============================================================================
// Construction
// =============================================================================

describe("SpanStore service", () => {
  test("can be constructed via Layer", async () => {
    const result = await runWithStore(
      Effect.gen(function* () {
        const store = yield* SpanStore
        const state = yield* store.snapshot()
        return state
      }),
    )

    expect(result.spansBySource).toBeDefined()
  })

  // ===========================================================================
  // addSpan
  // ===========================================================================

  describe("addSpan", () => {
    test("publishes SpanAdded event", async () => {
      const result = await runScopedWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore
          const sub = yield* PubSub.subscribe(store.events)

          yield* store.addSpan(makeSpan(), source)

          const event = yield* Queue.take(sub)
          return event
        }),
      )

      expect(result._tag).toBe("SpanAdded")
    })

    test("span is retrievable after add", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore
          yield* store.addSpan(makeSpan({ spanId: "s1", traceId: "t1" }), source)
          return yield* store.getAllSpans(source)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.spanId).toBe("s1")
    })

    test("publishes SpansRotated event on rotation", async () => {
      const result = await runScopedWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore

          // Fill to MAX_SPANS
          yield* Effect.forEach(
            Array.range(1, MAX_SPANS),
            (i) => store.addSpan(
              makeSpan({ spanId: `span-${i}`, traceId: `trace-${i}`, name: `op-${i}` }),
              source,
            ),
            { discard: true },
          )

          // Subscribe AFTER filling, so we only capture the rotation event
          const sub = yield* PubSub.subscribe(store.events)

          // One more triggers rotation
          yield* store.addSpan(
            makeSpan({ spanId: "span-extra", traceId: "trace-extra", name: "extra" }),
            source,
          )

          // Take the two events published by this single addSpan (SpanAdded + SpansRotated)
          const event1 = yield* Queue.take(sub)
          const event2 = yield* Queue.take(sub)

          return [event1, event2]
        }),
      )

      const tags = result.map((e) => e._tag)
      expect(tags).toContain("SpanAdded")
      expect(tags).toContain("SpansRotated")
    })
  })

  // ===========================================================================
  // addSpanEvent
  // ===========================================================================

  describe("addSpanEvent", () => {
    test("publishes SpanEventAdded event", async () => {
      const result = await runScopedWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore
          yield* store.addSpan(makeSpan(), source)

          const sub = yield* PubSub.subscribe(store.events)
          yield* store.addSpanEvent(makeEvent(), "span-1", source)

          return yield* Queue.take(sub)
        }),
      )

      expect(result._tag).toBe("SpanEventAdded")
    })

    test("buffers event when span not yet arrived", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore

          // Add event before span exists
          yield* store.addSpanEvent(makeEvent({ name: "buffered" }), "span-1", source)

          // Now add the span - event should be attached
          yield* store.addSpan(makeSpan({ spanId: "span-1", events: [] }), source)

          const state = yield* store.snapshot()
          const spans = allSpansFromState(state, source)
          return Array.findFirst(spans, (s) => s.spanId === "span-1")
        }),
      )

      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.events).toHaveLength(1)
        expect(result.value.events[0]!.name).toBe("buffered")
      }
    })
  })

  // ===========================================================================
  // updateMetrics
  // ===========================================================================

  describe("updateMetrics", () => {
    test("publishes MetricsUpdated event", async () => {
      const result = await runScopedWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore
          const sub = yield* PubSub.subscribe(store.events)

          yield* store.updateMetrics([makeMetric()], source)

          return yield* Queue.take(sub)
        }),
      )

      expect(result._tag).toBe("MetricsUpdated")
    })
  })

  // ===========================================================================
  // getByTrace
  // ===========================================================================

  describe("getByTrace", () => {
    test("returns correct spans after multiple adds", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore

          yield* store.addSpan(makeSpan({ spanId: "s1", traceId: "t1", name: "op1" }), source)
          yield* store.addSpan(makeSpan({ spanId: "s2", traceId: "t1", name: "op2", parent: "s1" }), source)
          yield* store.addSpan(makeSpan({ spanId: "s3", traceId: "t2", name: "op3" }), source)

          return yield* store.getByTrace("t1")
        }),
      )

      expect(result).toHaveLength(2)
      const ids = result.map((s) => s.spanId)
      expect(ids).toContain("s1")
      expect(ids).toContain("s2")
    })

    test("returns empty for unknown trace", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore
          return yield* store.getByTrace("nonexistent")
        }),
      )

      expect(result).toHaveLength(0)
    })
  })

  // ===========================================================================
  // getByTime
  // ===========================================================================

  describe("getByTime", () => {
    test("filters spans by startTime range", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore

          yield* store.addSpan(makeSpan({ spanId: "s1", startTime: 100n }), source)
          yield* store.addSpan(makeSpan({ spanId: "s2", startTime: 200n }), source)
          yield* store.addSpan(makeSpan({ spanId: "s3", startTime: 300n }), source)
          yield* store.addSpan(makeSpan({ spanId: "s4", startTime: 400n }), source)

          return yield* store.getByTime(150n, 350n)
        }),
      )

      expect(result).toHaveLength(2)
      const ids = result.map((s) => s.spanId)
      expect(ids).toContain("s2")
      expect(ids).toContain("s3")
    })

    test("filters by source when provided", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore

          yield* store.addSpan(makeSpan({ spanId: "s1", startTime: 200n }), 1)
          yield* store.addSpan(makeSpan({ spanId: "s2", startTime: 200n }), 2)

          return yield* store.getByTime(100n, 300n, 1)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.spanId).toBe("s1")
    })

    test("returns all sources when source not provided", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore

          yield* store.addSpan(makeSpan({ spanId: "s1", startTime: 200n }), 1)
          yield* store.addSpan(makeSpan({ spanId: "s2", startTime: 200n }), 2)

          return yield* store.getByTime(100n, 300n)
        }),
      )

      expect(result).toHaveLength(2)
    })
  })

  // ===========================================================================
  // getAllSpans
  // ===========================================================================

  describe("getAllSpans", () => {
    test("returns spans for specific source", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore

          yield* store.addSpan(makeSpan({ spanId: "s1" }), 1)
          yield* store.addSpan(makeSpan({ spanId: "s2" }), 2)

          return yield* store.getAllSpans(1)
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.spanId).toBe("s1")
    })

    test("returns all spans when no source given", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore

          yield* store.addSpan(makeSpan({ spanId: "s1" }), 1)
          yield* store.addSpan(makeSpan({ spanId: "s2" }), 2)

          return yield* store.getAllSpans()
        }),
      )

      expect(result).toHaveLength(2)
    })
  })

  // ===========================================================================
  // getStats
  // ===========================================================================

  describe("getStats", () => {
    test("returns correct aggregates", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore

          yield* store.addSpan(
            makeSpan({ spanId: "s1", name: "http", startTime: 0n, endTime: 10_000_000n, status: "ended" }),
            source,
          )
          yield* store.addSpan(
            makeSpan({ spanId: "s2", name: "http", startTime: 0n, endTime: 20_000_000n, status: "ended" }),
            source,
          )
          yield* store.addSpan(
            makeSpan({
              spanId: "s3",
              name: "http",
              startTime: 0n,
              endTime: 30_000_000n,
              status: "ended",
              attributes: { error: "timeout" },
            }),
            source,
          )
          yield* store.addSpan(
            makeSpan({ spanId: "s4", name: "db", startTime: 0n, endTime: 5_000_000n, status: "ended" }),
            source,
          )

          return yield* store.getStats()
        }),
      )

      expect(result).toHaveLength(2)

      const httpStats = result.find((s) => s.name === "http")
      expect(httpStats).toBeDefined()
      expect(httpStats!.count).toBe(3)
      expect(httpStats!.errorCount).toBe(1)
      expect(httpStats!.avgDurationMs).toBeCloseTo(20, 1)

      const dbStats = result.find((s) => s.name === "db")
      expect(dbStats).toBeDefined()
      expect(dbStats!.count).toBe(1)
      expect(dbStats!.errorCount).toBe(0)
      expect(dbStats!.avgDurationMs).toBeCloseTo(5, 1)
    })
  })

  // ===========================================================================
  // Concurrency
  // ===========================================================================

  describe("concurrency", () => {
    test("multiple concurrent addSpan calls are serialized (no lost writes)", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore
          const count = 100

          // Fire off many concurrent addSpan calls
          yield* Effect.forEach(
            Array.range(1, count),
            (i) => store.addSpan(
              makeSpan({ spanId: `span-${i}`, traceId: `trace-${i}`, name: `op-${i}` }),
              source,
            ),
            { concurrency: "unbounded", discard: true },
          )

          return yield* store.getAllSpans(source)
        }),
      )

      // All 100 spans should be present
      expect(result).toHaveLength(100)
    })

    test("concurrent adds produce correct event count", async () => {
      const result = await runScopedWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore
          const sub = yield* PubSub.subscribe(store.events)
          const count = 50

          yield* Effect.forEach(
            Array.range(1, count),
            (i) => store.addSpan(
              makeSpan({ spanId: `span-${i}`, traceId: `trace-${i}`, name: `op-${i}` }),
              source,
            ),
            { concurrency: "unbounded", discard: true },
          )

          // Drain all events - take exactly count events
          const collected: Array<StoreEvent> = []
          for (let i = 0; i < count; i++) {
            const event = yield* Queue.take(sub)
            collected.push(event)
          }

          return collected
        }),
      )

      // Should have exactly 50 SpanAdded events
      expect(result).toHaveLength(50)
      expect(result.every((e) => e._tag === "SpanAdded")).toBe(true)
    })
  })

  // ===========================================================================
  // snapshot
  // ===========================================================================

  describe("snapshot", () => {
    test("returns current state", async () => {
      const result = await runWithStore(
        Effect.gen(function* () {
          const store = yield* SpanStore

          yield* store.addSpan(makeSpan({ spanId: "s1" }), source)
          yield* store.updateMetrics([makeMetric({ name: "m1" })], source)

          return yield* store.snapshot()
        }),
      )

      // Verify span "s1" exists under source 1
      const spans = HashMap.get(result.spansBySource, source)
      expect(Option.isSome(spans)).toBe(true)
      if (Option.isSome(spans)) {
        expect(spans.value).toHaveLength(1)
      }

      // Verify metric "m1" exists under source 1
      const metrics = HashMap.get(result.metricsBySource, source)
      expect(Option.isSome(metrics)).toBe(true)
      if (Option.isSome(metrics)) {
        expect(metrics.value).toHaveLength(1)
      }
    })
  })
})
