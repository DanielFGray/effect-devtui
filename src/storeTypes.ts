/**
 * Store Types
 *
 * Type definitions for the store, extracted to avoid circular dependencies.
 * This file should have NO imports from local modules (only external packages).
 */

import type * as Option from "effect/Option";
import type * as HashSet from "effect/HashSet";
import type * as Domain from "@effect/experimental/DevTools/Domain";
import type { Client } from "./server";

// =============================================================================
// Types
// =============================================================================

export type FocusedSection = "clients" | "spans" | "metrics";
export type ActiveTab = "observability" | "fix";

export interface SimpleSpanEvent {
  name: string;
  startTime: bigint;
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

export interface LayerAnalysisResults {
  missing: string[];
  resolved: Array<{
    service: string;
    layer: string;
    file: string;
    line: number;
    requires: string[];
  }>;
  candidates?: Array<{
    service: string;
    layers: Array<{
      name: string;
      file: string;
      line: number;
      requires: string[];
    }>;
  }>;
  /** All layer definitions found in the project (for resolving transitive deps) */
  allLayers?: Array<{
    name: string;
    provides: string | null;
    file: string;
    line: number;
    requires: string[];
  }>;
  generatedCode: string;
  targetFile?: string | null;
  targetLine?: number | null;
  stillMissing?: string[];
  resolutionOrder?: string[];
  message?: string;
}

export interface UIState {
  activeTab: ActiveTab;
  focusedSection: FocusedSection;
  showHelp: boolean;
  showCommandPalette: boolean;
  commandPaletteQuery: string;
  selectedCommandIndex: number;
  selectedSpanId: string | null;
  selectedTraceId: string | null;
  selectedMetricName: string | null;
  selectedClientIndex: number;
  expandedSpanIds: Set<string>;
  expandedTraceIds: Set<string>;
  clientsExpanded: boolean;
  spansHeight: number;
  metricsHeight: number;
  spanFilterQuery: string;
  showSpanFilter: boolean;

  // Layer Analysis
  fixTabFocusedPanel: "services" | "candidates";
  selectedLayerRequirementIndex: number;
  selectedServiceForCandidates: string | null;
  selectedLayerCandidateIndex: number;
  layerSelections: Map<string, string>;
  layerAnalysisStatus: "idle" | "analyzing" | "complete" | "error" | "applied";
  layerAnalysisResults: LayerAnalysisResults | null;
  layerAnalysisError: string | null;
  layerAnalysisLogs: string[];
}

export interface StoreState {
  spans: SimpleSpan[];
  metrics: SimpleMetric[];
  clients: Client[];
  activeClient: Option.Option<Client>;
  serverStatus: "starting" | "listening" | "connected";
  ui: UIState;
  debugCounter: number;
}

export interface StoreActions {
  // Span actions
  addSpan: (span: Domain.Span) => void;
  updateSpan: (span: Domain.Span) => void;
  addSpanEvent: (event: Domain.SpanEvent) => void;
  clearSpans: () => void;
  selectSpan: (spanId: string | null) => void;
  selectTrace: (traceId: string | null) => void;
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
  goToFirstSpan: () => void;
  goToLastSpan: () => void;
  toggleExpand: () => void;
  setSpansHeight: (height: number) => void;
  setMetricsHeight: (height: number) => void;
  setSpanFilterQuery: (query: string) => void;
  toggleSpanFilter: () => void;
  clearSpanFilter: () => void;

  // Tab navigation actions
  setActiveTab: (tab: ActiveTab) => void;
  toggleFixTabFocus: () => void;
  navigateLayerRequirements: (direction: "up" | "down") => void;
  selectServiceForCandidates: (service: string | null) => void;
  navigateLayerCandidates: (direction: "up" | "down") => void;
  selectLayerForService: (service: string, layerName: string) => void;
  clearLayerAnalysis: () => void;

  // Layer Analysis actions
  startLayerAnalysis: () => void;
  setLayerAnalysisStatus: (
    status: "idle" | "analyzing" | "complete" | "error" | "applied",
  ) => void;
  setLayerAnalysisResults: (results: LayerAnalysisResults | null) => void;
  setLayerAnalysisError: (error: string | null) => void;
  closeLayerAnalyzer: () => void;
  addAnalysisLog: (log: string) => void;
  getLayerAnalysisResults: () => LayerAnalysisResults | null;
  getLayerSelections: () => Map<string, string>;
}

export interface StoreContext {
  store: StoreState;
  actions: StoreActions;
}
