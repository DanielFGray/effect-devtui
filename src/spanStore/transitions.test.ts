import { describe, test, expect } from "bun:test"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Array from "effect/Array"
import { pipe } from "effect/Function"
import type { SimpleSpan, SimpleSpanEvent, SimpleMetric } from "../storeTypes"
import { empty, MAX_SPANS, type SourceKey, type SpanStoreState } from "./types"
import { addSpan, addSpanEvent, updateMetrics, computeSpanStats } from "./transitions"

// =============================================================================
// Test Helpers
// =============================================================================

const makeSpan = (overrides: Partial<SimpleSpan> = {}): SimpleSpan => ({
  spanId: "span-1",
  traceId: "trace-1",
  name: "test-span",
  parent: null,
  status: "running",
  startTime: 1000000n,
  endTime: null,
  attributes: {},
  events: [],
  ...overrides,
})

const makeEvent = (overrides: Partial<SimpleSpanEvent> = {}): SimpleSpanEvent => ({
  name: "test-event",
  startTime: 2000000n,
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

// =============================================================================
// addSpan
// =============================================================================

describe("addSpan", () => {
  test("appends span to empty state", () => {
    const span = makeSpan()
    const [state, events] = addSpan(span, source)(empty)

    // spansBySource should have one entry with one span
    const sourceSpans = pipe(HashMap.get(state.spansBySource, source), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))
    expect(sourceSpans).toHaveLength(1)
    expect(sourceSpans[0]!.spanId).toBe("span-1")

    // spanById should have the span
    const found = HashMap.get(state.spanById, "span-1")
    expect(Option.isSome(found)).toBe(true)

    // spansByTrace should have the span under its trace
    const traceSpans = pipe(HashMap.get(state.spansByTrace, "trace-1"), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))
    expect(traceSpans).toHaveLength(1)

    // rootByTrace should have it (parent is null)
    const root = HashMap.get(state.rootByTrace, "trace-1")
    expect(Option.isSome(root)).toBe(true)
    expect(pipe(root, Option.map((s) => s.spanId), Option.getOrElse(() => ""))).toBe("span-1")

    // Event should be SpanAdded
    expect(events).toHaveLength(1)
    expect(events[0]!._tag).toBe("SpanAdded")
  })

  test("updates existing span by spanId", () => {
    const span1 = makeSpan({ status: "running" })
    const [state1] = addSpan(span1, source)(empty)

    const span2 = makeSpan({ status: "ended", endTime: 5000000n })
    const [state2, events] = addSpan(span2, source)(state1)

    // Should still have one span in the source
    const sourceSpans = pipe(HashMap.get(state2.spansBySource, source), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))
    expect(sourceSpans).toHaveLength(1)
    expect(sourceSpans[0]!.status).toBe("ended")

    // spanById should reflect update
    const found = pipe(HashMap.get(state2.spanById, "span-1"), Option.getOrElse(() => makeSpan()))
    expect(found.status).toBe("ended")
    expect(found.endTime).toBe(5000000n)

    // Event should be SpanUpdated
    expect(events).toHaveLength(1)
    expect(events[0]!._tag).toBe("SpanUpdated")
  })

  test("rotates when exceeding MAX_SPANS", () => {
    // Build up a state with MAX_SPANS spans
    const initialState = Array.reduce(
      Array.range(1, MAX_SPANS),
      empty,
      (acc, i) => {
        const span = makeSpan({
          spanId: `span-${i}`,
          traceId: `trace-${i}`,
          name: `span-${i}`,
        })
        const [newState] = addSpan(span, source)(acc)
        return newState
      },
    )

    // Verify we have MAX_SPANS
    const before = pipe(HashMap.get(initialState.spansBySource, source), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))
    expect(before).toHaveLength(MAX_SPANS)

    // Add one more span, triggering rotation
    const extraSpan = makeSpan({
      spanId: "span-extra",
      traceId: "trace-extra",
      name: "extra",
    })
    const [state, events] = addSpan(extraSpan, source)(initialState)

    // Should still have MAX_SPANS
    const after = pipe(HashMap.get(state.spansBySource, source), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))
    expect(after).toHaveLength(MAX_SPANS)

    // The first span should have been dropped
    const firstGone = HashMap.get(state.spanById, "span-1")
    expect(Option.isNone(firstGone)).toBe(true)

    // The extra span should be present
    const extraFound = HashMap.get(state.spanById, "span-extra")
    expect(Option.isSome(extraFound)).toBe(true)

    // Should have SpanAdded + SpansRotated events
    expect(events).toHaveLength(2)
    expect(events[0]!._tag).toBe("SpanAdded")
    expect(events[1]!._tag).toBe("SpansRotated")
  })

  test("attaches buffered events to span", () => {
    const event1 = makeEvent({ name: "buffered-1" })
    const event2 = makeEvent({ name: "buffered-2" })

    // Buffer events first (span not yet arrived)
    const [state1] = addSpanEvent(event1, "span-1", source)(empty)
    const [state2] = addSpanEvent(event2, "span-1", source)(state1)

    // Now add the span - buffered events should be attached
    const span = makeSpan({ events: [] })
    const [state3] = addSpan(span, source)(state2)

    const found = pipe(HashMap.get(state3.spanById, "span-1"), Option.getOrElse(() => makeSpan()))
    expect(found.events).toHaveLength(2)
    expect(found.events[0]!.name).toBe("buffered-1")
    expect(found.events[1]!.name).toBe("buffered-2")

    // Event buffer should be cleared for this span
    const bKey = `${source}:span-1`
    const buffered = HashMap.get(state3.eventBuffer, bKey)
    expect(Option.isNone(buffered)).toBe(true)
  })

  test("handles multiple sources independently", () => {
    const span1 = makeSpan({ spanId: "s1", traceId: "t1" })
    const span2 = makeSpan({ spanId: "s2", traceId: "t2" })
    const source1: SourceKey = 1
    const source2: SourceKey = 2

    const [state1] = addSpan(span1, source1)(empty)
    const [state2] = addSpan(span2, source2)(state1)

    const s1Spans = pipe(HashMap.get(state2.spansBySource, source1), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))
    const s2Spans = pipe(HashMap.get(state2.spansBySource, source2), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))

    expect(s1Spans).toHaveLength(1)
    expect(s2Spans).toHaveLength(1)
    expect(s1Spans[0]!.spanId).toBe("s1")
    expect(s2Spans[0]!.spanId).toBe("s2")
  })

  test("non-root span does not set rootByTrace", () => {
    const childSpan = makeSpan({ spanId: "child-1", parent: "parent-1" })
    const [state] = addSpan(childSpan, source)(empty)

    const root = HashMap.get(state.rootByTrace, "trace-1")
    expect(Option.isNone(root)).toBe(true)
  })

  test("server source key works", () => {
    const span = makeSpan()
    const [state] = addSpan(span, "server")(empty)

    const serverSpans = pipe(HashMap.get(state.spansBySource, "server"), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))
    expect(serverSpans).toHaveLength(1)
  })
})

