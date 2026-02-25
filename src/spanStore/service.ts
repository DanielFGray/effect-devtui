/**
 * SpanStore Effect Service
 *
 * An Effect service wrapping the pure transitions from transitions.ts with
 * Ref-based atomic state management and PubSub event publishing.
 *
 * Mutations:  Ref.modify (atomic) -> publish events via PubSub
 * Queries:    Ref.get (read-only snapshot) -> Effect.map
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import * as Ref from "effect/Ref"
import * as PubSub from "effect/PubSub"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Array from "effect/Array"
import { pipe } from "effect/Function"
import type { SimpleSpan, SimpleSpanEvent, SimpleMetric } from "../storeTypes"
import {
  type SpanStoreState,
  type StoreEvent,
  type SourceKey,
  type SpanNameStats,
  empty,
} from "./types"
import {
  addSpan as addSpanTransition,
  addSpanEvent as addSpanEventTransition,
  updateMetrics as updateMetricsTransition,
  clearSource as clearSourceTransition,
  computeSpanStats,
} from "./transitions"

// =============================================================================
// Service Definition
// =============================================================================

export class SpanStore extends Context.Tag("effect-devtui/SpanStore")<SpanStore, {
  readonly addSpan: (span: SimpleSpan, source: SourceKey) => Effect.Effect<void>
  readonly addSpanEvent: (event: SimpleSpanEvent, spanId: string, source: SourceKey) => Effect.Effect<void>
  readonly updateMetrics: (metrics: ReadonlyArray<SimpleMetric>, source: SourceKey) => Effect.Effect<void>
  readonly clearSource: (source: SourceKey) => Effect.Effect<void>
  readonly getByTrace: (traceId: string) => Effect.Effect<ReadonlyArray<SimpleSpan>>
  readonly getByTime: (start: bigint, end: bigint, source?: SourceKey) => Effect.Effect<ReadonlyArray<SimpleSpan>>
  readonly getAllSpans: (source?: SourceKey) => Effect.Effect<ReadonlyArray<SimpleSpan>>
  readonly getStats: () => Effect.Effect<ReadonlyArray<SpanNameStats>>
  readonly snapshot: () => Effect.Effect<SpanStoreState>
  readonly events: PubSub.PubSub<StoreEvent>
}>() {}

// =============================================================================
// Helpers
// =============================================================================

/** Publish an array of events to a PubSub, discarding results */
const publishAll = (
  pubsub: PubSub.PubSub<StoreEvent>,
  events: ReadonlyArray<StoreEvent>,
): Effect.Effect<void> =>
  Effect.forEach(events, (event) => PubSub.publish(pubsub, event), { discard: true })

/** Collect all spans from all sources in a HashMap */
const allSpansFromSources = (
  spansBySource: HashMap.HashMap<SourceKey, ReadonlyArray<SimpleSpan>>,
): ReadonlyArray<SimpleSpan> =>
  pipe(
    HashMap.values(spansBySource),
    (iter) => Array.fromIterable(iter),
    Array.flatten,
  )

// =============================================================================
// Live Layer
// =============================================================================

export const SpanStoreLive: Layer.Layer<SpanStore> = Layer.effect(
  SpanStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make(empty)
    const pubsub = yield* PubSub.unbounded<StoreEvent>()

    // Note: Ref.modify + publishAll is intentionally non-atomic. A concurrent
    // mutation may modify the Ref between our modify and the publish. This is
    // acceptable because events are informational/incremental and subscribers
    // should tolerate eventual consistency (e.g. a slightly stale snapshot).
    const addSpan = (span: SimpleSpan, source: SourceKey): Effect.Effect<void> =>
      Effect.gen(function* () {
        const events = yield* Ref.modify(ref, (state) => {
          const [newState, storeEvents] = addSpanTransition(span, source)(state)
          return [storeEvents, newState]
        })
        yield* publishAll(pubsub, events)
      })

    const addSpanEvent = (event: SimpleSpanEvent, spanId: string, source: SourceKey): Effect.Effect<void> =>
      Effect.gen(function* () {
        const events = yield* Ref.modify(ref, (state) => {
          const [newState, storeEvents] = addSpanEventTransition(event, spanId, source)(state)
          return [storeEvents, newState]
        })
        yield* publishAll(pubsub, events)
      })

    const updateMetrics = (metrics: ReadonlyArray<SimpleMetric>, source: SourceKey): Effect.Effect<void> =>
      Effect.gen(function* () {
        const events = yield* Ref.modify(ref, (state) => {
          const [newState, storeEvents] = updateMetricsTransition(metrics, source)(state)
          return [storeEvents, newState]
        })
        yield* publishAll(pubsub, events)
      })

    const clearSource = (source: SourceKey): Effect.Effect<void> =>
      Effect.gen(function* () {
        const events = yield* Ref.modify(ref, (state) => {
          const [newState, storeEvents] = clearSourceTransition(source)(state)
          return [storeEvents, newState]
        })
        yield* publishAll(pubsub, events)
      })

    const getByTrace = (traceId: string): Effect.Effect<ReadonlyArray<SimpleSpan>> =>
      pipe(
        Ref.get(ref),
        Effect.map((state) =>
          pipe(
            HashMap.get(state.spansByTrace, traceId),
            Option.getOrElse((): ReadonlyArray<SimpleSpan> => []),
          ),
        ),
      )

    const getByTime = (start: bigint, end: bigint, source?: SourceKey): Effect.Effect<ReadonlyArray<SimpleSpan>> =>
      pipe(
        Ref.get(ref),
        Effect.map((state) => {
          const spans = source !== undefined
            ? pipe(
                HashMap.get(state.spansBySource, source),
                Option.getOrElse((): ReadonlyArray<SimpleSpan> => []),
              )
            : allSpansFromSources(state.spansBySource)

          return Array.filter(spans, (span) =>
            span.startTime >= start && span.startTime <= end,
          )
        }),
      )

    const getAllSpans = (source?: SourceKey): Effect.Effect<ReadonlyArray<SimpleSpan>> =>
      pipe(
        Ref.get(ref),
        Effect.map((state) =>
          source !== undefined
            ? pipe(
                HashMap.get(state.spansBySource, source),
                Option.getOrElse((): ReadonlyArray<SimpleSpan> => []),
              )
            : allSpansFromSources(state.spansBySource),
        ),
      )

    const getStats = (): Effect.Effect<ReadonlyArray<SpanNameStats>> =>
      pipe(
        Ref.get(ref),
        Effect.map(computeSpanStats),
      )

    const snapshot = (): Effect.Effect<SpanStoreState> => Ref.get(ref)

    return {
      addSpan,
      addSpanEvent,
      updateMetrics,
      clearSource,
      getByTrace,
      getByTime,
      getAllSpans,
      getStats,
      snapshot,
      events: pubsub,
    }
  }),
)
