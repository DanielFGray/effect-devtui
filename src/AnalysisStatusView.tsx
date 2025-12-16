/**
 * Analysis Status View Component
 *
 * Shows different analysis states: idle, analyzing, complete (no results), error.
 * During analysis, shows progress steps with muted colors for pending steps
 * and unmuted colors for completed steps.
 */

import { Show } from "solid-js";
import { theme } from "./theme";
import { useStore } from "./store";
import { AnalysisProgressList } from "./AnalysisProgressList";

export function AnalysisStatusView() {
  const { store } = useStore();

  return (
    <box flexDirection="column" width="100%" paddingLeft={2} paddingTop={2}>
      <Show
        when={
          store.ui.layerAnalysisStatus === "idle" &&
          store.ui.layerAnalysisResults === null
        }
      >
        <text style={{ fg: theme.text }} marginBottom={2}>
          No analysis performed yet
        </text>
        <text style={{ fg: theme.muted }} marginBottom={1}>
          Press [a] to analyze project
        </text>
        <text style={{ fg: theme.muted }}>Press [?] for help</text>
      </Show>

      <Show when={store.ui.layerAnalysisStatus === "analyzing"}>
        <text style={{ fg: theme.warning }} marginBottom={2}>
          Analyzing project...
        </text>
        <text style={{ fg: theme.muted }} marginBottom={2}>
          Press [Esc] to cancel
        </text>

        {/* Progress steps with reactive coloring */}
        <AnalysisProgressList />
      </Show>

      <Show
        when={
          store.ui.layerAnalysisStatus === "complete" &&
          store.ui.layerAnalysisResults === null
        }
      >
        <text style={{ fg: theme.success }} marginBottom={2}>
          No missing requirements found!
        </text>
        <text style={{ fg: theme.text }} marginBottom={2}>
          All Effect layers are properly provided in your project.
        </text>
        <text style={{ fg: theme.muted }}>Press [a] to re-analyze</text>
      </Show>

      <Show when={store.ui.layerAnalysisStatus === "error"}>
        <text style={{ fg: theme.error }} marginBottom={2}>
          Analysis failed
        </text>
        <text style={{ fg: theme.text }} marginBottom={2}>
          {store.ui.layerAnalysisError || "Unknown error occurred"}
        </text>
        <text style={{ fg: theme.muted }} marginBottom={1}>
          Press [a] to retry
        </text>
        <text style={{ fg: theme.muted }}>Press [?] for help</text>
      </Show>
    </box>
  );
}
