/**
 * Fix Tab Component
 *
 * Displays the layer analyzer and code fix UI.
 * Shows different states: initial, analyzing, success, results, error, and applied.
 * Note: Status bar is handled by the parent index.tsx component.
 */

import { Show, For, createMemo } from "solid-js";
import { useStore } from "./store";

/**
 * Status view component - shows different states
 */
function AnalysisStatusView() {
  const { store } = useStore();

  return (
    <box flexDirection="column" width="100%" paddingLeft={2} paddingTop={2}>
      <Show
        when={
          store.ui.layerAnalysisStatus === "idle" &&
          store.ui.layerAnalysisResults === null
        }
      >
        <text style={{ fg: "#c0caf5" }} marginBottom={2}>
          No analysis performed yet
        </text>
        <text style={{ fg: "#565f89" }} marginBottom={1}>
          Press [a] to analyze project
        </text>
        <text style={{ fg: "#565f89" }}>Press [?] for help</text>
      </Show>

      <Show when={store.ui.layerAnalysisStatus === "analyzing"}>
        <text style={{ fg: "#e0af68" }} marginBottom={2}>
          ⏳ Analyzing project...
        </text>
        <text style={{ fg: "#565f89" }} marginBottom={1}>
          • Searching for tsconfig.json
        </text>
        <text style={{ fg: "#565f89" }} marginBottom={1}>
          • Scanning TypeScript diagnostics
        </text>
        <text style={{ fg: "#565f89" }} marginBottom={1}>
          • Finding layer definitions
        </text>
        <text style={{ fg: "#565f89" }}>• Resolving dependencies</text>
      </Show>

      <Show
        when={
          store.ui.layerAnalysisStatus === "complete" &&
          store.ui.layerAnalysisResults === null
        }
      >
        <text style={{ fg: "#9ece6a" }} marginBottom={2}>
          ✅ No missing requirements found!
        </text>
        <text style={{ fg: "#c0caf5" }} marginBottom={2}>
          All Effect layers are properly
        </text>
        <text style={{ fg: "#c0caf5" }} marginBottom={2}>
          provided in your project.
        </text>
        <text style={{ fg: "#565f89" }}>Press [a] to re-analyze</text>
      </Show>

      <Show when={store.ui.layerAnalysisStatus === "error"}>
        <text style={{ fg: "#f7768e" }} marginBottom={2}>
          ❌ Analysis failed
        </text>
        <text style={{ fg: "#c0caf5" }} marginBottom={2}>
          {store.ui.layerAnalysisError || "Unknown error occurred"}
        </text>
        <text style={{ fg: "#565f89" }} marginBottom={1}>
          Press [a] to retry
        </text>
        <text style={{ fg: "#565f89" }}>Press [?] for help</text>
      </Show>

      <Show when={store.ui.layerAnalysisStatus === "applied"}>
        <text style={{ fg: "#9ece6a" }} marginBottom={2}>
          ✅ Fix applied successfully!
        </text>
        <Show when={store.ui.layerAnalysisResults}>
          <text style={{ fg: "#c0caf5" }} marginBottom={1}>
            {`Modified: ${store.ui.layerAnalysisResults?.targetFile}:${store.ui.layerAnalysisResults?.targetLine}`}
          </text>
          <text style={{ fg: "#c0caf5" }} marginBottom={2}>
            Added: Layer composition
          </text>
        </Show>
        <text style={{ fg: "#565f89" }}>Press [a] to re-analyze</text>
      </Show>
    </box>
  );
}

/**
 * Missing requirements list component - left panel
 * Shows services with their currently selected layers
 */
function ServicesListPanel() {
  const { store, actions } = useStore();

  const results = createMemo(() => store.ui.layerAnalysisResults);
  const candidates = createMemo(() => results()?.candidates || []);
  const selectedIndex = createMemo(
    () => store.ui.selectedLayerRequirementIndex,
  );
  const layerSelections = createMemo(() => store.ui.layerSelections);
  const isFocused = createMemo(
    () => store.ui.fixTabFocusedPanel === "services",
  );

  return (
    <scrollbox flexDirection="column" width="48%" marginRight={1}>
      <box flexDirection="column">
        <text
          style={{ fg: isFocused() ? "#7aa2f7" : "#565f89" }}
          marginBottom={1}
        >
          {isFocused() ? "▸ Missing Services" : "  Missing Services"}
        </text>

        <Show when={candidates().length === 0}>
          <text style={{ fg: "#565f89" }}>No missing services found</text>
        </Show>

        <Show when={candidates().length > 0}>
          <box flexDirection="column">
            <For each={candidates()}>
              {(candidate, idx) => {
                const isSelected = createMemo(() => idx() === selectedIndex());
                const bgColor = createMemo(() =>
                  isSelected() ? "#30363D" : "#1a1b26",
                );
                const fgColor = createMemo(() =>
                  isSelected() ? "#7aa2f7" : "#c0caf5",
                );
                const selectedLayer = createMemo(() =>
                  layerSelections().get(candidate.service),
                );
                const layerCount = candidate.layers.length;

                return (
                  <box
                    flexDirection="column"
                    paddingLeft={1}
                    paddingRight={1}
                    paddingTop={isSelected() ? 1 : 0}
                    paddingBottom={isSelected() ? 1 : 0}
                    backgroundColor={bgColor()}
                    marginBottom={1}
                  >
                    <text
                      style={{ fg: fgColor() }}
                      marginBottom={isSelected() ? 1 : 0}
                    >
                      {`${isSelected() ? "▸ " : "  "}${candidate.service}`}
                    </text>
                    <Show when={selectedLayer()}>
                      <text
                        style={{ fg: "#9ece6a" }}
                        marginBottom={isSelected() ? 1 : 0}
                      >
                        {`  → ${selectedLayer()}`}
                      </text>
                    </Show>
                    <Show when={isSelected()}>
                      <text style={{ fg: "#565f89" }}>
                        {`  ${layerCount} option${layerCount > 1 ? "s" : ""} available`}
                      </text>
                    </Show>
                  </box>
                );
              }}
            </For>
          </box>
        </Show>
      </box>
    </scrollbox>
  );
}

