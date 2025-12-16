/**
 * MCP Tool Definitions using @effect/ai
 *
 * This module defines all MCP tools for querying Effect DevTools data.
 * Tools use the StoreReader service to access current state.
 */

import * as Tool from "@effect/ai/Tool";
import * as Toolkit from "@effect/ai/Toolkit";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { StoreReader } from "../storeReaderService";
import type { SimpleSpan, SimpleSpanEvent } from "../storeTypes";

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

/** Convert SimpleSpan to MCP-safe format */
const toMcpSpan = (span: SimpleSpan) => ({
  spanId: span.spanId,
  traceId: span.traceId,
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
const toMcpSpanDetailed = (span: SimpleSpan) => ({
  ...toMcpSpan(span),
  events: span.events.map((e: SimpleSpanEvent) => ({
    name: e.name,
    time: nsToIso(e.startTime),
    timeMs: nsToMs(e.startTime),
    attributes: e.attributes,
  })),
});

// =============================================================================
// Tool Definitions
// =============================================================================

const ListSpansTool = Tool.make("list_spans", {
  description:
    "List Effect spans from connected DevTools clients. Returns spans sorted by start time (newest first). Use filters to narrow results.",
  parameters: {
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
  },
  success: Schema.Struct({
    traceId: Schema.String,
    rootSpans: Schema.Array(Schema.Unknown),
    spanCount: Schema.Number,
    error: Schema.optional(Schema.String),
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
);

// =============================================================================
// Handlers Layer
// =============================================================================

export const DevToolsToolkitHandlers = DevToolsToolkit.toLayer(
  Effect.gen(function* () {
    const storeReader = yield* StoreReader;

    return {
      list_spans: ({ status, traceId, namePattern, limit = 100 }) =>
        Effect.gen(function* () {
          const store = yield* storeReader.getState;
          let spans = [...store.spans];

          if (status && status !== "all") {
            spans = spans.filter((s) => s.status === status);
          }
          if (traceId) {
            spans = spans.filter((s) => s.traceId === traceId);
          }
          if (namePattern) {
            const pattern = namePattern.toLowerCase();
            spans = spans.filter((s) => s.name.toLowerCase().includes(pattern));
          }

          spans.sort((a, b) => (b.startTime > a.startTime ? 1 : -1));

          const total = spans.length;
          const hasMore = total > limit;
          const limitedSpans = spans.slice(0, limit);

          return {
            spans: limitedSpans.map(toMcpSpan),
            total,
            hasMore,
          };
        }),

      get_span: ({ spanId, includeChildren = false }) =>
        Effect.gen(function* () {
          const store = yield* storeReader.getState;
          const span = store.spans.find((s) => s.spanId === spanId);

          if (!span) {
            return { span: null, error: `Span not found: ${spanId}` };
          }

          const result: {
            span: ReturnType<typeof toMcpSpanDetailed>;
            children?: Array<{
              spanId: string;
              name: string;
              status: string;
              durationMs: number | null;
            }>;
          } = {
            span: toMcpSpanDetailed(span),
          };

          if (includeChildren) {
            result.children = store.spans
              .filter((s) => s.parent === spanId)
              .map((s) => ({
                spanId: s.spanId,
                name: s.name,
                status: s.status,
                durationMs: s.endTime ? nsToMs(s.endTime - s.startTime) : null,
              }));
          }

          return result;
        }),

      get_active_spans: ({ limit = 50 }) =>
        Effect.gen(function* () {
          const store = yield* storeReader.getState;
          const now = BigInt(Date.now()) * 1_000_000n;

          const activeSpans = store.spans
            .filter((s) => s.status === "running")
            .sort((a, b) => (b.startTime > a.startTime ? 1 : -1))
            .slice(0, limit)
            .map((s) => ({
              spanId: s.spanId,
              traceId: s.traceId,
              name: s.name,
              parent: s.parent,
              startTime: nsToIso(s.startTime),
              startTimeMs: nsToMs(s.startTime),
              runningForMs: nsToMs(now - s.startTime),
              attributes: s.attributes,
            }));

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

      get_metrics: ({ namePattern, type }) =>
        Effect.gen(function* () {
          const store = yield* storeReader.getState;
          let metrics = [...store.metrics];

          if (namePattern) {
            const pattern = namePattern.toLowerCase();
            metrics = metrics.filter((m) =>
              m.name.toLowerCase().includes(pattern),
            );
          }
          if (type) {
            metrics = metrics.filter((m) => m.type === type);
          }

          return { metrics, count: metrics.length };
        }),

      get_span_tree: ({ traceId }) =>
        Effect.gen(function* () {
          const store = yield* storeReader.getState;
          const traceSpans = store.spans.filter((s) => s.traceId === traceId);

          if (traceSpans.length === 0) {
            return {
              traceId,
              rootSpans: [],
              spanCount: 0,
              error: `No spans found for trace: ${traceId}`,
            };
          }

          // Build parent-child map
          const childrenMap = new Map<string | null, SimpleSpan[]>();
          for (const span of traceSpans) {
            const parentId = span.parent;
            if (!childrenMap.has(parentId)) {
              childrenMap.set(parentId, []);
            }
            childrenMap.get(parentId)!.push(span);
          }

          // Recursive tree builder
          interface SpanNode {
            spanId: string;
            name: string;
            status: "running" | "ended";
            startTime: string;
            durationMs: number | null;
            children: SpanNode[];
          }

          const buildTree = (parentId: string | null): SpanNode[] => {
            const children = childrenMap.get(parentId) || [];
            return children
              .sort((a, b) => (a.startTime > b.startTime ? 1 : -1))
              .map((span) => ({
                spanId: span.spanId,
                name: span.name,
                status: span.status,
                startTime: nsToIso(span.startTime),
                durationMs: span.endTime
                  ? nsToMs(span.endTime - span.startTime)
                  : null,
                children: buildTree(span.spanId),
              }));
          };

          return {
            traceId,
            rootSpans: buildTree(null),
            spanCount: traceSpans.length,
          };
        }),
    };
  }),
);