// =============================================================================
// addSpanEvent
// =============================================================================

describe("addSpanEvent", () => {
  test("buffers event when span not yet arrived", () => {
    const event = makeEvent({ name: "early-event" })
    const [state, events] = addSpanEvent(event, "span-1", source)(empty)

    // Should be in the event buffer
    const bKey = `${source}:span-1`
    const buffered = pipe(HashMap.get(state.eventBuffer, bKey), Option.getOrElse((): ReadonlyArray<SimpleSpanEvent> => []))
    expect(buffered).toHaveLength(1)
    expect(buffered[0]!.name).toBe("early-event")

    // Should still emit SpanEventAdded
    expect(events).toHaveLength(1)
    expect(events[0]!._tag).toBe("SpanEventAdded")
  })

  test("appends event to existing span", () => {
    const span = makeSpan({ events: [] })
    const [state1] = addSpan(span, source)(empty)

    const event = makeEvent({ name: "new-event" })
    const [state2, events] = addSpanEvent(event, "span-1", source)(state1)

    // Span should have the event
    const found = pipe(HashMap.get(state2.spanById, "span-1"), Option.getOrElse(() => makeSpan()))
    expect(found.events).toHaveLength(1)
    expect(found.events[0]!.name).toBe("new-event")

    // spansBySource should also be updated
    const sourceSpans = pipe(HashMap.get(state2.spansBySource, source), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))
    expect(sourceSpans[0]!.events).toHaveLength(1)

    // spansByTrace should also be updated
    const traceSpans = pipe(HashMap.get(state2.spansByTrace, "trace-1"), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))
    expect(traceSpans[0]!.events).toHaveLength(1)

    // Event
    expect(events).toHaveLength(1)
    expect(events[0]!._tag).toBe("SpanEventAdded")
  })

  test("multiple buffered events accumulate", () => {
    const [state1] = addSpanEvent(makeEvent({ name: "e1" }), "span-1", source)(empty)
    const [state2] = addSpanEvent(makeEvent({ name: "e2" }), "span-1", source)(state1)
    const [state3] = addSpanEvent(makeEvent({ name: "e3" }), "span-1", source)(state2)

    const bKey = `${source}:span-1`
    const buffered = pipe(HashMap.get(state3.eventBuffer, bKey), Option.getOrElse((): ReadonlyArray<SimpleSpanEvent> => []))
    expect(buffered).toHaveLength(3)
  })
})

