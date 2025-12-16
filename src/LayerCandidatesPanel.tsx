/**
 * Layer Candidates Panel Component
 *
 * Right panel showing all layer options for the selected service.
 */

import { Show, For, createMemo } from "solid-js";
import { theme } from "./theme";
import { useStore } from "./store";

interface LayerCandidatesPanelProps {
  showLeftBorder?: boolean;
}

export function LayerCandidatesPanel(props: LayerCandidatesPanelProps) {
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

  // Default to showing left border (for narrow horizontal layout)
  const showBorder = () => props.showLeftBorder ?? true;

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      paddingLeft={1}
      paddingRight={1}
      border={showBorder() ? ["left"] : []}
      borderColor={theme.border}
    >
      <text
        style={{ fg: isFocused() ? theme.primary : theme.muted }}
        marginBottom={1}
      >
        {isFocused() ? "> Layer Candidates" : "  Layer Candidates"}
      </text>

      <Show when={!selectedService()}>
        <text style={{ fg: theme.muted }}>
          Select a service to view options
        </text>
      </Show>

      <Show when={selectedService()}>
        <text style={{ fg: theme.text }} marginBottom={1}>
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
              isHighlighted() ? theme.bgSelected : theme.bg,
            );
            const fgColor = createMemo(() =>
              isSelected()
                ? theme.success
                : isHighlighted()
                  ? theme.primary
                  : theme.text,
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
                  <text style={{ fg: theme.muted }} marginBottom={1}>
                    {`  ${layer.file.split("/").pop()}:${layer.line}`}
                  </text>
                  <Show when={layer.requires && layer.requires.length > 0}>
                    <text style={{ fg: theme.warning }}>
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
