/**
 * SpanStore Transitions
 *
 * Pure functions: (State, Input) -> [NewState, ReadonlyArray<StoreEvent>]
 *
 * No side effects, no mutation, no for loops, no mutable variables.
 * Uses pipe, Array.*, HashMap.*, Option.* from Effect.
 */

import { pipe } from "effect/Function"
import * as Array from "effect/Array"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import type { SimpleSpan, SimpleSpanEvent, SimpleMetric } from "../storeTypes"
import {
  type SpanStoreState,
  type StoreEvent,
  type SourceKey,
  type SpanNameStats,
  StoreEvent as SE,
  MAX_SPANS,
} from "./types"

// =============================================================================
// Helpers
// =============================================================================

/** Get an array from a HashMap, defaulting to empty */
const getOrEmpty = <K, V>(map: HashMap.HashMap<K, ReadonlyArray<V>>, key: K): ReadonlyArray<V> =>
  pipe(
    HashMap.get(map, key),
    Option.getOrElse((): ReadonlyArray<V> => []),
  )

/** Buffer key for a span event */
const bufferKey = (source: SourceKey, spanId: string): string =>
  `${String(source)}:${spanId}`

// =============================================================================
// addSpan
// =============================================================================

/**
 * Add or update a span in the store.
 * Returns curried: addSpan(span, source)(state) -> [state, events]
 */