// =============================================================================
// updateMetrics
// =============================================================================

describe("updateMetrics", () => {
  test("replaces source metrics", () => {
    const metrics1: ReadonlyArray<SimpleMetric> = [
      makeMetric({ name: "m1", value: 10 }),
      makeMetric({ name: "m2", value: 20 }),
    ]

    const [state1] = updateMetrics(metrics1, source)(empty)

    const sourceMetrics = pipe(HashMap.get(state1.metricsBySource, source), Option.getOrElse((): ReadonlyArray<SimpleMetric> => []))
    expect(sourceMetrics).toHaveLength(2)

    // Replace with different metrics
    const metrics2: ReadonlyArray<SimpleMetric> = [
      makeMetric({ name: "m3", value: 30 }),
    ]

    const [state2, events] = updateMetrics(metrics2, source)(state1)

    const updatedMetrics = pipe(HashMap.get(state2.metricsBySource, source), Option.getOrElse((): ReadonlyArray<SimpleMetric> => []))
    expect(updatedMetrics).toHaveLength(1)
    expect(updatedMetrics[0]!.name).toBe("m3")

    // Event
    expect(events).toHaveLength(1)
    expect(events[0]!._tag).toBe("MetricsUpdated")
  })

  test("different sources are independent", () => {
    const [state1] = updateMetrics([makeMetric({ name: "s1-m" })], 1)(empty)
    const [state2] = updateMetrics([makeMetric({ name: "s2-m" })], 2)(state1)

    const m1 = pipe(HashMap.get(state2.metricsBySource, 1), Option.getOrElse((): ReadonlyArray<SimpleMetric> => []))
    const m2 = pipe(HashMap.get(state2.metricsBySource, 2), Option.getOrElse((): ReadonlyArray<SimpleMetric> => []))

    expect(m1).toHaveLength(1)
    expect(m1[0]!.name).toBe("s1-m")
    expect(m2).toHaveLength(1)
    expect(m2[0]!.name).toBe("s2-m")
  })
})

// =============================================================================
// computeSpanStats
// =============================================================================

describe("computeSpanStats", () => {
  test("computes correct aggregates", () => {
    const spans: ReadonlyArray<SimpleSpan> = [
      makeSpan({ spanId: "s1", name: "http.request", startTime: 0n, endTime: 10_000_000n, status: "ended" }),
      makeSpan({ spanId: "s2", name: "http.request", startTime: 0n, endTime: 20_000_000n, status: "ended" }),
      makeSpan({
        spanId: "s3",
        name: "http.request",
        startTime: 0n,
        endTime: 30_000_000n,
        status: "ended",
        attributes: { error: "timeout" },
      }),
      makeSpan({ spanId: "s4", name: "db.query", startTime: 0n, endTime: 5_000_000n, status: "ended" }),
    ]

    // Build state
    const state = Array.reduce(spans, empty, (acc, span) => {
      const [newState] = addSpan(span, source)(acc)
      return newState
    })

    const stats = computeSpanStats(state)

    // Should have two name groups
    expect(stats).toHaveLength(2)

    const httpStats = Array.findFirst(stats, (s) => s.name === "http.request")
    expect(Option.isSome(httpStats)).toBe(true)
    const http = Option.getOrThrow(httpStats)
    expect(http.count).toBe(3)
    expect(http.errorCount).toBe(1)
    expect(http.avgDurationMs).toBeCloseTo(20, 1) // (10 + 20 + 30) / 3

    const dbStats = Array.findFirst(stats, (s) => s.name === "db.query")
    expect(Option.isSome(dbStats)).toBe(true)
    const db = Option.getOrThrow(dbStats)
    expect(db.count).toBe(1)
    expect(db.errorCount).toBe(0)
    expect(db.avgDurationMs).toBeCloseTo(5, 1)
  })

  test("returns empty array for empty state", () => {
    const stats = computeSpanStats(empty)
    expect(stats).toHaveLength(0)
  })

  test("running spans contribute 0 duration", () => {
    const span = makeSpan({ spanId: "s1", name: "running", status: "running", endTime: null })
    const [state] = addSpan(span, source)(empty)

    const stats = computeSpanStats(state)
    expect(stats).toHaveLength(1)
    expect(stats[0]!.avgDurationMs).toBe(0)
  })
})

