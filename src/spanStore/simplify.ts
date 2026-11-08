/**
 * Simplify Functions
 *
 * Pure functions that convert Effect DevTools Domain types into our
 * simplified store types (SimpleSpan, SimpleSpanEvent, SimpleMetric).
 *
 * Moved from src/store.tsx to keep the Solid store free of Domain imports.
 */

import * as Option from "effect/Option"
import type * as Domain from "effect/devtools/DevToolsSchema"
import type { SimpleSpan, SimpleSpanEvent, SimpleMetric } from "../storeTypes"

// =============================================================================
// Span Simplification
// =============================================================================

export const simplifySpan = (span: Domain.Span): SimpleSpan => {
  const attrs: Record<string, unknown> = Object.fromEntries(
    Array.from(span.attributes).map(([key, value]) => {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return [key, value]
      }
      if (value === null || value === undefined) {
        return [key, null]
      }
      return [key, String(value)]
    }),
  )

  return {
    spanId: span.spanId,
    traceId: span.traceId,
    name: span.name,
    parent: Option.isSome(span.parent) ? span.parent.value.spanId : null,
    status: span.status._tag === "Ended" ? "ended" : "running",
    startTime: span.status.startTime,
    endTime: span.status._tag === "Ended" ? span.status.endTime : null,
    attributes: attrs,
    events: [], // Events added separately via addSpanEvent
  }
}

// =============================================================================
// Span Event Simplification
// =============================================================================

export const simplifySpanEvent = (event: Domain.SpanEvent): SimpleSpanEvent => {
  const attrs: Record<string, unknown> = Object.fromEntries(
    Object.entries(event.attributes ?? {}).map(([key, value]) => {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return [key, value]
      }
      if (value === null || value === undefined) {
        return [key, null]
      }
      return [key, String(value)]
    }),
  )

  return {
    name: event.name,
    startTime: event.startTime,
    attributes: attrs,
  }
}

// =============================================================================
// Metric Simplification
// =============================================================================

/**
 * Converts a devtools metric into the store shape. `value` is the metric's
 * headline number; `details` carries the other fields of its state.
 */
export const simplifyMetric = (metric: Domain.Metric): SimpleMetric => {
  const { value, details } = summarizeMetricState(metric)
  return {
    name: metric.id,
    type: metric.type,
    value,
    tags: { ...metric.attributes },
    details,
  }
}

const summarizeMetricState = (
  metric: Domain.Metric,
): { value: number | string; details: Record<string, number | string> } => {
  switch (metric.type) {
    case "Counter":
      return { value: Number(metric.state.count), details: {} }
    case "Gauge":
      return { value: Number(metric.state.value), details: {} }
    case "Histogram":
    case "Summary":
      return {
        value: Number(metric.state.count),
        details: {
          count: Number(metric.state.count),
          sum: metric.state.sum,
          min: metric.state.min,
          max: metric.state.max,
        },
      }
    case "Frequency":
      return {
        value: `${metric.state.occurrences.size} entries`,
        details: Object.fromEntries(metric.state.occurrences),
      }
  }
}
