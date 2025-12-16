/**
 * Fix Tab Component
 *
 * Displays the layer analyzer and code fix UI.
 * Responsive layout:
 * - Wide (>120 cols): Graph on left, services/candidates stacked on right
 * - Narrow (<=120 cols): Graph on top, services/candidates side-by-side below
 * Note: Status bar is handled by the parent index.tsx component.
 */

import { Show, createMemo } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { theme } from "./theme";
import { useStore } from "./store";
import { AnalysisStatusView } from "./AnalysisStatusView";
import { AnalysisProgressList } from "./AnalysisProgressList";
import { ServicesListPanel } from "./ServicesListPanel";
import { LayerCandidatesPanel } from "./LayerCandidatesPanel";
import { DependencyGraphPanel } from "./DependencyGraphView";

/**
 * Main Fix Tab component
 *
 * Responsive layout when results available:
 * - Wide (>120 cols): Graph on left (60%), services/candidates stacked on right (40%)
 * - Narrow (<=120 cols): Graph on top (60% height), services/candidates side-by-side below
 */
export function FixTab() {
  const { store } = useStore();
  const dimensions = useTerminalDimensions();

  // Responsive breakpoint - matches OpenCode's pattern
  const isWide = createMemo(() => dimensions().width > 120);

  const showGraph = createMemo(() => store.ui.showDependencyGraph);
  const hasPreviousResults = createMemo(
    () => store.ui.layerAnalysisResults !== null,
  );

  // Show status view only when we have NO previous results to display
  // (first-time analysis, idle state, or error without cached results)
  const showStatusView = createMemo(
    () =>
      !hasPreviousResults() &&
      (store.ui.layerAnalysisStatus === "idle" ||
        store.ui.layerAnalysisStatus === "analyzing" ||
        store.ui.layerAnalysisStatus === "error"),
  );

  // Show results view when we have results (even if re-analyzing)
  const showResultsView = createMemo(() => hasPreviousResults());

  // Show re-analyzing indicator when we have results AND are analyzing
  const isReAnalyzing = createMemo(
    () => hasPreviousResults() && store.ui.layerAnalysisStatus === "analyzing",
  );

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.bg}
    >
      {/* Status view for non-results states */}
      <Show when={showStatusView()}>
        <AnalysisStatusView />
      </Show>

      {/* Results view: graph + service panels */}
      <Show when={showResultsView()}>
        <box flexGrow={1} flexDirection="column" width="100%">
          {/* Re-analyzing indicator - shown at top when re-analyzing */}
          <Show when={isReAnalyzing()}>
            <box
              flexDirection="row"
              width="100%"
              paddingLeft={2}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={theme.bgAlt}
              border={["bottom"]}
              borderColor={theme.bgSelected}
            >
              <AnalysisProgressList compact />
              <text style={{ fg: theme.muted }} marginLeft={2}>
                [Esc] Cancel
              </text>
            </box>
          </Show>

          {/* Wide layout: horizontal split (graph left, panels right) */}
          <Show when={isWide()}>
            <box flexDirection="row" flexGrow={1} width="100%">
              {/* Graph on the left - 60% width */}
              <Show when={showGraph()}>
                <box
                  flexDirection="column"
                  width="60%"
                  height="100%"
                  border={["right"]}
                  borderColor={theme.bgSelected}
                >
                  <DependencyGraphPanel />
                </box>
              </Show>

              {/* Services and candidates stacked on the right */}
              <box
                flexDirection="column"
                flexGrow={1}
                height="100%"
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
              >
                <box
                  flexDirection="column"
                  height="50%"
                  border={["bottom"]}
                  borderColor={theme.border}
                >
                  <ServicesListPanel />
                </box>
                <box flexDirection="column" flexGrow={1} paddingTop={1}>
                  <LayerCandidatesPanel showLeftBorder={false} />
                </box>
              </box>
            </box>
          </Show>

          {/* Narrow layout: vertical split (graph top, panels bottom) */}
          <Show when={!isWide()}>
            {/* Graph view (toggleable) */}
            <Show when={showGraph()}>
              <box
                flexDirection="column"
                height="60%"
                width="100%"
                border={["bottom"]}
                borderColor={theme.bgSelected}
              >
                <DependencyGraphPanel />
              </box>
            </Show>

            {/* Service list and candidates side-by-side */}
            <box
              flexDirection="row"
              flexGrow={1}
              width="100%"
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
            >
              <ServicesListPanel />
              <LayerCandidatesPanel />
            </box>
          </Show>
        </box>
      </Show>
    </box>
  );
}
