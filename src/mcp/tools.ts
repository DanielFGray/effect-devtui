/**
 * MCP Tool Definitions using @effect/ai
 *
 * This module defines all MCP tools for querying Effect DevTools data.
 * Span and metric queries use the SpanStore service (indexed, Effect-native).
 * Client queries use StoreReader (Solid.js store for UI state).
 */

import * as Tool from "@effect/ai/Tool";
import * as Toolkit from "@effect/ai/Toolkit";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Array from "effect/Array";
import { pipe } from "effect/Function";
import { SpanStore } from "../spanStore/service";
import type { SourceKey, SpanStoreState } from "../spanStore/types";
import { StoreReader } from "../storeReaderService";
import type { SimpleSpan, SimpleSpanEvent, SimpleMetric } from "../storeTypes";

// =============================================================================
// Helpers
// =============================================================================

/** Convert bigint nanoseconds to milliseconds number */
const nsToMs = (ns: bigint): number => Number(ns / 1_000_000n);

/** Convert bigint nanoseconds to ISO string */
const nsToIso = (ns: bigint): string => {
  const ms = nsToMs(ns);
  return new Date(ms).toISOString();
};

/** Comparator for descending bigint startTime */
const byStartTimeDesc = (a: SimpleSpan, b: SimpleSpan): number =>
  b.startTime > a.startTime ? 1 : b.startTime < a.startTime ? -1 : 0;

/** Comparator for ascending bigint startTime */
const byStartTimeAsc = (a: SimpleSpan, b: SimpleSpan): number =>
  a.startTime > b.startTime ? 1 : a.startTime < b.startTime ? -1 : 0;

/** Convert SimpleSpan to MCP-safe format */
const toMcpSpan = (span: SimpleSpan, clientId: number | null) => ({
  spanId: span.spanId,
  traceId: span.traceId,
  clientId,
  name: span.name,
  parent: span.parent,
  status: span.status,
  startTime: nsToIso(span.startTime),
  startTimeMs: nsToMs(span.startTime),
  endTime: span.endTime ? nsToIso(span.endTime) : null,
  endTimeMs: span.endTime ? nsToMs(span.endTime) : null,
  durationMs: span.endTime ? nsToMs(span.endTime - span.startTime) : null,
  attributes: span.attributes,
  eventCount: span.events.length,
});

/** Convert SimpleSpan to detailed MCP format (includes events) */
const toMcpSpanDetailed = (span: SimpleSpan, clientId: number | null) => ({
  ...toMcpSpan(span, clientId),
  events: span.events.map((e: SimpleSpanEvent) => ({
    name: e.name,
    time: nsToIso(e.startTime),
    timeMs: nsToMs(e.startTime),
    attributes: e.attributes,
  })),
});

/** Collect all metrics from all sources with clientId annotation */
const allMetricsFromState = (
  state: SpanStoreState,
): ReadonlyArray<{ readonly metric: SimpleMetric; readonly clientId: number | null }> =>
  pipe(
    HashMap.toEntries(state.metricsBySource),
    Array.flatMap(([source, metrics]) => {
      const cid: number | null = typeof source === "number" ? source : null;
      return metrics.map((m) => ({ metric: m, clientId: cid }));
    }),
  );

/** Build a recursive span tree from a flat list of spans */
interface SpanNode {
  readonly spanId: string;
  readonly name: string;
  readonly status: "running" | "ended";
  readonly startTime: string;
  readonly durationMs: number | null;
  readonly children: ReadonlyArray<SpanNode>;
}

const buildSpanTree = (spans: ReadonlyArray<SimpleSpan>): ReadonlyArray<SpanNode> => {
  // Group spans by parent ID using a functional reduce
  const childrenMap = spans.reduce<Map<string | null, SimpleSpan[]>>(
    (acc, span) => {
      const parentId = span.parent;
      const existing = acc.get(parentId) ?? [];
      acc.set(parentId, [...existing, span]);
      return acc;
    },
    new Map(),
  );

  const buildLevel = (parentId: string | null): ReadonlyArray<SpanNode> =>
    pipe(
      childrenMap.get(parentId) ?? [],
      (children) => [...children].sort(byStartTimeAsc),
      Array.map((span): SpanNode => ({
        spanId: span.spanId,
        name: span.name,
        status: span.status,
        startTime: nsToIso(span.startTime),
        durationMs: span.endTime
          ? nsToMs(span.endTime - span.startTime)
          : null,
        children: buildLevel(span.spanId),
      })),
    );

  return buildLevel(null);
};