export const addSpan = (span: SimpleSpan, source: SourceKey) =>
  (state: SpanStoreState): readonly [SpanStoreState, ReadonlyArray<StoreEvent>] => {
    const currentSpans = getOrEmpty(state.spansBySource, source)

    // Check for buffered events and attach them
    const bKey = bufferKey(source, span.spanId)
    const bufferedEvents = getOrEmpty(state.eventBuffer, bKey)
    const spanWithEvents: SimpleSpan = Array.isEmptyReadonlyArray(bufferedEvents)
      ? span
      : { ...span, events: [...span.events, ...bufferedEvents] }

    // Check if span already exists
    const existingIndex = Array.findFirstIndex(currentSpans, (s) => s.spanId === span.spanId)

    const isUpdate = Option.isSome(existingIndex)

    // Replace existing or append
    const updatedSpans: ReadonlyArray<SimpleSpan> = isUpdate
      ? Array.replace(currentSpans, existingIndex.value, spanWithEvents)
      : Array.append(currentSpans, spanWithEvents)

    // Rotate if exceeding MAX_SPANS
    const needsRotation = Array.length(updatedSpans) > MAX_SPANS
    const droppedCount = needsRotation ? Array.length(updatedSpans) - MAX_SPANS : 0
    const droppedSpans = needsRotation ? Array.take(updatedSpans, droppedCount) : []
    const finalSpans = needsRotation ? Array.takeRight(updatedSpans, MAX_SPANS) : updatedSpans

    // Clean indices for dropped spans
    const cleanedIndices = Array.reduce(droppedSpans, {
      spanById: state.spanById,
      spansByTrace: state.spansByTrace,
      rootByTrace: state.rootByTrace,
      hasErrorByTrace: state.hasErrorByTrace,
    } as Pick<SpanStoreState, "spanById" | "spansByTrace" | "rootByTrace" | "hasErrorByTrace">,
    (acc, dropped) => ({
      spanById: HashMap.remove(acc.spanById, dropped.spanId),
      spansByTrace: pipe(
        acc.spansByTrace,
        HashMap.modify(dropped.traceId, (traceSpans) =>
          Array.filter(traceSpans, (s) => s.spanId !== dropped.spanId),
        ),
      ),
      rootByTrace: pipe(
        HashMap.get(acc.rootByTrace, dropped.traceId),
        Option.filter((root) => root.spanId === dropped.spanId),
        Option.match({
          onNone: () => acc.rootByTrace,
          onSome: () => HashMap.remove(acc.rootByTrace, dropped.traceId),
        }),
      ),
      hasErrorByTrace: acc.hasErrorByTrace,
    }))

    // Remove empty trace entries
    const cleanedSpansByTrace = HashMap.filter(cleanedIndices.spansByTrace, (spans) =>
      !Array.isEmptyReadonlyArray(spans),
    )

    // Now update indices with the current span
    const baseIndices = {
      ...cleanedIndices,
      spansByTrace: cleanedSpansByTrace,
    }

    // Update spanById with new span
    const newSpanById = HashMap.set(baseIndices.spanById, spanWithEvents.spanId, spanWithEvents)

    // Update spansByTrace
    const traceSpans = getOrEmpty(baseIndices.spansByTrace, spanWithEvents.traceId)
    const traceSpansUpdated = pipe(
      traceSpans,
      Array.filter((s) => s.spanId !== spanWithEvents.spanId),
      Array.append(spanWithEvents),
    )
    const newSpansByTrace = HashMap.set(baseIndices.spansByTrace, spanWithEvents.traceId, traceSpansUpdated)

    // Update rootByTrace
    const newRootByTrace = spanWithEvents.parent === null
      ? HashMap.set(baseIndices.rootByTrace, spanWithEvents.traceId, spanWithEvents)
      : baseIndices.rootByTrace

    // Update hasErrorByTrace
    const hasError = spanWithEvents.status === "ended" && spanWithEvents.attributes["error"] !== undefined
    const existingHasError = pipe(
      HashMap.get(baseIndices.hasErrorByTrace, spanWithEvents.traceId),
      Option.getOrElse(() => false),
    )
    const newHasErrorByTrace = HashMap.set(
      baseIndices.hasErrorByTrace,
      spanWithEvents.traceId,
      existingHasError || hasError,
    )

    // Remove buffered events if we consumed them
    const newEventBuffer = Array.isEmptyReadonlyArray(bufferedEvents)
      ? state.eventBuffer
      : HashMap.remove(state.eventBuffer, bKey)

    const newState: SpanStoreState = {
      ...state,
      spansBySource: HashMap.set(state.spansBySource, source, finalSpans),
      spanById: newSpanById,
      spansByTrace: newSpansByTrace,
      rootByTrace: newRootByTrace,
      hasErrorByTrace: newHasErrorByTrace,
      eventBuffer: newEventBuffer,
    }

    const events: ReadonlyArray<StoreEvent> = pipe(
      [
        isUpdate
          ? SE.SpanUpdated({ span: spanWithEvents, source })
          : SE.SpanAdded({ span: spanWithEvents, source }),
      ] as ReadonlyArray<StoreEvent>,
      needsRotation
        ? Array.append(SE.SpansRotated({ droppedCount, source }) as StoreEvent)
        : (x) => x,
    )

    return [newState, events] as const
  }

// =============================================================================
// addSpanEvent
// =============================================================================

/**
 * Add a span event to an existing span, or buffer it if the span hasn't arrived yet.
 * Returns curried: addSpanEvent(event, spanId, source)(state) -> [state, events]
 */
