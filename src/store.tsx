/**
 * Store for Effect DevTools TUI
 *
 * Uses Solid.js createStore for reactive state management.
 * The store is created inside a context provider to ensure
 * it's initialized within Solid's reactivity context.
 */

import * as Option from "effect/Option";
import * as HashSet from "effect/HashSet";
import { createStore, produce, reconcile } from "solid-js/store";
import {
  batch,
  createContext,
  useContext,
  onMount,
  type ParentProps,
} from "solid-js";
import type * as Domain from "@effect/experimental/DevTools/Domain";
import type { Client } from "./server";
import * as fs from "fs";

const log = (msg: string) => {
  fs.appendFileSync(
    "/tmp/effect-tui.log",
    `${new Date().toISOString()} - Store: ${msg}\n`,
  );
};

// =============================================================================
// Types
// =============================================================================

export type TabId = "clients" | "tracer" | "metrics";

export interface SimpleSpanEvent {
  name: string;
  startTime: bigint; // Time relative to span start
  attributes: Record<string, unknown>;
}

export interface SimpleSpan {
  spanId: string;
  traceId: string;
  name: string;
  parent: string | null;
  status: "running" | "ended";
  startTime: bigint;
  endTime: bigint | null;
  attributes: Record<string, unknown>;
  events: SimpleSpanEvent[];
}

export interface SimpleMetric {
  name: string;
  type: "Counter" | "Gauge" | "Histogram" | "Frequency" | "Summary";
  value: number | string;
  tags: Record<string, string>;
  details?: Record<string, number | string>;
}

export interface UIState {
  activeTab: TabId;
  showHelp: boolean;
  selectedSpanId: Option.Option<string>;
  selectedTraceId: Option.Option<string>; // For selecting trace groups
  selectedMetricName: Option.Option<string>;
  selectedClientIndex: number; // Index into clients array
  expandedSpanIds: Set<string>;
  expandedTraceIds: Set<string>; // For trace grouping
  focusedPane: "main" | "details";
}

export interface StoreState {
  spans: SimpleSpan[];
  metrics: SimpleMetric[];
  clients: Client[];
  activeClient: Option.Option<Client>;
  serverStatus: "starting" | "listening" | "connected";
  ui: UIState;
  debugCounter: number; // Debug: test if setInterval updates work
}

export interface StoreActions {
  // Span actions
  addSpan: (span: Domain.Span) => void;
  updateSpan: (span: Domain.Span) => void;
  addSpanEvent: (event: Domain.SpanEvent) => void;
  clearSpans: () => void;
  selectSpan: (spanId: Option.Option<string>) => void;
  selectTrace: (traceId: Option.Option<string>) => void; // New: select trace group
  toggleSpanExpanded: (spanId: string) => void;
  toggleTraceExpanded: (traceId: string) => void;

  // Metric actions
  updateMetrics: (snapshot: Domain.MetricsSnapshot) => void;
  clearMetrics: () => void;
  selectMetric: (name: Option.Option<string>) => void;

  // Client actions
  setClientsFromHashSet: (clients: HashSet.HashSet<Client>) => void;
  setActiveClient: (client: Option.Option<Client>) => void;
  setServerStatus: (status: "starting" | "listening" | "connected") => void;
  selectClientByIndex: (index: number) => void;

  // UI actions
  setActiveTab: (tab: TabId) => void;
  toggleHelp: () => void;
  setFocusedPane: (pane: "main" | "details") => void;
  navigateUp: () => void;
  navigateDown: () => void;
  toggleExpand: () => void;
}

export interface StoreContext {
  store: StoreState;
  actions: StoreActions;
}

// =============================================================================
// Helpers
// =============================================================================

function simplifySpan(span: Domain.Span): SimpleSpan {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of span.attributes) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      attrs[key] = value;
    } else if (value === null || value === undefined) {
      attrs[key] = null;
    } else {
      attrs[key] = String(value);
    }
  }

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
  };
}

function simplifySpanEvent(event: Domain.SpanEvent): SimpleSpanEvent {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.attributes)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      attrs[key] = value;
    } else if (value === null || value === undefined) {
      attrs[key] = null;
    } else {
      attrs[key] = String(value);
    }
  }

  return {
    name: event.name,
    startTime: event.startTime,
    attributes: attrs,
  };
}