// =============================================================================
// Tool Definitions
// =============================================================================

const ListSpansTool = Tool.make("list_spans", {
  description:
    "List Effect spans from connected DevTools clients. Returns spans sorted by start time (newest first). Use filters to narrow results.",
  parameters: {
    clientId: Schema.optional(
      Schema.Number.pipe(Schema.int()).annotations({
        description: "Filter spans to a specific client ID. Omit to include all clients.",
      }),
    ),
    status: Schema.optional(
      Schema.Literal("running", "ended", "all").annotations({
        description: "Filter by span status. Default: all",
      }),
    ),
    traceId: Schema.optional(
      Schema.String.annotations({ description: "Filter by trace ID" }),
    ),
    namePattern: Schema.optional(
      Schema.String.annotations({
        description: "Filter by span name (case-insensitive substring match)",
      }),
    ),
    limit: Schema.optional(
      Schema.Number.pipe(Schema.int(), Schema.between(1, 500)).annotations({
        description: "Maximum spans to return. Default: 100",
      }),
    ),
  },
  success: Schema.Struct({
    spans: Schema.Array(Schema.Unknown),
    total: Schema.Number,
    hasMore: Schema.Boolean,
  }),
}).annotate(Tool.Readonly, true);

const GetSpanTool = Tool.make("get_span", {
  description:
    "Get detailed information about a specific span by ID, including all events and attributes.",
  parameters: {
    spanId: Schema.String.annotations({
      description: "The span ID to retrieve",
    }),
    clientId: Schema.optional(
      Schema.Number.pipe(Schema.int()).annotations({
        description: "Limit lookup to a specific client ID.",
      }),
    ),
    includeChildren: Schema.optional(
      Schema.Boolean.annotations({
        description: "Include child spans in response. Default: false",
      }),
    ),
  },
  success: Schema.Struct({
    span: Schema.NullOr(Schema.Unknown),
    children: Schema.optional(Schema.Array(Schema.Unknown)),
    error: Schema.optional(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

const GetActiveSpansTool = Tool.make("get_active_spans", {
  description:
    "Get currently running (active) spans. Shortcut for list_spans with status='running'.",
  parameters: {
    clientId: Schema.optional(
      Schema.Number.pipe(Schema.int()).annotations({
        description: "Filter active spans to a specific client ID.",
      }),
    ),
    limit: Schema.optional(
      Schema.Number.pipe(Schema.int(), Schema.between(1, 100)).annotations({
        description: "Maximum spans to return. Default: 50",
      }),
    ),
  },
  success: Schema.Struct({
    spans: Schema.Array(Schema.Unknown),
    count: Schema.Number,
  }),
}).annotate(Tool.Readonly, true);

const ListClientsTool = Tool.make("list_clients", {
  description: "List Effect applications currently connected to DevTools.",
  parameters: {},
  success: Schema.Struct({
    clients: Schema.Array(
      Schema.Struct({
        id: Schema.Number,
        name: Schema.String,
      }),
    ),
    count: Schema.Number,
    activeClientId: Schema.NullOr(Schema.Number),
  }),
}).annotate(Tool.Readonly, true);

const GetMetricsTool = Tool.make("get_metrics", {
  description:
    "Get the current metrics snapshot from connected Effect applications.",
  parameters: {
    clientId: Schema.optional(
      Schema.Number.pipe(Schema.int()).annotations({
        description: "Filter metrics to a specific client ID.",
      }),
    ),
    namePattern: Schema.optional(
      Schema.String.annotations({
        description:
          "Filter metrics by name (case-insensitive substring match)",
      }),
    ),
    type: Schema.optional(
      Schema.Literal(
        "Counter",
        "Gauge",
        "Histogram",
        "Frequency",
        "Summary",
      ).annotations({
        description: "Filter by metric type",
      }),
    ),
  },
  success: Schema.Struct({
    metrics: Schema.Array(Schema.Unknown),
    count: Schema.Number,
  }),
}).annotate(Tool.Readonly, true);

const GetSpanTreeTool = Tool.make("get_span_tree", {
  description:
    "Get the hierarchical span tree for a trace. Returns spans organized by parent-child relationships.",
  parameters: {
    traceId: Schema.String.annotations({
      description: "The trace ID to build tree for",
    }),
    clientId: Schema.optional(
      Schema.Number.pipe(Schema.int()).annotations({
        description: "Filter trace tree to a specific client ID.",
      }),
    ),
  },
  success: Schema.Struct({
    traceId: Schema.String,
    rootSpans: Schema.Array(Schema.Unknown),
    spanCount: Schema.Number,
    error: Schema.optional(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

const GetSpanStatsTool = Tool.make("get_span_stats", {
  description:
    "Get aggregated statistics for span names (count, error rate, avg duration).",
  parameters: {
    namePattern: Schema.optional(
      Schema.String.annotations({
        description: "Filter stats by span name (case-insensitive substring match)",
      }),
    ),
  },
  success: Schema.Struct({
    stats: Schema.Array(Schema.Unknown),
    count: Schema.Number,
  }),
}).annotate(Tool.Readonly, true);

const ListTracesTool = Tool.make("list_traces", {
  description:
    "List traces with summary info (span count, root name, error status).",
  parameters: {
    limit: Schema.optional(
      Schema.Number.pipe(Schema.int(), Schema.between(1, 200)).annotations({
        description: "Maximum traces to return. Default: 50",
      }),
    ),
  },
  success: Schema.Struct({
    traces: Schema.Array(Schema.Unknown),
    total: Schema.Number,
    hasMore: Schema.Boolean,
  }),
}).annotate(Tool.Readonly, true);

// =============================================================================
// Toolkit
// =============================================================================

export const DevToolsToolkit = Toolkit.make(
  ListSpansTool,
  GetSpanTool,
  GetActiveSpansTool,
  ListClientsTool,
  GetMetricsTool,
  GetSpanTreeTool,
  GetSpanStatsTool,
  ListTracesTool,
);

// =============================================================================
// Handlers Layer
// =============================================================================

export const DevToolsToolkitHandlers = DevToolsToolkit.toLayer(
  Effect.gen(function* () {
    const spanStore = yield* SpanStore;
    const storeReader = yield* StoreReader;

    return {
      list_spans: ({ clientId, status, traceId, namePattern, limit = 100 }) =>
        Effect.gen(function* () {
          // Get initial span set based on filters
          const allSpans = traceId
            ? yield* spanStore.getByTrace(traceId)
            : yield* spanStore.getAllSpans(
                clientId !== undefined ? (clientId as SourceKey) : undefined,
              );

          const cid: number | null = clientId !== undefined ? clientId : null;

          // Apply client-side filters and sort
          const filtered = pipe(
            allSpans,
            Array.filter((s) =>
              (!status || status === "all" || s.status === status) &&
              (!namePattern || s.name.toLowerCase().includes(namePattern.toLowerCase())),
            ),
            (arr) => [...arr].sort(byStartTimeDesc),
          );

          const total = filtered.length;
          const hasMore = total > limit;
          const limited = filtered.slice(0, limit);

          return {
            spans: limited.map((s) => toMcpSpan(s, cid)),
            total,
            hasMore,
          };
        }),

      get_span: ({ spanId, clientId, includeChildren = false }) =>
        Effect.gen(function* () {
          const state = yield* spanStore.snapshot();
          const cid: number | null = clientId !== undefined ? clientId : null;

          const span = pipe(
            HashMap.get(state.spanById, spanId),
            Option.getOrNull,
          );

          if (!span) {
            return { span: null, error: `Span not found: ${spanId}` };
          }

          const result: {
            span: ReturnType<typeof toMcpSpanDetailed>;
            children?: ReadonlyArray<{
              spanId: string;
              name: string;
              status: string;
              durationMs: number | null;
            }>;
            error?: string;
          } = {
            span: toMcpSpanDetailed(span, cid),
          };

          if (includeChildren) {
            const traceSpans = pipe(
              HashMap.get(state.spansByTrace, span.traceId),
              Option.getOrElse((): ReadonlyArray<SimpleSpan> => []),
            );
            result.children = pipe(
              traceSpans,
              Array.filter((s) => s.parent === spanId),
              Array.map((s) => ({
                spanId: s.spanId,
                name: s.name,
                status: s.status,
                durationMs: s.endTime ? nsToMs(s.endTime - s.startTime) : null,
              })),
            );
          }

          return result;
        }),

      get_active_spans: ({ clientId, limit = 50 }) =>
        Effect.gen(function* () {
          const source: SourceKey | undefined =
            clientId !== undefined ? (clientId as SourceKey) : undefined;
          const allSpans = yield* spanStore.getAllSpans(source);
          const now = BigInt(Date.now()) * 1_000_000n;
          const cid: number | null = clientId !== undefined ? clientId : null;

          const activeSpans = pipe(
            allSpans,
            Array.filter((s) => s.status === "running"),
            (arr) => [...arr].sort(byStartTimeDesc),
            (arr) => arr.slice(0, limit),
            Array.map((s) => ({
              spanId: s.spanId,
              traceId: s.traceId,
              clientId: cid,
              name: s.name,
              parent: s.parent,
              startTime: nsToIso(s.startTime),
              startTimeMs: nsToMs(s.startTime),
              runningForMs: nsToMs(now - s.startTime),
              attributes: s.attributes,
            })),
          );

          return { spans: activeSpans, count: activeSpans.length };
        }),

      list_clients: () =>
        Effect.gen(function* () {
          const store = yield* storeReader.getState;
          const clients = store.clients.map((c) => ({
            id: c.id,
            name: c.name,
          }));
          const activeClientId =
            store.activeClient._tag === "Some"
              ? store.activeClient.value.id
              : null;

          return { clients, count: clients.length, activeClientId };
        }),

      get_metrics: ({ clientId, namePattern, type }) =>
        Effect.gen(function* () {
          const state = yield* spanStore.snapshot();

          const allMetrics = clientId !== undefined
            ? pipe(
                HashMap.get(state.metricsBySource, clientId as SourceKey),
                Option.getOrElse((): ReadonlyArray<SimpleMetric> => []),
                Array.map((m) => ({ metric: m, clientId: clientId as number | null })),
              )
            : allMetricsFromState(state);

          const filtered = pipe(
            allMetrics,
            Array.filter((m) =>
              (!namePattern || m.metric.name.toLowerCase().includes(namePattern.toLowerCase())) &&
              (!type || m.metric.type === type),
            ),
          );

          return {
            metrics: filtered.map((m) => ({
              ...m.metric,
              clientId: m.clientId,
            })),
            count: filtered.length,
          };
        }),

      get_span_tree: ({ traceId, clientId }) =>
        Effect.gen(function* () {
          // When clientId is provided, get source-specific spans filtered by traceId.
          // Otherwise use the trace index directly.
          const spans = clientId !== undefined
            ? pipe(
                yield* spanStore.getAllSpans(clientId as SourceKey),
                Array.filter((s) => s.traceId === traceId),
              )
            : yield* spanStore.getByTrace(traceId);

          if (spans.length === 0) {
            return {
              traceId,
              rootSpans: [],
              spanCount: 0,
              error: `No spans found for trace: ${traceId}`,
            };
          }

          return {
            traceId,
            rootSpans: buildSpanTree(spans),
            spanCount: spans.length,
          };
        }),

      get_span_stats: ({ namePattern }) =>
        Effect.gen(function* () {
          const allStats = yield* spanStore.getStats();
          const filtered = namePattern
            ? pipe(
                allStats,
                Array.filter((s) =>
                  s.name.toLowerCase().includes(namePattern.toLowerCase()),
                ),
              )
            : allStats;

          return { stats: filtered, count: filtered.length };
        }),

      list_traces: ({ limit = 50 }) =>
        Effect.gen(function* () {
          const state = yield* spanStore.snapshot();

          const traces = pipe(
            HashMap.toEntries(state.spansByTrace),
            Array.map(([traceId, spans]) => {
              const earliestStart = spans.reduce(
                (min, s) => (s.startTime < min ? s.startTime : min),
                spans[0]?.startTime ?? 0n,
              );
              return {
                traceId,
                spanCount: spans.length,
                rootSpanName: pipe(
                  HashMap.get(state.rootByTrace, traceId),
                  Option.map((r) => r.name),
                  Option.getOrElse(() => "<unknown>"),
                ),
                hasError: pipe(
                  HashMap.get(state.hasErrorByTrace, traceId),
                  Option.getOrElse(() => false),
                ),
                startTime: spans.length > 0 ? nsToIso(earliestStart) : null,
                startTimeMs: spans.length > 0 ? nsToMs(earliestStart) : null,
              };
            }),
            // Sort by startTime descending (newest first)
            (arr) => [...arr].sort((a, b) =>
              (b.startTimeMs ?? 0) > (a.startTimeMs ?? 0) ? 1
              : (b.startTimeMs ?? 0) < (a.startTimeMs ?? 0) ? -1
              : 0,
            ),
          );

          const total = traces.length;
          const hasMore = total > limit;
          const limited = traces.slice(0, limit);

          return { traces: limited, total, hasMore };
        }),
    };
  }),
);
