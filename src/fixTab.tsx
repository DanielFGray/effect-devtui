/**
 * Fix Tab Component
 *
 * Displays the layer analyzer and code fix UI.
 * Layout: Graph on top (toggleable), service list and candidates below.
 * Note: Status bar is handled by the parent index.tsx component.
 */

import { Show, createMemo } from "solid-js";
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
  const hasResults = createMemo(
    () =>
      store.ui.layerAnalysisStatus === "complete" &&
      store.ui.layerAnalysisResults !== null,
  );

  // Show status view for non-results states
  const showStatusView = createMemo(
    () =>
      store.ui.layerAnalysisStatus === "idle" ||
      store.ui.layerAnalysisStatus === "analyzing" ||
      store.ui.layerAnalysisStatus === "error" ||
      (store.ui.layerAnalysisStatus === "complete" &&
        store.ui.layerAnalysisResults === null) ||
      store.ui.layerAnalysisStatus === "applied",
  );

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor="#1a1b26"
    >
      {/* Status view for non-results states */}
      <Show when={showStatusView()}>
        <AnalysisStatusView />
      </Show>

      {/* Results view: graph + service panels */}
      <Show when={hasResults()}>
        <box flexGrow={1} flexDirection="column" width="100%">
          {/* Graph view (toggleable) */}
          <Show when={showGraph()}>
            <box
              flexDirection="column"
              height="60%"
              width="100%"
              border={["bottom"]}
              borderColor="#30363D"
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
