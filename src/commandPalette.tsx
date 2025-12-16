/**
 * Command Palette Component
 * Modal overlay with command search and execution
 */

import { For, Show, createMemo, createEffect } from "solid-js";
import { theme } from "./theme";
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
          backgroundColor={theme.bg}
          border={["top", "bottom", "left", "right"]}
          borderColor={theme.borderFocused}
          paddingTop={1}
        >
          {/* Header */}
          <text style={{ fg: theme.primary }} paddingLeft={2} marginBottom={1}>
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
              placeholderColor={theme.muted}
              focusedBackgroundColor={theme.bg}
              focusedTextColor={theme.text}
              cursorColor={theme.primary}
              backgroundColor={theme.bg}
              textColor={theme.text}
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
                <text style={{ fg: theme.muted }}>No commands found</text>
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
                      backgroundColor={isSelected() ? theme.borderFocused : undefined}
                    >
                      <text
                        style={{
                          fg: isSelected() ? theme.primary : theme.text,
                        }}
                      >
                        {`${isSelected() ? "> " : "  "}${command.label}`}
                      </text>
                      <Show when={command.shortcut}>
                        <text style={{ fg: theme.muted }}>
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
            borderColor={theme.bgSelected}
            border={["top"]}
          >
            <text style={{ fg: theme.muted }}>
              {`↑/↓ Navigate • Enter Execute • Esc Close`}
            </text>
          </box>
        </box>
      </box>
    </Show>
  );
}