/**
 * Layer candidates panel - right panel
 * Shows all layer options for the selected service
 */
function LayerCandidatesPanel() {
  const { store, actions } = useStore();

  const results = createMemo(() => store.ui.layerAnalysisResults);
  const selectedIndex = createMemo(
    () => store.ui.selectedLayerRequirementIndex,
  );
  const candidates = createMemo(() => results()?.candidates || []);
  const selectedService = createMemo(() => {
    const cands = candidates();
    const idx = selectedIndex();
    return cands[idx];
  });
  const selectedCandidateIndex = createMemo(
    () => store.ui.selectedLayerCandidateIndex,
  );
  const layerSelections = createMemo(() => store.ui.layerSelections);
  const isFocused = createMemo(
    () => store.ui.fixTabFocusedPanel === "candidates",
  );

  return (
    <scrollbox
      flexDirection="column"
      width="48%"
      paddingLeft={1}
      paddingRight={1}
      style={{
        rootOptions: {
          border: ["left"],
          borderColor: "#30363D",
        },
      }}
    >
      <box flexDirection="column">
        <text
          style={{ fg: isFocused() ? "#7aa2f7" : "#565f89" }}
          marginBottom={1}
        >
          {isFocused() ? "▸ Layer Candidates" : "  Layer Candidates"}
        </text>

        <Show when={!selectedService()}>
          <text style={{ fg: "#565f89" }}>
            Select a service to view options
          </text>
        </Show>

        <Show when={selectedService()}>
          <text style={{ fg: "#c0caf5" }} marginBottom={1}>
            {`Options for ${selectedService()?.service}:`}
          </text>

          <box flexDirection="column">
            <For each={selectedService()?.layers || []}>
              {(layer, idx) => {
                const isHighlighted = createMemo(
                  () => idx() === selectedCandidateIndex(),
                );
                const isSelected = createMemo(
                  () =>
                    layerSelections().get(selectedService()?.service || "") ===
                    layer.name,
                );
                const bgColor = createMemo(() =>
                  isHighlighted() ? "#30363D" : "#1a1b26",
                );
                const fgColor = createMemo(() =>
                  isSelected()
                    ? "#9ece6a"
                    : isHighlighted()
                      ? "#7aa2f7"
                      : "#c0caf5",
                );
                const prefix = createMemo(() =>
                  isSelected() ? "✓ " : isHighlighted() ? "▸ " : "  ",
                );

                return (
                  <box
                    flexDirection="column"
                    paddingLeft={1}
                    paddingRight={1}
                    paddingTop={isHighlighted() ? 1 : 0}
                    paddingBottom={isHighlighted() ? 1 : 0}
                    backgroundColor={bgColor()}
                    marginBottom={1}
                  >
                    <text
                      style={{ fg: fgColor() }}
                      marginBottom={isHighlighted() ? 1 : 0}
                    >
                      {`${prefix()}${layer.name}`}
                    </text>
                    <Show when={isHighlighted()}>
                      <text style={{ fg: "#565f89" }} marginBottom={1}>
                        {`  ${layer.file.split("/").pop()}:${layer.line}`}
                      </text>
                      <Show when={layer.requires && layer.requires.length > 0}>
                        <text style={{ fg: "#e0af68" }}>
                          {`  Requires: ${layer.requires.join(", ")}`}
                        </text>
                      </Show>
                    </Show>
                  </box>
                );
              }}
            </For>
          </box>

          <text style={{ fg: "#565f89" }} marginTop={2}>
            Press [←/→] to navigate, [Enter] to select
          </text>
        </Show>
      </box>
    </scrollbox>
  );
}

/**
 * Analysis results view - split left/right panels
 */
function AnalysisResultsView() {
  return (
    <box
      flexDirection="row"
      width="100%"
      flexGrow={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <ServicesListPanel />
      <LayerCandidatesPanel />
    </box>
  );
}

/**
 * Main Fix Tab component
 * Note: No status bar here - it's in the parent index.tsx
 */
export function FixTab() {
  const { store } = useStore();

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor="#1a1b26"
    >
      {/* Content area - flex grow to take available space */}
      <box flexGrow={1} flexDirection="column" width="100%">
        <Show
          when={
            store.ui.layerAnalysisStatus === "idle" ||
            store.ui.layerAnalysisStatus === "analyzing" ||
            store.ui.layerAnalysisStatus === "error" ||
            (store.ui.layerAnalysisStatus === "complete" &&
              store.ui.layerAnalysisResults === null) ||
            store.ui.layerAnalysisStatus === "applied"
          }
        >
          <AnalysisStatusView />
        </Show>

        <Show
          when={
            store.ui.layerAnalysisStatus === "complete" &&
            store.ui.layerAnalysisResults !== null
          }
        >
          <AnalysisResultsView />
        </Show>
      </box>
    </box>
  );
}