function simplifyMetric(metric: Domain.Metric): SimpleMetric {
  const tags: Record<string, string> = {};
  for (const tag of metric.tags) {
    tags[tag.key] = tag.value;
  }

  let value: number | string = "";
  let details: Record<string, number | string> = {};

  switch (metric._tag) {
    case "Counter":
      value = Number(metric.state.count); // Convert bigint to number
      break;
    case "Gauge":
      value = Number(metric.state.value); // Convert bigint to number
      break;
    case "Histogram":
      value = Number(metric.state.count);
      details = {
        count: Number(metric.state.count),
        sum: Number(metric.state.sum),
        min: Number(metric.state.min),
        max: Number(metric.state.max),
      };
      break;
    case "Frequency":
      value = metric.state.occurrences.size + " entries";
      const occurrences: Record<string, number> = {};
      for (const key of Object.keys(metric.state.occurrences)) {
        occurrences[String(key)] = Number(metric.state.occurrences[key]);
      }
      details = occurrences;
      break;
    case "Summary":
      value = Number(metric.state.count);
      details = {
        count: Number(metric.state.count),
        sum: Number(metric.state.sum),
        min: Number(metric.state.min),
        max: Number(metric.state.max),
      };
      break;
  }

  return {
    name: metric.name,
    type: metric._tag,
    value,
    tags,
    details,
  };
}

// =============================================================================
// Context
// =============================================================================

const DevToolsStoreContext = createContext<StoreContext>();

export function useStore(): StoreContext {
  const ctx = useContext(DevToolsStoreContext);
  if (!ctx) {
    throw new Error("useStore must be used within StoreProvider");
  }
  return ctx;
}

// =============================================================================
// Provider Component
// =============================================================================

