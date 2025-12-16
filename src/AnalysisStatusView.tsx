/**
 * Analysis Status View Component
 *
 * Shows different analysis states: idle, analyzing, complete (no results), error, applied.
 */

import { Show } from "solid-js";
import { useStore } from "./store";

// Colors (Tokyo Night theme)
const COLORS = {
  text: "#c0caf5",
  muted: "#565f89",
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
} as const;

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
        <text style={{ fg: COLORS.text }} marginBottom={2}>
          No analysis performed yet
        </text>
        <text style={{ fg: COLORS.muted }} marginBottom={1}>
          Press [a] to analyze project
        </text>
        <text style={{ fg: COLORS.muted }}>Press [?] for help</text>
      </Show>

      <Show when={store.ui.layerAnalysisStatus === "analyzing"}>
        <text style={{ fg: COLORS.warning }} marginBottom={2}>
          Analyzing project...
        </text>
        <text style={{ fg: COLORS.muted }} marginBottom={1}>
          - Searching for tsconfig.json
        </text>
        <text style={{ fg: COLORS.muted }} marginBottom={1}>
          - Scanning TypeScript diagnostics
        </text>
        <text style={{ fg: COLORS.muted }} marginBottom={1}>
          - Finding layer definitions
        </text>
        <text style={{ fg: COLORS.muted }}>- Resolving dependencies</text>
      </Show>

      <Show
        when={
          store.ui.layerAnalysisStatus === "complete" &&
          store.ui.layerAnalysisResults === null
        }
      >
        <text style={{ fg: COLORS.success }} marginBottom={2}>
          No missing requirements found!
        </text>
        <text style={{ fg: COLORS.text }} marginBottom={2}>
          All Effect layers are properly provided in your project.
        </text>
        <text style={{ fg: COLORS.muted }}>Press [a] to re-analyze</text>
      </Show>

      <Show when={store.ui.layerAnalysisStatus === "error"}>
        <text style={{ fg: COLORS.error }} marginBottom={2}>
          Analysis failed
        </text>
        <text style={{ fg: COLORS.text }} marginBottom={2}>
          {store.ui.layerAnalysisError || "Unknown error occurred"}
        </text>
        <text style={{ fg: COLORS.muted }} marginBottom={1}>
          Press [a] to retry
        </text>
        <text style={{ fg: COLORS.muted }}>Press [?] for help</text>
      </Show>

      <Show when={store.ui.layerAnalysisStatus === "applied"}>
        <text style={{ fg: COLORS.success }} marginBottom={2}>
          Fix applied successfully!
        </text>
        <Show when={store.ui.layerAnalysisResults}>
          <text style={{ fg: COLORS.text }} marginBottom={1}>
            {`Modified: ${store.ui.layerAnalysisResults?.targetFile}:${store.ui.layerAnalysisResults?.targetLine}`}
          </text>
          <text style={{ fg: COLORS.text }} marginBottom={2}>
            Added: Layer composition
          </text>
        </Show>
        <text style={{ fg: COLORS.muted }}>Press [a] to re-analyze</text>
      </Show>
    </box>
  );
}
