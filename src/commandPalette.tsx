/**
 * Command Palette Component
 * Modal overlay with command search and execution
 */

import { For, Show, createMemo, createEffect } from "solid-js";
import { useStore } from "./store";
import { getCommands, filterCommands } from "./commands";
import { useTerminalDimensions } from "@opentui/solid";
import {
  RGBA,
  type ScrollBoxRenderable,
  type InputRenderable,
} from "@opentui/core";

export function CommandPalette() {
  const { store, actions } = useStore();
  const dimensions = useTerminalDimensions();
  let scrollBoxRef: ScrollBoxRenderable | undefined;
  let inputRef: InputRenderable | undefined;

  // Get filtered commands
  const filteredCommands = createMemo(() => {
    const allCommands = getCommands(actions);
    return filterCommands(allCommands, store.ui.commandPaletteQuery);
  });

  // Auto-scroll when selection changes
  createEffect(() => {
    const selectedIndex = store.ui.selectedCommandIndex;
    if (!scrollBoxRef) return;

    // Find the target box by ID
    const target = scrollBoxRef.getChildren().find((child) => {
      return child.id === `command-${selectedIndex}`;
    });

    if (!target) return;

    // Calculate relative position
    const y = target.y - scrollBoxRef.y;

    // Scroll down if needed
    if (y >= scrollBoxRef.height) {
      scrollBoxRef.scrollBy(y - scrollBoxRef.height + 1);
    }
    // Scroll up if needed
    if (y < 0) {
      scrollBoxRef.scrollBy(y);
    }
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
          border={["top", "bottom", "left", "right"]}
          borderColor="#414868"
          paddingTop={1}
        >
          {/* Header */}
          <text style={{ fg: "#7aa2f7" }} paddingLeft={2} marginBottom={1}>
            Command Palette
          </text>

          {/* Input field */}
          <box marginBottom={1} paddingLeft={2} paddingRight={2}>
            <input
              ref={(r) => {
                inputRef = r;
                setTimeout(() => r.focus(), 1);
              }}
              onInput={(value) => actions.setCommandPaletteQuery(value)}
              placeholder="Search commands..."
              placeholderColor="#565f89"
              focusedBackgroundColor="#1a1b26"
              focusedTextColor="#c0caf5"
              cursorColor="#7aa2f7"
              backgroundColor="#1a1b26"
              textColor="#c0caf5"
            />
          </box>

          {/* Command list */}
          <scrollbox
            ref={(r) => (scrollBoxRef = r)}
            flexDirection="column"
            height={5}
            flexShrink={0}
            paddingLeft={2}
            paddingRight={2}
            scrollbarOptions={{ visible: false }}
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
                      id={`command-${index()}`}
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
