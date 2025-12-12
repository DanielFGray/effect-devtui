/**
 * Command Palette Component
 * Modal overlay with command search and execution
 */

import { For, Show, createMemo } from "solid-js";
import { useStore } from "./store";
import { getCommands, filterCommands } from "./commands";
import { useTerminalDimensions } from "@opentui/solid";
import { RGBA } from "@opentui/core";

export function CommandPalette() {
  const { store, actions } = useStore();
  const dimensions = useTerminalDimensions();

  // Get filtered commands
  const filteredCommands = createMemo(() => {
    const allCommands = getCommands(actions);
    return filterCommands(allCommands, store.ui.commandPaletteQuery);
  });

  return (
    <Show when={store.ui.showCommandPalette}>
      {/* Full-screen overlay - positioned absolutely */}
      <box
        position="absolute"
        left={0}
        top={0}
        width={dimensions().width}
        height={dimensions().height}
        alignItems="center"
        paddingTop={Math.floor(dimensions().height / 4)}
        backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      >
        {/* Modal container */}
        <box
          width={60}
          maxWidth={dimensions().width - 2}
          flexDirection="column"
          backgroundColor="#1a1b26"
          border={["all"]}
          borderColor="#414868"
          paddingTop={1}
        >
          {/* Header */}
          <text style={{ fg: "#7aa2f7" }} paddingLeft={2} marginBottom={1}>
            Command Palette
          </text>

          {/* Input field */}
          <box height={1} marginBottom={1} paddingLeft={2} paddingRight={2}>
            <text style={{ fg: "#c0caf5" }}>
              {`> ${store.ui.commandPaletteQuery}_`}
            </text>
          </box>

          {/* Command list */}
          <scrollbox
            flexDirection="column"
            height={12}
            flexShrink={0}
            paddingLeft={2}
            paddingRight={2}
          >
            <Show
              when={filteredCommands().length > 0}
              fallback={
                <text style={{ fg: "#565f89" }}>No commands found</text>
              }
            >
              <For each={filteredCommands()}>
                {(command, index) => {
                  const isSelected = () =>
                    index() === store.ui.selectedCommandIndex;

                  return (
                    <box
                      flexDirection="row"
                      justifyContent="space-between"
                      backgroundColor={isSelected() ? "#414868" : undefined}
                    >
                      <text
                        style={{
                          fg: isSelected() ? "#7aa2f7" : "#c0caf5",
                        }}
                      >
                        {`${isSelected() ? "> " : "  "}${command.label}`}
                      </text>
                      <Show when={command.shortcut}>
                        <text style={{ fg: "#565f89" }}>
                          {`[${command.shortcut}]`}
                        </text>
                      </Show>
                    </box>
                  );
                }}
              </For>
            </Show>
          </scrollbox>

          {/* Footer hint */}
          <box
            paddingTop={1}
            paddingLeft={2}
            borderColor="#30363D"
            border={["top"]}
          >
            <text style={{ fg: "#565f89" }}>
              {`↑/↓ Navigate • Enter Execute • Esc Close`}
            </text>
          </box>
        </box>
      </box>
    </Show>
  );
}
