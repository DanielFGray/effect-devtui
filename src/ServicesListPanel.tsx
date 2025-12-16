/**
 * Services List Panel Component
 *
 * Left panel showing missing services with their currently selected layers.
 */

import { Show, For, createMemo } from "solid-js";
import { useStore } from "./store";

// Colors (Tokyo Night theme)
const COLORS = {
  primary: "#7aa2f7",
  text: "#c0caf5",
  muted: "#565f89",
  success: "#9ece6a",
  background: "#1a1b26",
  backgroundSelected: "#30363D",
} as const;

export function ServicesListPanel() {
  const { store } = useStore();

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
    <box flexDirection="column" flexGrow={1}>
      <text
        style={{ fg: isFocused() ? COLORS.primary : COLORS.muted }}
        marginBottom={1}
      >
        {isFocused() ? "> Missing Services" : "  Missing Services"}
      </text>

      <Show when={candidates().length === 0}>
        <text style={{ fg: COLORS.muted }}>No missing services found</text>
      </Show>

      <Show when={candidates().length > 0}>
        <For each={candidates()}>
          {(candidate, idx) => {
            const isSelected = createMemo(() => idx() === selectedIndex());
            const bgColor = createMemo(() =>
              isSelected() ? COLORS.backgroundSelected : COLORS.background,
            );
            const fgColor = createMemo(() =>
              isSelected() ? COLORS.primary : COLORS.text,
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
                  {`${isSelected() ? "> " : "  "}${candidate.service}`}
                </text>
                <Show when={selectedLayer()}>
                  <text
                    style={{ fg: COLORS.success }}
                    marginBottom={isSelected() ? 1 : 0}
                  >
                    {`  -> ${selectedLayer()}`}
                  </text>
                </Show>
                <Show when={isSelected()}>
                  <text style={{ fg: COLORS.muted }}>
                    {`  ${layerCount} option${layerCount > 1 ? "s" : ""} available`}
                  </text>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
