/**
 * Fix Tab Component
 *
 * Displays the layer analyzer and code fix UI.
 * Layout: Graph on top (toggleable), service list and candidates below.
 * Note: Status bar is handled by the parent index.tsx component.
 */

import { Show, createMemo } from "solid-js";
import { theme } from "./theme";
import { useStore } from "./store";
import { AnalysisStatusView } from "./AnalysisStatusView";
import { ServicesListPanel } from "./ServicesListPanel";
import { LayerCandidatesPanel } from "./LayerCandidatesPanel";
import { DependencyGraphPanel } from "./DependencyGraphView";

/**
 * Main Fix Tab component
 *
 * Layout when results available:
 * - Top: Graph view (toggleable with 'g')
 * - Bottom: Services list (left) | Layer candidates (right)
 */
export function FixTab() {
  const { store } = useStore();

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

          {/* Service list and candidates - always visible when results available */}
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
        </box>
      </Show>
    </box>
  );
}
