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
import type { Client } from "./server";
import { getCommands, filterCommands } from "./commands";
import {
  startRuntime,
  triggerLayerAnalysis,
  cancelLayerAnalysis,
  clearSpanStoreSource,
} from "./runtime";

// Re-export types from storeTypes
export type {
  FocusedSection,
  ActiveTab,
  SimpleSpanEvent,
  SimpleSpan,
  SimpleMetric,
  LayerAnalysisResults,
  UIState,
  StoreState,
  StoreActions,
  StoreContext,
} from "./storeTypes";

import type {
  FocusedSection,
  ActiveTab,
  SimpleSpan,
  StoreState,
  StoreActions,
  StoreContext,
} from "./storeTypes";

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
    serverSpans: [],
    serverMetrics: [],
    spans: [],
    metrics: [],
    spansByClient: {},
    metricsByClient: {},
    clients: [],
    activeClient: Option.none(),
    serverStatus: "starting",
    ui: {
      // Tab navigation
      activeTab: "observability" as const,
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
      spansHeight: 25, // Legacy - no longer used for layout
      metricsHeight: 12, // Fixed height for metrics section
      spanFilterQuery: "",
      showSpanFilter: false,
      spanViewMode: "tree" as const,

      // Layer Analysis
      fixTabFocusedPanel: "services",
      selectedLayerRequirementIndex: 0,
      selectedServiceForCandidates: null,
      selectedLayerCandidateIndex: 0,
      layerSelections: new Map(),
      layerAnalysisStatus: "idle",
      layerAnalysisProgress: null,
      layerAnalysisResults: null,
      layerAnalysisError: null,
      layerAnalysisLogs: [],

      // Dependency Graph
      showDependencyGraph: true,
    },
    debugCounter: 0,
  });

  // Debug: test if setInterval updates work at all
  setInterval(() => {
    setStore("debugCounter", (c) => c + 1);
  }, 1000);

  // Helper types for navigation
  type NavigableItem =
    | { type: "trace"; traceId: string }
    | { type: "span"; span: SimpleSpan };

  // Helper to get visible items for navigation (with trace grouping)
  const getVisibleItems = (
    expandedSpanIds: Set<string>,
    expandedTraceIds: Set<string>,
  ): NavigableItem[] => {
    const result: NavigableItem[] = [];
    const spans = store.spans;

    // Deduplicate spans
    const deduped = new Map<string, SimpleSpan>();
    for (const span of spans) {
      const existing = deduped.get(span.spanId);
      if (!existing || span.status === "ended") {
        deduped.set(span.spanId, span);
      }
    }
    const uniqueSpans = Array.from(deduped.values());

    // Apply filter if active
    let filteredSpans = uniqueSpans;
    if (store.ui.spanFilterQuery && store.ui.spanFilterQuery.trim()) {
      const lowerQuery = store.ui.spanFilterQuery.toLowerCase();
      filteredSpans = uniqueSpans.filter((span) =>
        span.name.toLowerCase().includes(lowerQuery),
      );
    }

    const spanMap = new Map(filteredSpans.map((s) => [s.spanId, s]));
    const visited = new Set<string>();

    // Group spans by traceId
    const traceGroups = new Map<string, SimpleSpan[]>();
    for (const span of filteredSpans) {
      const group = traceGroups.get(span.traceId) || [];
      group.push(span);
      traceGroups.set(span.traceId, group);
    }

    // Build children map for span DFS
    const childrenMap = new Map<string, SimpleSpan[]>();
    for (const span of filteredSpans) {
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

    // DFS to collect visible spans within a trace
    const visitSpan = (span: SimpleSpan) => {
      if (visited.has(span.spanId)) return;
      visited.add(span.spanId);

      result.push({ type: "span", span });

      if (expandedSpanIds.has(span.spanId)) {
        const children = childrenMap.get(span.spanId) || [];
        for (const child of children) {
          visitSpan(child);
        }
      }
    };

    // Sort trace groups by earliest span start time
    const traceEntries = Array.from(traceGroups.entries());
    traceEntries.sort((a, b) => {
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

    // Emit trace headers + their spans
    for (const [traceId, traceSpans] of traceEntries) {
      result.push({ type: "trace", traceId });

      if (expandedTraceIds.has(traceId)) {
        // Get root spans within this trace
        const rootSpans = traceSpans.filter(
          (s) => s.parent === null || !spanMap.has(s.parent),
        );
        rootSpans.sort((a, b) => {
          if (a.startTime < b.startTime) return -1;
          if (a.startTime > b.startTime) return 1;
          return 0;
        });

        for (const root of rootSpans) {
          visitSpan(root);
        }
      }
    }

    return result;
  };

  const actions: StoreActions = {
    clearSpans: () => {
      // Determine the active source and clear it from SpanStore so the
      // backing data doesn't reappear on the next bridge sync event.
      const source = Option.match(store.activeClient, {
        onNone: () => "server" as const,
        onSome: (client) => client.id,
      });
      clearSpanStoreSource(source);

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
      // Create a new Set to trigger Solid.js reactivity
      const newExpandedIds = new Set(store.ui.expandedTraceIds);
      if (newExpandedIds.has(traceId)) {
        newExpandedIds.delete(traceId);
      } else {
        newExpandedIds.add(traceId);
      }
      setStore("ui", "expandedTraceIds", newExpandedIds);
    },

    clearMetrics: () => {
      // Determine the active source and clear its metrics from SpanStore so
      // they don't reappear on the next bridge sync event.
      const source = Option.match(store.activeClient, {
        onNone: () => "server" as const,
        onSome: (client) => client.id,
      });
      clearSpanStoreSource(source);

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
        const nextClients = Array.from(newClients);
        setStore("clients", nextClients);

        const nextIds = new Set(nextClients.map((client) => client.id));

        setStore(
          "spansByClient",
          produce((draft) => {
            for (const clientIdStr of Object.keys(draft)) {
              if (!nextIds.has(Number(clientIdStr))) {
                delete draft[Number(clientIdStr)];
              }
            }
          }),
        );

        setStore(
          "metricsByClient",
          produce((draft) => {
            for (const clientIdStr of Object.keys(draft)) {
              if (!nextIds.has(Number(clientIdStr))) {
                delete draft[Number(clientIdStr)];
              }
            }
          }),
        );
      });
    },

    setActiveClient: (client: Option.Option<Client>) => {
      batch(() => {
        setStore("activeClient", client);
        if (client._tag === "Some") {
          setStore("spans", store.spansByClient[client.value.id] ?? []);
          setStore("metrics", store.metricsByClient[client.value.id] ?? []);
        } else {
          setStore("spans", store.serverSpans);
          setStore("metrics", store.serverMetrics);
        }
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
        setStore("spans", store.spansByClient[client.id] ?? []);
        setStore("metrics", store.metricsByClient[client.id] ?? []);
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
      // Execute command
      const commands = getCommands(actions);
      const command = commands.find((cmd) => cmd.id === commandId);
      if (command) {
        command.execute();
        // Close palette after execution
        setStore("ui", "showCommandPalette", false);
      }
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
        const visibleItems = getVisibleItems(
          store.ui.expandedSpanIds,
          store.ui.expandedTraceIds,
        );
        if (visibleItems.length === 0) return;

        // Find current selection (could be a trace or a span)
        const currentSpanId = store.ui.selectedSpanId;
        const currentTraceId = store.ui.selectedTraceId;

        let currentIdx = -1;
        if (currentTraceId) {
          currentIdx = visibleItems.findIndex(
            (item) =>
              item.type === "trace" && item.traceId === currentTraceId,
          );
        } else if (currentSpanId) {
          currentIdx = visibleItems.findIndex(
            (item) =>
              item.type === "span" && item.span.spanId === currentSpanId,
          );
        }

        const newIdx =
          currentIdx <= 0 ? visibleItems.length - 1 : currentIdx - 1;
        const newItem = visibleItems[newIdx];

        batch(() => {
          if (newItem.type === "trace") {
            setStore("ui", "selectedTraceId", newItem.traceId);
            setStore("ui", "selectedSpanId", null);
          } else {
            setStore("ui", "selectedSpanId", newItem.span.spanId);
            setStore("ui", "selectedTraceId", null);
          }
        });
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
        `[Store] navigateDown: ENTRY - store.spans.length=${store.spans.length}`,
      );
      if (store.ui.focusedSection === "clients") {
        const clients = store.clients;
        if (clients.length === 0) return;

        const currentIdx = store.ui.selectedClientIndex;
        const newIdx = currentIdx >= clients.length - 1 ? 0 : currentIdx + 1;
        actions.selectClientByIndex(newIdx);
      } else if (store.ui.focusedSection === "spans") {
        const visibleItems = getVisibleItems(
          store.ui.expandedSpanIds,
          store.ui.expandedTraceIds,
        );
        if (visibleItems.length === 0) return;

        // Find current selection (could be a trace or a span)
        const currentSpanId = store.ui.selectedSpanId;
        const currentTraceId = store.ui.selectedTraceId;

        let currentIdx = -1;
        if (currentTraceId) {
          currentIdx = visibleItems.findIndex(
            (item) =>
              item.type === "trace" && item.traceId === currentTraceId,
          );
        } else if (currentSpanId) {
          currentIdx = visibleItems.findIndex(
            (item) =>
              item.type === "span" && item.span.spanId === currentSpanId,
          );
        }

        const newIdx =
          currentIdx >= visibleItems.length - 1 ? 0 : currentIdx + 1;
        const newItem = visibleItems[newIdx];

        batch(() => {
          if (newItem.type === "trace") {
            setStore("ui", "selectedTraceId", newItem.traceId);
            setStore("ui", "selectedSpanId", null);
          } else {
            setStore("ui", "selectedSpanId", newItem.span.spanId);
            setStore("ui", "selectedTraceId", null);
          }
        });
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

      const selectedTraceId = store.ui.selectedTraceId;
      const selectedSpanId = store.ui.selectedSpanId;

      // If a trace header is selected
      if (selectedTraceId) {
        // Collapse the trace if it is expanded
        if (store.ui.expandedTraceIds.has(selectedTraceId)) {
          actions.toggleTraceExpanded(selectedTraceId);
        } else {
          // Already collapsed, navigate up
          actions.navigateUp();
        }
        return;
      }

      if (!selectedSpanId) {
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
        // If collapsed and has parent, check if parent is in the visible spans
        const spanMap = new Map(store.spans.map((s) => [s.spanId, s]));
        const parentSpan = spanMap.get(selectedSpan.parent);
        if (parentSpan) {
          // Check if the parent is a root span within the trace and not expanded
          const parentIsRoot =
            parentSpan.parent === null || !spanMap.has(parentSpan.parent);
          if (
            parentIsRoot &&
            !store.ui.expandedSpanIds.has(parentSpan.spanId)
          ) {
            // Navigate to the trace header instead
            batch(() => {
              setStore("ui", "selectedTraceId", selectedSpan.traceId);
              setStore("ui", "selectedSpanId", null);
            });
          } else {
            setStore("ui", "selectedSpanId", parentSpan.spanId);
          }
        } else {
          // Parent not in view, go to trace header
          batch(() => {
            setStore("ui", "selectedTraceId", selectedSpan.traceId);
            setStore("ui", "selectedSpanId", null);
          });
        }
      } else {
        // Root span with no parent - go to trace header
        batch(() => {
          setStore("ui", "selectedTraceId", selectedSpan.traceId);
          setStore("ui", "selectedSpanId", null);
        });
      }
    },

    navigateRight: () => {
      if (store.ui.focusedSection !== "spans") return;

      const selectedTraceId = store.ui.selectedTraceId;
      const selectedSpanId = store.ui.selectedSpanId;

      // If a trace header is selected
      if (selectedTraceId) {
        // Expand the trace if not already expanded
        if (!store.ui.expandedTraceIds.has(selectedTraceId)) {
          actions.toggleTraceExpanded(selectedTraceId);
        } else {
          // Already expanded, navigate to first span in the trace
          const visibleItems = getVisibleItems(
            store.ui.expandedSpanIds,
            store.ui.expandedTraceIds,
          );
          const currentIdx = visibleItems.findIndex(
            (item) =>
              item.type === "trace" && item.traceId === selectedTraceId,
          );
          if (currentIdx >= 0 && currentIdx < visibleItems.length - 1) {
            const nextItem = visibleItems[currentIdx + 1];
            batch(() => {
              if (nextItem.type === "span") {
                setStore("ui", "selectedSpanId", nextItem.span.spanId);
                setStore("ui", "selectedTraceId", null);
              } else {
                // Shouldn't happen (next trace), navigate down
                actions.navigateDown();
              }
            });
          } else {
            actions.navigateDown();
          }
        }
        return;
      }

      if (!selectedSpanId) {
        actions.navigateDown();
        return;
      }

      // Check if span has children
      const hasChildren = store.spans.some((s) => s.parent === selectedSpanId);

      if (!hasChildren) {
        actions.navigateDown();
        return;
      }

      // If not expanded, expand it
      if (!store.ui.expandedSpanIds.has(selectedSpanId)) {
        actions.toggleSpanExpanded(selectedSpanId);
      } else {
        // If already expanded, navigate to first child
        const visibleItems = getVisibleItems(
          store.ui.expandedSpanIds,
          store.ui.expandedTraceIds,
        );
        const currentIdx = visibleItems.findIndex(
          (item) =>
            item.type === "span" && item.span.spanId === selectedSpanId,
        );

        // First child should be the next item in the visible list
        if (currentIdx >= 0 && currentIdx < visibleItems.length - 1) {
          const nextItem = visibleItems[currentIdx + 1];
          if (
            nextItem.type === "span" &&
            nextItem.span.parent === selectedSpanId
          ) {
            setStore("ui", "selectedSpanId", nextItem.span.spanId);
          } else {
            actions.navigateDown();
          }
        } else {
          actions.navigateDown();
        }
      }
    },

    goToFirstSpan: () => {
      if (store.ui.focusedSection !== "spans") return;

      const visibleItems = getVisibleItems(
        store.ui.expandedSpanIds,
        store.ui.expandedTraceIds,
      );
      if (visibleItems.length === 0) return;

      const firstItem = visibleItems[0];
      batch(() => {
        if (firstItem.type === "trace") {
          setStore("ui", "selectedTraceId", firstItem.traceId);
          setStore("ui", "selectedSpanId", null);
        } else {
          setStore("ui", "selectedSpanId", firstItem.span.spanId);
          setStore("ui", "selectedTraceId", null);
        }
      });
    },

    goToLastSpan: () => {
      if (store.ui.focusedSection !== "spans") return;

      const visibleItems = getVisibleItems(
        store.ui.expandedSpanIds,
        store.ui.expandedTraceIds,
      );
      if (visibleItems.length === 0) return;

      const lastItem = visibleItems[visibleItems.length - 1];
      batch(() => {
        if (lastItem.type === "trace") {
          setStore("ui", "selectedTraceId", lastItem.traceId);
          setStore("ui", "selectedSpanId", null);
        } else {
          setStore("ui", "selectedSpanId", lastItem.span.spanId);
          setStore("ui", "selectedTraceId", null);
        }
      });
    },

    toggleExpand: () => {
      if (store.ui.focusedSection === "spans") {
        // Check if a trace header is selected
        const selectedTraceId = store.ui.selectedTraceId;
        if (selectedTraceId) {
          actions.toggleTraceExpanded(selectedTraceId);
          return;
        }

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

    cycleSpanViewMode: () => {
      setStore("ui", "spanViewMode", (prev) =>
        prev === "tree" ? "waterfall" : "tree",
      );
    },

    // Tab navigation actions
    setActiveTab: (tab: ActiveTab) => {
      setStore("ui", "activeTab", tab);
      // Auto-trigger analysis when switching to fix tab with no data
      if (
        tab === "fix" &&
        store.ui.layerAnalysisResults === null &&
        store.ui.layerAnalysisStatus !== "analyzing"
      ) {
        // Trigger analysis after a small delay to let the UI render first
        setTimeout(() => {
          setStore("ui", "layerAnalysisStatus", "analyzing");
          setStore("ui", "layerAnalysisError", null);
          setStore("ui", "layerAnalysisLogs", []);
          triggerLayerAnalysis(process.cwd());
        }, 100);
      }
    },

    toggleFixTabFocus: () => {
      const showGraph = store.ui.showDependencyGraph;
      setStore("ui", "fixTabFocusedPanel", (current) => {
        if (showGraph) {
          // Cycle: graph -> services -> candidates -> graph
          if (current === "graph") return "services";
          if (current === "services") return "candidates";
          return "graph";
        } else {
          // Cycle: services -> candidates -> services
          return current === "services" ? "candidates" : "services";
        }
      });
    },

    setFixTabFocus: (panel: "graph" | "services" | "candidates") => {
      setStore("ui", "fixTabFocusedPanel", panel);
    },

    navigateLayerRequirements: (direction: "up" | "down") => {
      const results = store.ui.layerAnalysisResults;
      const candidates = results?.candidates || [];
      if (!results || candidates.length === 0) return;

      const currentIndex = store.ui.selectedLayerRequirementIndex;
      let newIndex: number;

      if (direction === "up") {
        newIndex = currentIndex <= 0 ? candidates.length - 1 : currentIndex - 1;
      } else {
        newIndex = currentIndex >= candidates.length - 1 ? 0 : currentIndex + 1;
      }

      // Update all related state in a batch
      batch(() => {
        setStore("ui", "selectedLayerRequirementIndex", newIndex);
        if (candidates[newIndex]) {
          setStore(
            "ui",
            "selectedServiceForCandidates",
            candidates[newIndex].service,
          );
          setStore("ui", "selectedLayerCandidateIndex", 0);
        }
      });
    },

    selectServiceForCandidates: (service: string | null) => {
      batch(() => {
        setStore("ui", "selectedServiceForCandidates", service);
        setStore("ui", "selectedLayerCandidateIndex", 0);
      });
    },

    navigateLayerCandidates: (direction: "up" | "down") => {
      const results = store.ui.layerAnalysisResults;
      const selectedService = store.ui.selectedServiceForCandidates;
      if (!results || !results.candidates || !selectedService) {
        return;
      }

      const serviceCandidates = results.candidates.find(
        (c) => c.service === selectedService,
      );
      if (!serviceCandidates || serviceCandidates.layers.length === 0) {
        console.log(
          "[Store] navigateLayerCandidates: no service candidates found",
        );
        return;
      }

      const currentIndex = store.ui.selectedLayerCandidateIndex;
      let newIndex: number;

      if (direction === "up") {
        newIndex =
          currentIndex <= 0
            ? serviceCandidates.layers.length - 1
            : currentIndex - 1;
      } else {
        newIndex =
          currentIndex >= serviceCandidates.layers.length - 1
            ? 0
            : currentIndex + 1;
      }

      setStore("ui", "selectedLayerCandidateIndex", newIndex);
    },

    selectLayerForService: (service: string, layerName: string) => {
      const newSelections = new Map(store.ui.layerSelections);
      newSelections.set(service, layerName);
      setStore("ui", "layerSelections", newSelections);
    },

    clearLayerAnalysis: () => {
      batch(() => {
        setStore("ui", "layerAnalysisStatus", "idle");
        setStore("ui", "layerAnalysisResults", null);
        setStore("ui", "layerAnalysisError", null);
        setStore("ui", "layerAnalysisLogs", []);
        setStore("ui", "selectedLayerRequirementIndex", 0);
        setStore("ui", "selectedServiceForCandidates", null);
        setStore("ui", "selectedLayerCandidateIndex", 0);
        setStore("ui", "layerSelections", new Map());
        setStore("ui", "fixTabFocusedPanel", "services");
      });
    },

    // Layer Analysis actions
    startLayerAnalysis: () => {
      setStore("ui", "activeTab", "fix");
      setStore("ui", "layerAnalysisStatus", "analyzing");
      setStore("ui", "layerAnalysisProgress", null);
      // Keep previous results while re-analyzing so graph can persist
      // Results will be replaced when new analysis completes
      setStore("ui", "layerAnalysisError", null);
      setStore("ui", "layerAnalysisLogs", []);
      setStore("ui", "selectedLayerRequirementIndex", 0);

      // Trigger analysis via runtime (will be implemented in runtime.ts)
      triggerLayerAnalysis(process.cwd());
    },

    cancelLayerAnalysis: () => {
      cancelLayerAnalysis();
      batch(() => {
        setStore("ui", "layerAnalysisStatus", "idle");
        setStore("ui", "layerAnalysisProgress", null);
      });
    },

    setLayerAnalysisStatus: (status) => {
      setStore("ui", "layerAnalysisStatus", status);
    },

    setLayerAnalysisProgress: (step) => {
      setStore("ui", "layerAnalysisProgress", step);
    },

    setLayerAnalysisResults: (results) => {
      batch(() => {
        setStore("ui", "layerAnalysisResults", results);

        // Clear any previous layer selections - user must explicitly choose
        setStore("ui", "layerSelections", new Map());

        // Initialize selectedServiceForCandidates to the first service
        if (results && results.candidates && results.candidates.length > 0) {
          setStore(
            "ui",
            "selectedServiceForCandidates",
            results.candidates[0].service,
          );
        }
      });
    },

    setLayerAnalysisError: (error) => {
      setStore("ui", "layerAnalysisError", error);
    },

    closeLayerAnalyzer: () => {
      setStore("ui", "activeTab", "observability");
    },

    addAnalysisLog: (log) => {
      setStore("ui", "layerAnalysisLogs", (logs) => [...logs, log]);
    },

    getLayerAnalysisResults: () => {
      return store.ui.layerAnalysisResults;
    },
    getLayerSelections: () => {
      return store.ui.layerSelections;
    },

    // Dependency Graph actions
    toggleDependencyGraph: () => {
      const wasShowing = store.ui.showDependencyGraph;
      setStore("ui", "showDependencyGraph", (prev) => !prev);
      // When showing graph, focus it; when hiding, focus services
      if (!wasShowing) {
        setStore("ui", "fixTabFocusedPanel", "graph");
      } else if (store.ui.fixTabFocusedPanel === "graph") {
        setStore("ui", "fixTabFocusedPanel", "services");
      }
    },
  };

  // Start the Effect runtime AFTER the store is initialized
  // Use onMount to ensure it only runs once when the component mounts
  onMount(() => {
    console.log("[Store] StoreProvider: Starting Effect runtime from onMount");
    // Pass actions, store getter, and setStore for SpanStore bridge
    startRuntime(actions, () => store, setStore);
  });

  const ctx: StoreContext = { store, actions };

  return (
    <DevToolsStoreContext.Provider value={ctx}>
      {props.children}
    </DevToolsStoreContext.Provider>
  );
}
