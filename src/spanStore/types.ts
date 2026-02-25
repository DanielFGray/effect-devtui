/**
 * SpanStore Types
 *
 * Immutable state and event types for the span store.
 * Uses Effect HashMap for all map structures and Data.TaggedEnum for events.
 */

import * as HashMap from "effect/HashMap"
import * as Data from "effect/Data"
import type { SimpleSpan, SimpleSpanEvent, SimpleMetric } from "../storeTypes"

// =============================================================================
// Source Key
// =============================================================================

/** Identifies the source of spans/metrics: "server" for built-in, or a numeric client id */
export type SourceKey = "server" | number

// =============================================================================
// Span Store State
// =============================================================================

export interface SpanStoreState {
  readonly spansBySource: HashMap.HashMap<SourceKey, ReadonlyArray<SimpleSpan>>
  readonly spanById: HashMap.HashMap<string, SimpleSpan>
  readonly spansByTrace: HashMap.HashMap<string, ReadonlyArray<SimpleSpan>>
  readonly rootByTrace: HashMap.HashMap<string, SimpleSpan>
  readonly hasErrorByTrace: HashMap.HashMap<string, boolean>
  readonly metricsBySource: HashMap.HashMap<SourceKey, ReadonlyArray<SimpleMetric>>
  readonly eventBuffer: HashMap.HashMap<string, ReadonlyArray<SimpleSpanEvent>>
}

// =============================================================================
// Store Events (Data.TaggedEnum)
// =============================================================================

export type StoreEvent = Data.TaggedEnum<{
  readonly SpanAdded: { readonly span: SimpleSpan; readonly source: SourceKey }
  readonly SpanUpdated: { readonly span: SimpleSpan; readonly source: SourceKey }
  readonly SpanEventAdded: { readonly event: SimpleSpanEvent; readonly spanId: string; readonly source: SourceKey }
  readonly SpansRotated: { readonly droppedCount: number; readonly source: SourceKey }
  readonly MetricsUpdated: { readonly source: SourceKey }
  readonly ClientsChanged: { readonly clients: ReadonlyArray<{ readonly id: number; readonly name: string }> }
}>

export const StoreEvent = Data.taggedEnum<StoreEvent>()

// =============================================================================
// Span Name Stats
// =============================================================================

export interface SpanNameStats {
  readonly name: string
  readonly count: number
  readonly errorCount: number
  readonly avgDurationMs: number
}

// =============================================================================
// Constants
// =============================================================================

export const MAX_SPANS = 1000

// =============================================================================
// Empty State
// =============================================================================

export const empty: SpanStoreState = {
  spansBySource: HashMap.empty<SourceKey, ReadonlyArray<SimpleSpan>>(),
  spanById: HashMap.empty<string, SimpleSpan>(),
  spansByTrace: HashMap.empty<string, ReadonlyArray<SimpleSpan>>(),
  rootByTrace: HashMap.empty<string, SimpleSpan>(),
  hasErrorByTrace: HashMap.empty<string, boolean>(),
  metricsBySource: HashMap.empty<SourceKey, ReadonlyArray<SimpleMetric>>(),
  eventBuffer: HashMap.empty<string, ReadonlyArray<SimpleSpanEvent>>(),
}
