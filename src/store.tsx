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

export type FocusedSection = "clients" | "spans" | "metrics";

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
  focusedSection: FocusedSection;
  showHelp: boolean;
  selectedSpanId: string | null;
  selectedTraceId: string | null; // For selecting trace groups
  selectedMetricName: string | null;
  selectedClientIndex: number; // Index into clients array
  expandedSpanIds: Set<string>;
  expandedTraceIds: Set<string>; // For trace grouping
  clientsExpanded: boolean; // For client dropdown
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
  selectSpan: (spanId: string | null) => void;
  selectTrace: (traceId: string | null) => void; // New: select trace group
  toggleSpanExpanded: (spanId: string) => void;
  toggleTraceExpanded: (traceId: string) => void;

  // Metric actions
  updateMetrics: (snapshot: Domain.MetricsSnapshot) => void;
  clearMetrics: () => void;
  selectMetric: (name: string | null) => void;

  // Client actions
  setClientsFromHashSet: (clients: HashSet.HashSet<Client>) => void;
  setActiveClient: (client: Option.Option<Client>) => void;
  setServerStatus: (status: "starting" | "listening" | "connected") => void;
  selectClientByIndex: (index: number) => void;

  // UI actions
  setFocusedSection: (section: FocusedSection) => void;
  toggleHelp: () => void;
  toggleClientsExpanded: () => void;
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
      focusedSection: "spans" as const,
      showHelp: false,
      selectedSpanId: null,
      selectedTraceId: null,
      selectedMetricName: null,
      selectedClientIndex: 0,
      expandedSpanIds: new Set(),
      expandedTraceIds: new Set(),
      clientsExpanded: false,
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
  type NavigableItem = { type: "span"; span: SimpleSpan };

  // Helper to get visible spans for navigation (simplified - no trace grouping)
  const getVisibleItems = (): NavigableItem[] => {
    log(`getVisibleItems called: store.spans.length=${store.spans.length}`);
    const result: NavigableItem[] = [];
    const spanMap = new Map(store.spans.map((s) => [s.spanId, s]));

    // Build children map
    const childrenMap = new Map<string, SimpleSpan[]>();
    for (const span of store.spans) {
      if (span.parent) {
        const children = childrenMap.get(span.parent) || [];
        children.push(span);
        childrenMap.set(span.parent, children);
      }
    }

    // Sort children by start time
    for (const children of childrenMap.values()) {
      children.sort((a, b) => {
        if (a.startTime < b.startTime) return -1;
        if (a.startTime > b.startTime) return 1;
        return 0;
      });
    }

    // DFS to collect visible spans
    const visitSpan = (span: SimpleSpan) => {
      result.push({ type: "span", span });

      if (store.ui.expandedSpanIds.has(span.spanId)) {
        const children = childrenMap.get(span.spanId) || [];
        for (const child of children) {
          visitSpan(child);
        }
      }
    };

    // Get root spans
    const rootSpans = store.spans.filter(
      (s) => s.parent === null || !spanMap.has(s.parent),
    );

    // Sort root spans by start time
    rootSpans.sort((a, b) => {
      if (a.startTime < b.startTime) return -1;
      if (a.startTime > b.startTime) return 1;
      return 0;
    });

    // Visit each root span
    for (const root of rootSpans) {
      visitSpan(root);
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
        setStore("ui", "selectedSpanId", null);
        setStore("ui", "selectedTraceId", null);
      });
    },

    selectSpan: (spanId: string | null) => {
      setStore("ui", "selectedSpanId", spanId);
      setStore("ui", "selectedTraceId", null); // Clear trace selection
    },

    selectTrace: (traceId: string | null) => {
      setStore("ui", "selectedTraceId", traceId);
      setStore("ui", "selectedSpanId", null); // Clear span selection
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
        setStore("ui", "selectedMetricName", null);
      });
    },

    selectMetric: (name: string | null) => {
      setStore("ui", "selectedMetricName", name);
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
        setStore("ui", "selectedClientIndex", index);
        setStore("activeClient", Option.some(client));
        log(`selectClientByIndex: Selected client ${index}: ${client.name}`);
      }
    },

    setFocusedSection: (section: FocusedSection) => {
      setStore("ui", "focusedSection", section);
    },

    toggleHelp: () => {
      setStore("ui", "showHelp", (prev) => !prev);
    },

    toggleClientsExpanded: () => {
      setStore("ui", "clientsExpanded", (prev) => !prev);
    },

    navigateUp: () => {
      if (store.ui.focusedSection === "clients") {
        const clients = store.clients;
        if (clients.length === 0) return;

        const currentIdx = store.ui.selectedClientIndex;
        const newIdx = currentIdx <= 0 ? clients.length - 1 : currentIdx - 1;
        actions.selectClientByIndex(newIdx);
      } else if (store.ui.focusedSection === "spans") {
        const visibleItems = getVisibleItems();
        if (visibleItems.length === 0) return;

        // Find current selection
        const currentSpanId = store.ui.selectedSpanId;

        let currentIdx = -1;
        if (currentSpanId) {
          currentIdx = visibleItems.findIndex(
            (item) => item.span.spanId === currentSpanId,
          );
        }

        const newIdx =
          currentIdx <= 0 ? visibleItems.length - 1 : currentIdx - 1;
        const newItem = visibleItems[newIdx];

        setStore("ui", "selectedSpanId", newItem.span.spanId);
        setStore("ui", "selectedTraceId", null);
      } else if (store.ui.focusedSection === "metrics") {
        const metrics = store.metrics;
        if (metrics.length === 0) return;

        const currentName = store.ui.selectedMetricName;
        const currentIdx = currentName
          ? metrics.findIndex((m) => m.name === currentName)
          : -1;

        const newIdx = currentIdx <= 0 ? metrics.length - 1 : currentIdx - 1;
        setStore("ui", "selectedMetricName", metrics[newIdx].name);
      }
    },

    navigateDown: () => {
      log(
        `navigateDown: ENTRY - store.spans.length=${store.spans.length}, store object id=${typeof store}`,
      );
      if (store.ui.focusedSection === "clients") {
        const clients = store.clients;
        if (clients.length === 0) return;

        const currentIdx = store.ui.selectedClientIndex;
        const newIdx = currentIdx >= clients.length - 1 ? 0 : currentIdx + 1;
        actions.selectClientByIndex(newIdx);
      } else if (store.ui.focusedSection === "spans") {
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
        const currentSpanId = store.ui.selectedSpanId;

        let currentIdx = -1;
        if (currentSpanId) {
          currentIdx = visibleItems.findIndex(
            (item) => item.span.spanId === currentSpanId,
          );
        }

        log(
          `navigateDown: currentSpanId=${currentSpanId?.substring(0, 8)}, currentIdx=${currentIdx}`,
        );

        const newIdx =
          currentIdx >= visibleItems.length - 1 ? 0 : currentIdx + 1;
        const newItem = visibleItems[newIdx];

        setStore("ui", "selectedSpanId", newItem.span.spanId);
        setStore("ui", "selectedTraceId", null);
      } else if (store.ui.focusedSection === "metrics") {
        const metrics = store.metrics;
        if (metrics.length === 0) return;

        const currentName = store.ui.selectedMetricName;
        const currentIdx = currentName
          ? metrics.findIndex((m) => m.name === currentName)
          : -1;

        const newIdx = currentIdx >= metrics.length - 1 ? 0 : currentIdx + 1;
        setStore("ui", "selectedMetricName", metrics[newIdx].name);
      }
    },

    toggleExpand: () => {
      if (store.ui.focusedSection === "spans") {
        // Check if a span is selected
        const selectedSpanId = store.ui.selectedSpanId;
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