// =============================================================================
// Index Consistency
// =============================================================================

describe("index consistency after rotation", () => {
  test("all index maps stay consistent after rotation", () => {
    // Build up MAX_SPANS + 5 spans across 3 traces
    const state = Array.reduce(
      Array.range(1, MAX_SPANS + 5),
      empty,
      (acc, i) => {
        const traceId = `trace-${(i % 3) + 1}`
        const span = makeSpan({
          spanId: `span-${i}`,
          traceId,
          name: `op-${(i % 3) + 1}`,
          parent: i % 3 === 0 ? null : `span-${i - 1}`,
        })
        const [newState] = addSpan(span, source)(acc)
        return newState
      },
    )

    // Verify source spans count is MAX_SPANS
    const sourceSpans = pipe(HashMap.get(state.spansBySource, source), Option.getOrElse((): ReadonlyArray<SimpleSpan> => []))
    expect(sourceSpans).toHaveLength(MAX_SPANS)

    // Every span in spansBySource should be in spanById
    const allInById = Array.every(sourceSpans, (span) =>
      Option.isSome(HashMap.get(state.spanById, span.spanId)),
    )
    expect(allInById).toBe(true)

    // Every span in spansBySource should be in its trace array
    const allInTrace = Array.every(sourceSpans, (span) => {
      const traceSpans = pipe(
        HashMap.get(state.spansByTrace, span.traceId),
        Option.getOrElse((): ReadonlyArray<SimpleSpan> => []),
      )
      return Array.some(traceSpans, (s) => s.spanId === span.spanId)
    })
    expect(allInTrace).toBe(true)

    // Dropped spans (span-1 through span-5) should NOT be in spanById
    const droppedGone = Array.every(
      Array.range(1, 5),
      (i) => Option.isNone(HashMap.get(state.spanById, `span-${i}`)),
    )
    expect(droppedGone).toBe(true)
  })

  test("hasErrorByTrace is cleaned when a trace's last span rotates out", () => {
    // Add a single error span on its own unique trace, then fill up to
    // MAX_SPANS with spans on a different trace so the error trace rotates out.
    const errorSpan = makeSpan({
      spanId: "err-1",
      traceId: "trace-err",
      name: "failing-op",
      status: "ended",
      endTime: 5_000_000n,
      attributes: { error: "boom" },
    })
    const [withError] = addSpan(errorSpan, source)(empty)

    // Sanity: hasErrorByTrace should be set
    expect(
      pipe(HashMap.get(withError.hasErrorByTrace, "trace-err"), Option.getOrElse(() => false)),
    ).toBe(true)

    // Add MAX_SPANS more spans on a different trace, triggering rotation
    // that drops the single error span.
    const state = Array.reduce(
      Array.range(1, MAX_SPANS),
      withError,
      (acc, i) => {
        const span = makeSpan({
          spanId: `fill-${i}`,
          traceId: "trace-fill",
          name: "filler",
        })
        const [newState] = addSpan(span, source)(acc)
        return newState
      },
    )

    // The error span should have been rotated out
    expect(Option.isNone(HashMap.get(state.spanById, "err-1"))).toBe(true)

    // hasErrorByTrace entry for trace-err should also be gone
    expect(Option.isNone(HashMap.get(state.hasErrorByTrace, "trace-err"))).toBe(true)

    // spansByTrace should not have trace-err either
    expect(Option.isNone(HashMap.get(state.spansByTrace, "trace-err"))).toBe(true)
  })
})
