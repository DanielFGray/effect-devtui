/**
 * Fix Tab Component
 *
 * Displays the layer analyzer and code fix UI.
 * Shows different states: initial, analyzing, success, results, error, and applied.
 * Note: Status bar is handled by the parent index.tsx component.
 */

import { Show, createMemo } from "solid-js";
import { useStore } from "./store";
import { AnalysisStatusView } from "./AnalysisStatusView";
import { ServicesListPanel } from "./ServicesListPanel";
import { LayerCandidatesPanel } from "./LayerCandidatesPanel";

/**
 * Main Fix Tab component
 */
export function FixTab() {
  const { store } = useStore();

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

      {/* Results view: service panels */}
      <Show when={hasResults()}>
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
  );
}
