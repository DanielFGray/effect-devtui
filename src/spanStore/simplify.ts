/**
 * Simplify Functions
 *
 * Pure functions that convert Effect DevTools Domain types into our
 * simplified store types (SimpleSpan, SimpleSpanEvent, SimpleMetric).
 *
 * Moved from src/store.tsx to keep the Solid store free of Domain imports.
 */

import * as Option from "effect/Option"
import type * as Domain from "@effect/experimental/DevTools/Domain"
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
    Object.entries(event.attributes).map(([key, value]) => {
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

export const simplifyMetric = (metric: Domain.Metric): SimpleMetric => {
  const tags: Record<string, string> = Object.fromEntries(
    metric.tags.map((tag) => [tag.key, tag.value]),
  )

  const result = (() => {
    switch (metric._tag) {
      case "Counter":
        return {
          value: Number(metric.state.count) as number | string,
          details: {} as Record<string, number | string>,
        }
      case "Gauge":
        return {
          value: Number(metric.state.value) as number | string,
          details: {} as Record<string, number | string>,
        }
      case "Histogram":
        return {
          value: Number(metric.state.count) as number | string,
          details: {
            count: Number(metric.state.count),
            sum: Number(metric.state.sum),
            min: Number(metric.state.min),
            max: Number(metric.state.max),
          } as Record<string, number | string>,
        }
      case "Frequency":
        return {
          value: `${metric.state.occurrences.size} entries` as number | string,
          details: Object.fromEntries(
            Object.keys(metric.state.occurrences).map((key) => [
              String(key),
              Number(metric.state.occurrences[key]),
            ]),
          ) as Record<string, number | string>,
        }
      case "Summary":
        return {
          value: Number(metric.state.count) as number | string,
          details: {
            count: Number(metric.state.count),
            sum: Number(metric.state.sum),
            min: Number(metric.state.min),
            max: Number(metric.state.max),
          } as Record<string, number | string>,
        }
    }
  })()

  return {
    name: metric.name,
    type: metric._tag,
    value: result.value,
    tags,
    details: result.details,
  }
}