export function StoreProvider(props: ParentProps) {
  log(
    `StoreProvider: Initializing new store instance at ${new Date().toISOString()}`,
  );
  const [store, setStore] = createStore<StoreState>({
    spans: [],
    metrics: [],
    clients: [],
    activeClient: Option.none(),
    serverStatus: "starting",
    ui: {
      activeTab: "tracer" as const,
      showHelp: false,
      selectedSpanId: Option.none(),
      selectedTraceId: Option.none(),
      selectedMetricName: Option.none(),
      selectedClientIndex: 0,
      expandedSpanIds: new Set(),
      expandedTraceIds: new Set(),
      focusedPane: "main" as const,
    },
    debugCounter: 0,
  });

  // Debug: test if setInterval updates work at all
  setInterval(() => {
    setStore("debugCounter", (c) => c + 1);
  }, 1000);

  // Span buffer for batching updates
  let spanBuffer: SimpleSpan[] = [];
  let spanUpdateBuffer: Map<string, SimpleSpan> = new Map();
  let eventBuffer: Map<string, SimpleSpanEvent[]> = new Map(); // Buffer events by spanId

  const flushSpans = () => {
    if (spanBuffer.length > 0 || spanUpdateBuffer.size > 0) {
      const newSpans = [...spanBuffer];
      const updates = new Map(spanUpdateBuffer);
      spanBuffer = [];
      spanUpdateBuffer = new Map();

      log(
        `flushSpans: ${newSpans.length} new, ${updates.size} updates, current store has ${store.spans.length} spans`,
      );

      // Use direct setStore path-based updates for better reactivity
      // First, apply updates to existing spans
      for (const [spanId, updatedSpan] of updates) {
        const idx = store.spans.findIndex((s) => s.spanId === spanId);
        if (idx >= 0) {
          setStore("spans", idx, updatedSpan);
        }
      }

      // Add new spans
      if (newSpans.length > 0) {
        const currentSpans = [...store.spans];

        // Apply buffered events to new spans before adding them
        for (const span of newSpans) {
          const bufferedEvents = eventBuffer.get(span.spanId);
          if (bufferedEvents && bufferedEvents.length > 0) {
            span.events = bufferedEvents;
            eventBuffer.delete(span.spanId);
            log(
              `flushSpans: Applied ${bufferedEvents.length} buffered events to span ${span.spanId.substring(0, 8)}`,
            );
          }
        }

        const allSpans = [...currentSpans, ...newSpans];
        // Keep only last 200
        const trimmed = allSpans.length > 200 ? allSpans.slice(-200) : allSpans;
        // Update just the spans property
        setStore("spans", trimmed);
      }

      log(
        `flushSpans: After update, store has ${store.spans.length} spans, array=${store.spans
          .slice(0, 3)
          .map((s) => s.spanId.substring(0, 4))
          .join(",")}`,
      );
    }
  };

  // Flush spans periodically
  setInterval(flushSpans, 100);

  // Helper types for navigation
  type NavigableItem =
    | { type: "trace"; traceId: string }
    | { type: "span"; span: SimpleSpan };

  // Helper to get visible items (trace groups + spans) for navigation
  const getVisibleItems = (): NavigableItem[] => {
    log(`getVisibleItems called: store.spans.length=${store.spans.length}`);
    const result: NavigableItem[] = [];
    const spanMap = new Map(store.spans.map((s) => [s.spanId, s]));

    // Group spans by trace ID
    const traceGroups = new Map<string, SimpleSpan[]>();
    for (const span of store.spans) {
      const traceSpans = traceGroups.get(span.traceId) || [];
      traceSpans.push(span);
      traceGroups.set(span.traceId, traceSpans);
    }

    // Sort traces by earliest span start time
    const sortedTraces = Array.from(traceGroups.entries()).sort((a, b) => {
      const aMin = a[1].reduce(
        (min, s) => (s.startTime < min ? s.startTime : min),
        a[1][0].startTime,
      );
      const bMin = b[1].reduce(
        (min, s) => (s.startTime < min ? s.startTime : min),
        b[1][0].startTime,
      );
      if (aMin < bMin) return -1;
      if (aMin > bMin) return 1;
      return 0;
    });

    // Build children map helper
    const buildChildrenMap = (traceSpans: SimpleSpan[]) => {
      const childrenMap = new Map<string, SimpleSpan[]>();
      for (const span of traceSpans) {
        if (span.parent) {
          const children = childrenMap.get(span.parent) || [];
          children.push(span);
          childrenMap.set(span.parent, children);
        }
      }
      return childrenMap;
    };

    // DFS to collect visible spans within a trace
    const visitSpan = (
      span: SimpleSpan,
      childrenMap: Map<string, SimpleSpan[]>,
    ) => {
      result.push({ type: "span", span });

      if (store.ui.expandedSpanIds.has(span.spanId)) {
        const children = childrenMap.get(span.spanId) || [];
        children.sort((a, b) => {
          if (a.startTime < b.startTime) return -1;
          if (a.startTime > b.startTime) return 1;
          return 0;
        });
        for (const child of children) {
          visitSpan(child, childrenMap);
        }
      }
    };

    // Process each trace group
    for (const [traceId, traceSpans] of sortedTraces) {
      // Add trace group header
      result.push({ type: "trace", traceId });

      // If trace is expanded, add its spans
      if (store.ui.expandedTraceIds.has(traceId)) {
        const childrenMap = buildChildrenMap(traceSpans);
        const rootSpans = traceSpans.filter(
          (s) => s.parent === null || !spanMap.has(s.parent),
        );

        rootSpans.sort((a, b) => {
          if (a.startTime < b.startTime) return -1;
          if (a.startTime > b.startTime) return 1;
          return 0;
        });

        for (const root of rootSpans) {
          visitSpan(root, childrenMap);
        }
      }
    }

    log(`getVisibleItems: returning ${result.length} items`);
    return result;
  };

  const actions: StoreActions = {
    addSpan: (span: Domain.Span) => {
      const simple = simplifySpan(span);
      // Check if span already exists
      const existing = store.spans.find((s) => s.spanId === simple.spanId);
      log(
        `addSpan: ${simple.name}, store has ${store.spans.length} spans, existing=${!!existing}`,
      );
      if (existing) {
        spanUpdateBuffer.set(simple.spanId, simple);
      } else {
        spanBuffer.push(simple);
      }
    },

    updateSpan: (span: Domain.Span) => {
      spanUpdateBuffer.set(span.spanId, simplifySpan(span));
    },

    addSpanEvent: (event: Domain.SpanEvent) => {
      const spanId = event.spanId;
      const simpleEvent = simplifySpanEvent(event);

      // Try to find the span in the store
      const idx = store.spans.findIndex((s) => s.spanId === spanId);

      if (idx >= 0) {
        // Span exists, add event directly
        log(
          `addSpanEvent: Adding event "${simpleEvent.name}" to span ${spanId.substring(0, 8)}`,
        );
        setStore("spans", idx, "events", (events) => [...events, simpleEvent]);
      } else {
        // Span doesn't exist yet, buffer the event
        log(
          `addSpanEvent: Buffering event "${simpleEvent.name}" for span ${spanId.substring(0, 8)}`,
        );
        const buffered = eventBuffer.get(spanId) || [];
        buffered.push(simpleEvent);
        eventBuffer.set(spanId, buffered);
      }
    },

    clearSpans: () => {
      spanBuffer = [];
      spanUpdateBuffer.clear();
      batch(() => {
        setStore("spans", []);
        setStore("ui", "selectedSpanId", Option.none());
        setStore("ui", "selectedTraceId", Option.none());
      });
    },

    selectSpan: (spanId: Option.Option<string>) => {
      batch(() => {
        setStore("ui", "selectedSpanId", spanId);
        setStore("ui", "selectedTraceId", Option.none()); // Clear trace selection
      });
    },

    selectTrace: (traceId: Option.Option<string>) => {
      batch(() => {
        setStore("ui", "selectedTraceId", traceId);
        setStore("ui", "selectedSpanId", Option.none()); // Clear span selection
      });
    },

    toggleSpanExpanded: (spanId: string) => {
      setStore(
        produce((draft) => {
          if (draft.ui.expandedSpanIds.has(spanId)) {
            draft.ui.expandedSpanIds.delete(spanId);
          } else {
            draft.ui.expandedSpanIds.add(spanId);
          }
        }),
      );
    },

    toggleTraceExpanded: (traceId: string) => {
      setStore(
        produce((draft) => {
          if (draft.ui.expandedTraceIds.has(traceId)) {
            draft.ui.expandedTraceIds.delete(traceId);
          } else {
            draft.ui.expandedTraceIds.add(traceId);
          }
        }),
      );
    },

    updateMetrics: (snapshot: Domain.MetricsSnapshot) => {
      const metrics = (snapshot.metrics as Domain.Metric[]).map(simplifyMetric);
      batch(() => {
        setStore("metrics", metrics);
      });
    },

    clearMetrics: () => {
      batch(() => {
        setStore("metrics", []);
        setStore("ui", "selectedMetricName", Option.none());
      });
    },

    selectMetric: (name: Option.Option<string>) => {
      batch(() => {
        setStore("ui", "selectedMetricName", name);
      });
    },

    setClientsFromHashSet: (newClients: HashSet.HashSet<Client>) => {
      batch(() => {
        setStore("clients", Array.from(newClients));
      });
    },

    setActiveClient: (client: Option.Option<Client>) => {
      batch(() => {
        setStore("activeClient", client);
      });
    },

    setServerStatus: (status: "starting" | "listening" | "connected") => {
      batch(() => {
        setStore("serverStatus", status);
      });
    },

    selectClientByIndex: (index: number) => {
      const client = store.clients[index];
      if (client) {
        batch(() => {
          setStore("ui", "selectedClientIndex", index);
          setStore("activeClient", Option.some(client));
        });
        log(`selectClientByIndex: Selected client ${index}: ${client.name}`);
      }
    },

    setActiveTab: (tab: TabId) => {
      batch(() => {
        setStore("ui", "activeTab", tab);
      });
    },

    toggleHelp: () => {
      batch(() => {
        setStore("ui", "showHelp", (prev) => !prev);
      });
    },

    setFocusedPane: (pane: "main" | "details") => {
      batch(() => {
        setStore("ui", "focusedPane", pane);
      });
    },

    navigateUp: () => {
      if (store.ui.activeTab === "clients") {
        const clients = store.clients;
        if (clients.length === 0) return;

        const currentIdx = store.ui.selectedClientIndex;
        const newIdx = currentIdx <= 0 ? clients.length - 1 : currentIdx - 1;
        actions.selectClientByIndex(newIdx);
      } else if (store.ui.activeTab === "tracer") {
        const visibleItems = getVisibleItems();
        if (visibleItems.length === 0) return;

        // Find current selection
        const currentSpanId = Option.getOrNull(store.ui.selectedSpanId);
        const currentTraceId = Option.getOrNull(store.ui.selectedTraceId);

        let currentIdx = -1;
        if (currentSpanId) {
          currentIdx = visibleItems.findIndex(
            (item) =>
              item.type === "span" && item.span.spanId === currentSpanId,
          );
        } else if (currentTraceId) {
          currentIdx = visibleItems.findIndex(
            (item) => item.type === "trace" && item.traceId === currentTraceId,
          );
        }

        const newIdx =
          currentIdx <= 0 ? visibleItems.length - 1 : currentIdx - 1;
        const newItem = visibleItems[newIdx];

        if (newItem.type === "trace") {
          actions.selectTrace(Option.some(newItem.traceId));
        } else {
          actions.selectSpan(Option.some(newItem.span.spanId));
        }
      } else if (store.ui.activeTab === "metrics") {
        const metrics = store.metrics;
        if (metrics.length === 0) return;

        const currentName = Option.getOrNull(store.ui.selectedMetricName);
        const currentIdx = currentName
          ? metrics.findIndex((m) => m.name === currentName)
          : -1;

        const newIdx = currentIdx <= 0 ? metrics.length - 1 : currentIdx - 1;
        actions.selectMetric(Option.some(metrics[newIdx].name));
      }
    },

    navigateDown: () => {
      log(
        `navigateDown: ENTRY - store.spans.length=${store.spans.length}, store object id=${typeof store}`,
      );
      if (store.ui.activeTab === "clients") {
        const clients = store.clients;
        if (clients.length === 0) return;

        const currentIdx = store.ui.selectedClientIndex;
        const newIdx = currentIdx >= clients.length - 1 ? 0 : currentIdx + 1;
        actions.selectClientByIndex(newIdx);
      } else if (store.ui.activeTab === "tracer") {
        const visibleItems = getVisibleItems();
        log(
          `navigateDown: ${visibleItems.length} visible items, expandedIds=${Array.from(
            store.ui.expandedSpanIds,
          )
            .map((id) => id.substring(0, 4))
            .join(",")}`,
        );
        if (visibleItems.length === 0) return;

        // Find current selection
        const currentSpanId = Option.getOrNull(store.ui.selectedSpanId);
        const currentTraceId = Option.getOrNull(store.ui.selectedTraceId);

        let currentIdx = -1;
        if (currentSpanId) {
          currentIdx = visibleItems.findIndex(
            (item) =>
              item.type === "span" && item.span.spanId === currentSpanId,
          );
        } else if (currentTraceId) {
          currentIdx = visibleItems.findIndex(
            (item) => item.type === "trace" && item.traceId === currentTraceId,
          );
        }

        log(
          `navigateDown: currentSpanId=${currentSpanId?.substring(0, 8)}, currentTraceId=${currentTraceId?.substring(0, 8)}, currentIdx=${currentIdx}`,
        );

        const newIdx =
          currentIdx >= visibleItems.length - 1 ? 0 : currentIdx + 1;
        const newItem = visibleItems[newIdx];

        if (newItem.type === "trace") {
          actions.selectTrace(Option.some(newItem.traceId));
        } else {
          actions.selectSpan(Option.some(newItem.span.spanId));
        }
      } else if (store.ui.activeTab === "metrics") {
        const metrics = store.metrics;
        if (metrics.length === 0) return;

        const currentName = Option.getOrNull(store.ui.selectedMetricName);
        const currentIdx = currentName
          ? metrics.findIndex((m) => m.name === currentName)
          : -1;

        const newIdx = currentIdx >= metrics.length - 1 ? 0 : currentIdx + 1;
        actions.selectMetric(Option.some(metrics[newIdx].name));
      }
    },

    toggleExpand: () => {
      if (store.ui.activeTab === "tracer") {
        // Check if a trace group is selected
        const selectedTraceId = Option.getOrNull(store.ui.selectedTraceId);
        if (selectedTraceId) {
          log(
            `toggleExpand: toggling trace ${selectedTraceId.substring(0, 8)}`,
          );
          actions.toggleTraceExpanded(selectedTraceId);
          return;
        }

        // Check if a span is selected
        const selectedSpanId = Option.getOrNull(store.ui.selectedSpanId);
        if (selectedSpanId) {
          const hadChildren = store.spans.some(
            (s) => s.parent === selectedSpanId,
          );
          log(
            `toggleExpand: toggling span ${selectedSpanId.substring(0, 8)}, has children: ${hadChildren}`,
          );
          actions.toggleSpanExpanded(selectedSpanId);
        }
      }
    },
  };

  // Export actions globally so Effect runtime can access them
  globalStoreActions = actions;

  // Start the Effect runtime AFTER the store is initialized
  // Use onMount to ensure it only runs once when the component mounts
  onMount(() => {
    log("StoreProvider: Starting Effect runtime from onMount");
    // Import startRuntime here to avoid circular dependency issues
    import("./runtime").then(({ startRuntime }) => {
      startRuntime();
    });
  });

  const ctx: StoreContext = { store, actions };

  return (
    <DevToolsStoreContext.Provider value={ctx}>
      {props.children}
    </DevToolsStoreContext.Provider>
  );
}

// =============================================================================
// Global Actions Reference (for Effect runtime to call)
// =============================================================================

let globalStoreActions: StoreActions | null = null;

export function getGlobalActions(): StoreActions | null {
  return globalStoreActions;
}
