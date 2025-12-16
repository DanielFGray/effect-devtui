/**
 * Dependency Graph View Component
 *
 * Displays the Effect Layer dependency graph using ASCII art with dagre layout.
 */

import { createMemo, For, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { theme } from "./theme";
import { useStore } from "./store";
import type { LayerDefinition } from "./layerResolverCore";
import {
  layoutGraph,
  renderToAscii,
  detectCycles,
  findOrphans,
} from "./dependencyGraph";

interface DependencyGraphViewProps {
  layers: LayerDefinition[];
  selectedNode?: string;
  onSelectNode?: (name: string) => void;
  focused?: boolean;
  maxWidth?: number;
}

/**
 * Header with graph statistics
 */
function GraphHeader(props: {
  layerCount: number;
  cycleCount: number;
  orphanCount: number;
  focused?: boolean;
}) {
  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row" gap={2}>
        <text style={{ fg: props.focused ? theme.primary : theme.muted }}>
          {props.focused ? "> " : "  "}Dependency Graph ({props.layerCount}{" "}
          layers)
        </text>
      </box>

      <box flexDirection="row" gap={3} marginTop={1}>
        <Show when={props.cycleCount > 0}>
          <text style={{ fg: theme.error }}>
            * {props.cycleCount} circular dep{props.cycleCount > 1 ? "s" : ""}
          </text>
        </Show>
        <Show when={props.orphanCount > 0}>
          <text style={{ fg: theme.warning }}>
            ? {props.orphanCount} orphan{props.orphanCount > 1 ? "s" : ""}
          </text>
        </Show>
        <Show when={props.cycleCount === 0 && props.orphanCount === 0}>
          <text style={{ fg: theme.success }}>No issues detected</text>
        </Show>
      </box>
    </box>
  );
}

/**
 * Legend explaining the symbols
 */
function GraphLegend() {
  return (
    <box flexDirection="row" gap={3} marginBottom={1}>
      <text style={{ fg: theme.muted }}>Legend:</text>
      <text style={{ fg: theme.error }}>* Cycle</text>
      <text style={{ fg: theme.warning }}>? Orphan</text>
      <text style={{ fg: theme.text }}>--- Provides</text>
    </box>
  );
}

/**
 * Renders a single line of the graph with proper coloring
 */
function GraphLine(props: {
  line: string;
  cycles: Set<string>;
  orphans: Set<string>;
}) {
  // Check if this line contains any special markers
  const hasCycleMarker = props.line.includes("[cycle]");
  const hasOrphanMarker = props.line.includes("[orphan]");
  const hasAsterisk = props.line.startsWith("*") || props.line.includes(" *");

  const color =
    hasCycleMarker || hasAsterisk
      ? theme.error
      : hasOrphanMarker
        ? theme.warning
        : theme.text;

  return <text style={{ fg: color }}>{props.line}</text>;
}

/**
 * Main Dependency Graph View component
 */
export function DependencyGraphView(props: DependencyGraphViewProps) {
  // Analyze the graph
  const cycles = createMemo(() => detectCycles(props.layers));
  const orphans = createMemo(() => findOrphans(props.layers));
  const cycleNodes = createMemo(() => new Set(cycles().flat()));
  const orphanNodes = createMemo(() => new Set(orphans()));

  // Generate the graph visualization
  const graphLines = createMemo(() => {
    if (props.layers.length === 0) {
      return ["No layers found. Run analysis first."];
    }

    const layout = layoutGraph(props.layers);
    if (!layout) {
      return ["Failed to layout graph"];
    }
    // Use provided maxWidth or default to 72 for narrow terminals
    const width = props.maxWidth ?? 72;
    return renderToAscii(layout, {
      selectedNode: props.selectedNode,
      maxWidth: width,
    });
  });

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      paddingLeft={2}
      paddingRight={2}
    >
      <GraphHeader
        layerCount={props.layers.length}
        cycleCount={cycles().length}
        orphanCount={orphans().length}
        focused={props.focused}
      />

      <GraphLegend />

      <scrollbox flexGrow={1} focused={props.focused ?? false}>
        <For each={graphLines()}>
          {(line) => (
            <GraphLine
              line={line}
              cycles={cycleNodes()}
              orphans={orphanNodes()}
            />
          )}
        </For>
      </scrollbox>
    </box>
  );
}

/**
 * Standalone graph panel that can be used in dialogs or overlays
 */
export function DependencyGraphPanel() {
  const { store } = useStore();
  const dimensions = useTerminalDimensions();

  const isFocused = createMemo(() => store.ui.fixTabFocusedPanel === "graph");

  // Calculate dynamic max width based on terminal size
  // In wide mode (>120), graph takes 60% of width
  // In narrow mode, use full width minus padding
  const graphMaxWidth = createMemo(() => {
    const termWidth = dimensions().width;
    if (termWidth > 120) {
      // Wide mode: graph is 60% of terminal, minus padding (4 chars)
      return Math.floor(termWidth * 0.6) - 4;
    }
    // Narrow mode: full width minus padding
    return termWidth - 4;
  });

  const layers = createMemo((): LayerDefinition[] => {
    // Get layers from analysis results if available
    const results = store.ui.layerAnalysisResults;
    if (!results) return [];

    // Prefer allLayers if available (has full LayerDefinition structure)
    if (results.allLayers && results.allLayers.length > 0) {
      return results.allLayers as LayerDefinition[];
    }

    // Fallback: build from candidates (need to add provides field)
    if (results.candidates) {
      const allLayers: LayerDefinition[] = [];
      for (const candidate of results.candidates) {
        for (const layer of candidate.layers) {
          // Avoid duplicates
          if (!allLayers.find((l) => l.name === layer.name)) {
            allLayers.push({
              ...layer,
              provides: candidate.service, // The service this candidate provides
              composedOf: layer.composedOf ?? [],
              compositionType: layer.compositionType ?? "none",
            });
          }
        }
      }
      return allLayers;
    }

    return [];
  });

  return (
    <Show
      when={layers().length > 0}
      fallback={
        <box
          flexDirection="column"
          width="100%"
          height="100%"
          paddingLeft={2}
          paddingTop={2}
        >
          <text style={{ fg: theme.text }} marginBottom={2}>
            No layer data available
          </text>
          <text style={{ fg: theme.muted }}>
            Run analysis first with [a] to discover layers
          </text>
        </box>
      }
    >
      <DependencyGraphView
        layers={layers()}
        focused={isFocused()}
        maxWidth={graphMaxWidth()}
      />
    </Show>
  );
}
