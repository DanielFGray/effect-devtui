/**
 * Layer Candidates Panel Component
 *
 * Right panel showing all layer options for the selected service.
 */

import { Show, For, createMemo } from "solid-js";
import { useStore } from "./store";

// Colors (Tokyo Night theme)
const COLORS = {
  primary: "#7aa2f7",
  text: "#c0caf5",
  muted: "#565f89",
  success: "#9ece6a",
  warning: "#e0af68",
  background: "#1a1b26",
  backgroundSelected: "#30363D",
  border: "#30363D",
} as const;

export function LayerCandidatesPanel() {
  const { store } = useStore();

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
    <box
      flexDirection="column"
      flexGrow={1}
      paddingLeft={1}
      paddingRight={1}
      border={["left"]}
      borderColor={COLORS.border}
    >
      <text
        style={{ fg: isFocused() ? COLORS.primary : COLORS.muted }}
        marginBottom={1}
      >
        {isFocused() ? "> Layer Candidates" : "  Layer Candidates"}
      </text>

      <Show when={!selectedService()}>
        <text style={{ fg: COLORS.muted }}>
          Select a service to view options
        </text>
      </Show>

      <Show when={selectedService()}>
        <text style={{ fg: COLORS.text }} marginBottom={1}>
          {`Options for ${selectedService()?.service}:`}
        </text>

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
              isHighlighted() ? COLORS.backgroundSelected : COLORS.background,
            );
            const fgColor = createMemo(() =>
              isSelected()
                ? COLORS.success
                : isHighlighted()
                  ? COLORS.primary
                  : COLORS.text,
            );
            const prefix = createMemo(() =>
              isSelected() ? "[x] " : isHighlighted() ? "> " : "  ",
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
                  <text style={{ fg: COLORS.muted }} marginBottom={1}>
                    {`  ${layer.file.split("/").pop()}:${layer.line}`}
                  </text>
                  <Show when={layer.requires && layer.requires.length > 0}>
                    <text style={{ fg: COLORS.warning }}>
                      {`  Requires: ${layer.requires.join(", ")}`}
                    </text>
                  </Show>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
