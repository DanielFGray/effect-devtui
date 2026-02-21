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
export type SpanViewMode = "tree" | "waterfall";

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

/** Common layer info type used across the store */
export interface LayerInfo {
  name: string;
  file: string;
  line: number;
  requires: string[];
  composedOf?: string[];
  compositionType?: "mergeAll" | "merge" | "provide" | "provideMerge" | "none";
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
    layers: Array<LayerInfo>;
  }>;
  /** All layer definitions found in the project (for resolving transitive deps) */
  allLayers?: Array<
    LayerInfo & {
      provides: string | null;
    }
  >;
  generatedCode: string;
  targetFile?: string | null;
  targetLine?: number | null;
  stillMissing?: string[];
  resolutionOrder?: string[];
  message?: string;
}

/** Progress steps for layer analysis */
export type AnalysisProgressStep =
  | "finding_tsconfig"
  | "getting_diagnostics"
  | "finding_requirements"
  | "finding_layers"
  | "building_index"
  | "resolving_deps"
  | "generating_code";

/** Labels for each progress step */
export const ANALYSIS_STEP_LABELS: Record<AnalysisProgressStep, string> = {
  finding_tsconfig: "Searching for tsconfig.json",
  getting_diagnostics: "Getting diagnostics",
  finding_requirements: "Finding missing requirements",
  finding_layers: "Finding layer definitions",
  building_index: "Building layer index",
  resolving_deps: "Resolving dependencies",
  generating_code: "Generating code suggestions",
};

/** Ordered list of analysis steps */
export const ANALYSIS_STEPS: AnalysisProgressStep[] = [
  "finding_tsconfig",
  "getting_diagnostics",
  "finding_requirements",
  "finding_layers",
  "building_index",
  "resolving_deps",
  "generating_code",
];

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
  spanViewMode: SpanViewMode;

  // Layer Analysis
  fixTabFocusedPanel: "graph" | "services" | "candidates";
  selectedLayerRequirementIndex: number;
  selectedServiceForCandidates: string | null;
  selectedLayerCandidateIndex: number;
  layerSelections: Map<string, string>;
  layerAnalysisStatus: "idle" | "analyzing" | "complete" | "error";
  layerAnalysisProgress: AnalysisProgressStep | null;
  layerAnalysisResults: LayerAnalysisResults | null;
  layerAnalysisError: string | null;
  layerAnalysisLogs: string[];

  // Dependency Graph
  showDependencyGraph: boolean;
}

export interface StoreState {
  serverSpans: SimpleSpan[];
  serverMetrics: SimpleMetric[];
  spans: SimpleSpan[];
  metrics: SimpleMetric[];
  spansByClient: Record<number, SimpleSpan[]>;
  metricsByClient: Record<number, SimpleMetric[]>;
  clients: Client[];
  activeClient: Option.Option<Client>;
  serverStatus: "starting" | "listening" | "connected";
  ui: UIState;
  debugCounter: number;
}

export interface StoreActions {
  // Span actions
  addSpan: (span: Domain.Span, clientId?: number) => void;
  updateSpan: (span: Domain.Span, clientId?: number) => void;
  addSpanEvent: (event: Domain.SpanEvent, clientId?: number) => void;
  clearSpans: () => void;
  selectSpan: (spanId: string | null) => void;
  selectTrace: (traceId: string | null) => void;
  toggleSpanExpanded: (spanId: string) => void;
  toggleTraceExpanded: (traceId: string) => void;

  // Metric actions
  updateMetrics: (snapshot: Domain.MetricsSnapshot, clientId?: number) => void;
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
  cycleSpanViewMode: () => void;

  // Tab navigation actions
  setActiveTab: (tab: ActiveTab) => void;
  toggleFixTabFocus: () => void;
  setFixTabFocus: (panel: "graph" | "services" | "candidates") => void;
  navigateLayerRequirements: (direction: "up" | "down") => void;
  selectServiceForCandidates: (service: string | null) => void;
  navigateLayerCandidates: (direction: "up" | "down") => void;
  selectLayerForService: (service: string, layerName: string) => void;
  clearLayerAnalysis: () => void;

  // Layer Analysis actions
  startLayerAnalysis: () => void;
  cancelLayerAnalysis: () => void;
  setLayerAnalysisStatus: (
    status: "idle" | "analyzing" | "complete" | "error",
  ) => void;
  setLayerAnalysisProgress: (step: AnalysisProgressStep | null) => void;
  setLayerAnalysisResults: (results: LayerAnalysisResults | null) => void;
  setLayerAnalysisError: (error: string | null) => void;
  closeLayerAnalyzer: () => void;
  addAnalysisLog: (log: string) => void;
  getLayerAnalysisResults: () => LayerAnalysisResults | null;
  getLayerSelections: () => Map<string, string>;

  // Dependency Graph actions
  toggleDependencyGraph: () => void;
}

export interface StoreContext {
  store: StoreState;
  actions: StoreActions;
}