export const addSpanEvent = (event: SimpleSpanEvent, spanId: string, source: SourceKey) =>
  (state: SpanStoreState): readonly [SpanStoreState, ReadonlyArray<StoreEvent>] => {
    const existingSpan = HashMap.get(state.spanById, spanId)

    return pipe(
      existingSpan,
      Option.match({
        onNone: () => {
          // Buffer the event
          const bKey = bufferKey(source, spanId)
          const existing = getOrEmpty(state.eventBuffer, bKey)
          const newBuffer = HashMap.set(state.eventBuffer, bKey, Array.append(existing, event))

          const newState: SpanStoreState = {
            ...state,
            eventBuffer: newBuffer,
          }

          return [newState, [SE.SpanEventAdded({ event, spanId, source })]] as const
        },
        onSome: (span) => {
          // Append event to span
          const updatedSpan: SimpleSpan = {
            ...span,
            events: [...span.events, event],
          }

          // Update spanById
          const newSpanById = HashMap.set(state.spanById, spanId, updatedSpan)

          // Update spansBySource - replace the span in its source array
          const sourceSpans = getOrEmpty(state.spansBySource, source)
          const newSourceSpans = Array.map(sourceSpans, (s) =>
            s.spanId === spanId ? updatedSpan : s,
          )
          const newSpansBySource = HashMap.set(state.spansBySource, source, newSourceSpans)

          // Update spansByTrace - replace the span in its trace array
          const traceSpans = getOrEmpty(state.spansByTrace, updatedSpan.traceId)
          const newTraceSpans = Array.map(traceSpans, (s) =>
            s.spanId === spanId ? updatedSpan : s,
          )
          const newSpansByTrace = HashMap.set(state.spansByTrace, updatedSpan.traceId, newTraceSpans)

          // Update rootByTrace if this is the root
          const newRootByTrace = updatedSpan.parent === null
            ? HashMap.set(state.rootByTrace, updatedSpan.traceId, updatedSpan)
            : state.rootByTrace

          const newState: SpanStoreState = {
            ...state,
            spanById: newSpanById,
            spansBySource: newSpansBySource,
            spansByTrace: newSpansByTrace,
            rootByTrace: newRootByTrace,
          }

          return [newState, [SE.SpanEventAdded({ event, spanId, source })]] as const
        },
      }),
    )
  }

// =============================================================================
// updateMetrics
// =============================================================================

/**
 * Replace all metrics for a given source.
 * Returns curried: updateMetrics(metrics, source)(state) -> [state, events]
 */
export const updateMetrics = (metrics: ReadonlyArray<SimpleMetric>, source: SourceKey) =>
  (state: SpanStoreState): readonly [SpanStoreState, ReadonlyArray<StoreEvent>] => {
    const newState: SpanStoreState = {
      ...state,
      metricsBySource: HashMap.set(state.metricsBySource, source, metrics),
    }

    return [newState, [SE.MetricsUpdated({ source })]] as const
  }

// =============================================================================
// computeSpanStats
// =============================================================================

/** Accumulator for span stats computation */
interface SpanStatsAcc {
  readonly count: number
  readonly errorCount: number
  readonly totalDurationMs: number
}

/**
 * Compute aggregated stats per span name across all sources.
 * Pure derivation from state, no mutation.
 */
export const computeSpanStats = (state: SpanStoreState): ReadonlyArray<SpanNameStats> => {
  // Collect all spans from all sources
  const allSpans: ReadonlyArray<SimpleSpan> = pipe(
    HashMap.values(state.spansBySource),
    (iter) => Array.fromIterable(iter),
    Array.flatten,
  )

  // Group by name using reduce into a HashMap
  const grouped: HashMap.HashMap<string, SpanStatsAcc> = Array.reduce(
    allSpans,
    HashMap.empty<string, SpanStatsAcc>(),
    (acc, span) => {
      const durationMs = span.endTime !== null
        ? Number(span.endTime - span.startTime) / 1_000_000
        : 0
      const isError = span.status === "ended" && span.attributes["error"] !== undefined

      return pipe(
        HashMap.get(acc, span.name),
        Option.match({
          onNone: () => HashMap.set(acc, span.name, {
            count: 1,
            errorCount: isError ? 1 : 0,
            totalDurationMs: durationMs,
          }),
          onSome: (existing) => HashMap.set(acc, span.name, {
            count: existing.count + 1,
            errorCount: existing.errorCount + (isError ? 1 : 0),
            totalDurationMs: existing.totalDurationMs + durationMs,
          }),
        }),
      )
    },
  )

  // Convert to SpanNameStats array
  return pipe(
    HashMap.toEntries(grouped),
    Array.map(([name, stats]): SpanNameStats => ({
      name,
      count: stats.count,
      errorCount: stats.errorCount,
      avgDurationMs: stats.count > 0 ? stats.totalDurationMs / stats.count : 0,
    })),
  )
}
