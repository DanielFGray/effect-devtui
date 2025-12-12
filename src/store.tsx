/**
 * Store for Effect DevTools TUI
 *
 * Uses Solid.js createStore for reactive state management.
 * The store is created inside a context provider to ensure
 * it's initialized within Solid's reactivity context.
 */

import * as Option from "effect/Option";
import * as HashSet from "effect/HashSet";
import { createStore, produce } from "solid-js/store";
import {
  batch,
  createContext,
  useContext,
  onMount,
  type ParentProps,
} from "solid-js";
import type * as Domain from "@effect/experimental/DevTools/Domain";
import type { Client } from "./server";
import { getCommands, filterCommands } from "./commands";

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
  showCommandPalette: boolean;
  commandPaletteQuery: string;
  selectedCommandIndex: number;
  selectedSpanId: string | null;
  selectedTraceId: string | null; // For selecting trace groups
  selectedMetricName: string | null;
  selectedClientIndex: number; // Index into clients array
  expandedSpanIds: Set<string>;
  expandedTraceIds: Set<string>; // For trace grouping
  clientsExpanded: boolean; // For client dropdown
  spansHeight: number; // Height of the spans section (for resizing)
  metricsHeight: number; // Height of the metrics section
  spanFilterQuery: string; // Filter query for spans
  showSpanFilter: boolean; // Whether span filter input is visible
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
  toggleCommandPalette: () => void;
  setCommandPaletteQuery: (query: string) => void;
  navigateCommandUp: () => void;
  navigateCommandDown: () => void;
  executeSelectedCommand: () => void;
  executeCommand: (commandId: string) => void;
  expandAllSpans: () => void;
  collapseAllSpans: () => void;
  toggleClientsExpanded: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
  navigateLeft: () => void;
  navigateRight: () => void;
  toggleExpand: () => void;
  setSpansHeight: (height: number) => void;
  setMetricsHeight: (height: number) => void;
  setSpanFilterQuery: (query: string) => void;
  toggleSpanFilter: () => void;
  clearSpanFilter: () => void;
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
  console.log(
    `[Store] StoreProvider: Initializing new store instance at ${new Date().toISOString()}`,
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
      showCommandPalette: false,
      commandPaletteQuery: "",
      selectedCommandIndex: 0,
      selectedSpanId: null,
      selectedTraceId: null,
      selectedMetricName: null,
      selectedClientIndex: 0,
      expandedSpanIds: new Set(),
      expandedTraceIds: new Set(),
      clientsExpanded: false,
      spansHeight: 35, // Default height for spans section
      metricsHeight: 6,
      spanFilterQuery: "",
      showSpanFilter: false,
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
          }
        }

        const allSpans = [...currentSpans, ...newSpans];

        // No automatic pruning - let spans accumulate
        // Users can press 'c' to clear spans manually when needed
        setStore("spans", allSpans);
      }
    }
  };

  // Flush spans periodically
  setInterval(flushSpans, 100);

  // Helper types for navigation
  type NavigableItem = { type: "span"; span: SimpleSpan };

  // Helper to get visible spans for navigation (simplified - no trace grouping)
  const getVisibleItems = (expandedIds: Set<string>): NavigableItem[] => {
    const result: NavigableItem[] = [];
    const spanMap = new Map(store.spans.map((s) => [s.spanId, s]));
    const visited = new Set<string>();

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
      // Prevent visiting the same span twice
      if (visited.has(span.spanId)) {
        console.log(
          `[Store] getVisibleItems: Skipping duplicate visit to ${span.name} (${span.spanId.substring(0, 8)})`,
        );
        return;
      }
      visited.add(span.spanId);

      result.push({ type: "span", span });

      if (expandedIds.has(span.spanId)) {
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

    return result;
  };

  const actions: StoreActions = {
    addSpan: (span: Domain.Span) => {
      const simple = simplifySpan(span);
      // Check if span already exists
      const existing = store.spans.find((s) => s.spanId === simple.spanId);
      console.log(
        `[Store] addSpan: ${simple.name}, store has ${store.spans.length} spans, existing=${!!existing}`,
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
        console.log(
          `[Store] addSpanEvent: Adding event "${simpleEvent.name}" to span ${spanId.substring(0, 8)}`,
        );
        setStore("spans", idx, "events", (events) => [...events, simpleEvent]);
      } else {
        // Span doesn't exist yet, buffer the event
        console.log(
          `[Store] addSpanEvent: Buffering event "${simpleEvent.name}" for span ${spanId.substring(0, 8)}`,
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
      console.log(
        `[Store] toggleSpanExpanded called for span ${spanId.substring(0, 8)}`,
      );
      console.log(
        `[Store] Before: expandedSpanIds.size = ${store.ui.expandedSpanIds.size}, has(${spanId.substring(0, 8)}) = ${store.ui.expandedSpanIds.has(spanId)}`,
      );

      // Create a new Set to trigger Solid.js reactivity
      const newExpandedIds = new Set(store.ui.expandedSpanIds);
      if (newExpandedIds.has(spanId)) {
        newExpandedIds.delete(spanId);
      } else {
        newExpandedIds.add(spanId);
      }
      setStore("ui", "expandedSpanIds", newExpandedIds);

      console.log(
        `[Store] After: expandedSpanIds.size = ${store.ui.expandedSpanIds.size}, has(${spanId.substring(0, 8)}) = ${store.ui.expandedSpanIds.has(spanId)}`,
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
        console.log(
          `[Store] selectClientByIndex: Selected client ${index}: ${client.name}`,
        );
      }
    },

    setFocusedSection: (section: FocusedSection) => {
      setStore("ui", "focusedSection", section);
    },

    toggleHelp: () => {
      setStore("ui", "showHelp", (prev) => !prev);
    },

    toggleCommandPalette: () => {
      batch(() => {
        setStore("ui", "showCommandPalette", (prev) => !prev);
        // Reset query and selection when opening
        if (!store.ui.showCommandPalette) {
          setStore("ui", "commandPaletteQuery", "");
          setStore("ui", "selectedCommandIndex", 0);
        }
      });
    },

    setCommandPaletteQuery: (query: string) => {
      batch(() => {
        setStore("ui", "commandPaletteQuery", query);
        // Reset selection when query changes
        setStore("ui", "selectedCommandIndex", 0);
      });
    },

    executeCommand: (commandId: string) => {
      // Import and execute command
      import("./commands").then(({ getCommands }) => {
        const commands = getCommands(actions);
        const command = commands.find((cmd) => cmd.id === commandId);
        if (command) {
          command.execute();
          // Close palette after execution
          setStore("ui", "showCommandPalette", false);
        }
      });
    },

    navigateCommandUp: () => {
      const allCommands = getCommands(actions);
      const filtered = filterCommands(
        allCommands,
        store.ui.commandPaletteQuery,
      );
      if (filtered.length === 0) return;

      setStore("ui", "selectedCommandIndex", (prev) => {
        if (prev <= 0) return filtered.length - 1;
        return prev - 1;
      });
    },

    navigateCommandDown: () => {
      const allCommands = getCommands(actions);
      const filtered = filterCommands(
        allCommands,
        store.ui.commandPaletteQuery,
      );
      if (filtered.length === 0) return;

      setStore("ui", "selectedCommandIndex", (prev) => {
        if (prev >= filtered.length - 1) return 0;
        return prev + 1;
      });
    },

    executeSelectedCommand: () => {
      const allCommands = getCommands(actions);
      const filtered = filterCommands(
        allCommands,
        store.ui.commandPaletteQuery,
      );
      const selected = filtered[store.ui.selectedCommandIndex];
      if (selected) {
        selected.execute();
        batch(() => {
          setStore("ui", "showCommandPalette", false);
          setStore("ui", "commandPaletteQuery", "");
          setStore("ui", "selectedCommandIndex", 0);
        });
      }
    },

    expandAllSpans: () => {
      const allSpanIds = store.spans.map((s) => s.spanId);
      setStore("ui", "expandedSpanIds", new Set(allSpanIds));
    },

    collapseAllSpans: () => {
      setStore("ui", "expandedSpanIds", new Set());
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
        const visibleItems = getVisibleItems(store.ui.expandedSpanIds);
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
      console.log(
        `[Store] navigateDown: ENTRY - store.spans.length=${store.spans.length}, store object id=${typeof store}`,
      );
      if (store.ui.focusedSection === "clients") {
        const clients = store.clients;
        if (clients.length === 0) return;

        const currentIdx = store.ui.selectedClientIndex;
        const newIdx = currentIdx >= clients.length - 1 ? 0 : currentIdx + 1;
        actions.selectClientByIndex(newIdx);
      } else if (store.ui.focusedSection === "spans") {
        const visibleItems = getVisibleItems(store.ui.expandedSpanIds);
        console.log(
          `[Store] navigateDown: ${visibleItems.length} visible items, expandedIds=${Array.from(
            store.ui.expandedSpanIds,
          )
            .map((id) => id.substring(0, 4))
            .join(",")}`,
        );
        console.log(
          `[Store] navigateDown: visibleItems length=${visibleItems.length}, names=${visibleItems
            .map((item) => item.span.name)
            .slice(0, 10)
            .join(" -> ")}`,
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

        console.log(
          `[Store] navigateDown: currentSpanId=${currentSpanId?.substring(0, 8)}, currentIdx=${currentIdx}`,
        );
        console.log(
          `[Store] navigateDown: visibleItems=${visibleItems.map((item) => item.span.name).join(" -> ")}`,
        );

        const newIdx =
          currentIdx >= visibleItems.length - 1 ? 0 : currentIdx + 1;
        const newItem = visibleItems[newIdx];

        console.log(
          `[Store] navigateDown: newIdx=${newIdx}, newItem=${newItem.span.name}`,
        );

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

    navigateLeft: () => {
      if (store.ui.focusedSection !== "spans") return;

      const selectedSpanId = store.ui.selectedSpanId;
      if (!selectedSpanId) {
        // No selection, just navigate up
        actions.navigateUp();
        return;
      }

      const selectedSpan = store.spans.find((s) => s.spanId === selectedSpanId);
      if (!selectedSpan) {
        actions.navigateUp();
        return;
      }

      // If the span is expanded, collapse it
      if (store.ui.expandedSpanIds.has(selectedSpanId)) {
        actions.toggleSpanExpanded(selectedSpanId);
      } else if (selectedSpan.parent) {
        // If collapsed and has parent, navigate to parent
        const parentSpan = store.spans.find(
          (s) => s.spanId === selectedSpan.parent,
        );
        if (parentSpan) {
          setStore("ui", "selectedSpanId", parentSpan.spanId);
        } else {
          // Parent not found, navigate up instead
          actions.navigateUp();
        }
      } else {
        // No parent and not expanded, navigate up
        actions.navigateUp();
      }
    },

    navigateRight: () => {
      if (store.ui.focusedSection !== "spans") return;

      const selectedSpanId = store.ui.selectedSpanId;
      if (!selectedSpanId) {
        // No selection, just navigate down
        actions.navigateDown();
        return;
      }

      // Check if span has children
      const hasChildren = store.spans.some((s) => s.parent === selectedSpanId);

      if (!hasChildren) {
        // No children, navigate down instead
        actions.navigateDown();
        return;
      }

      // If not expanded, expand it
      if (!store.ui.expandedSpanIds.has(selectedSpanId)) {
        actions.toggleSpanExpanded(selectedSpanId);
      } else {
        // If already expanded, navigate to first child
        const visibleItems = getVisibleItems(store.ui.expandedSpanIds);
        const currentIdx = visibleItems.findIndex(
          (item) => item.span.spanId === selectedSpanId,
        );

        // First child should be the next item in the visible list
        if (currentIdx >= 0 && currentIdx < visibleItems.length - 1) {
          const nextItem = visibleItems[currentIdx + 1];
          // Verify it's actually a child
          if (nextItem.span.parent === selectedSpanId) {
            setStore("ui", "selectedSpanId", nextItem.span.spanId);
          } else {
            // Not a child (shouldn't happen), navigate down instead
            actions.navigateDown();
          }
        } else {
          // No next item, navigate down as fallback
          actions.navigateDown();
        }
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
          console.log(
            `[Store] toggleExpand: toggling span ${selectedSpanId.substring(0, 8)}, has children: ${hadChildren}`,
          );
          actions.toggleSpanExpanded(selectedSpanId);
        }
      }
    },

    setSpansHeight: (height: number) => {
      setStore("ui", "spansHeight", height);
    },

    setMetricsHeight: (height: number) => {
      setStore("ui", "metricsHeight", height);
    },

    setSpanFilterQuery: (query: string) => {
      setStore("ui", "spanFilterQuery", query);
    },

    toggleSpanFilter: () => {
      // Just toggle visibility - don't clear query
      // Query is preserved so user can continue editing when reopening
      setStore("ui", "showSpanFilter", (prev) => !prev);
    },

    clearSpanFilter: () => {
      setStore("ui", "spanFilterQuery", "");
    },
  };

  // Export actions globally so Effect runtime can access them
  globalStoreActions = actions;

  // Start the Effect runtime AFTER the store is initialized
  // Use onMount to ensure it only runs once when the component mounts
  onMount(() => {
    console.log("[Store] StoreProvider: Starting Effect runtime from onMount");
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
