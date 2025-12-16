/**
 * Span Filter Input Component
 * Text input for filtering spans by name with "/" key activation
 */

import { createSignal, createEffect } from "solid-js";
import { theme } from "./theme";
import { useStore } from "./store";

interface SpanFilterInputProps {
  onInput?: (key: string) => void;
  onEscape?: () => void;
}

export function SpanFilterInput(props: SpanFilterInputProps) {
  const { store, actions } = useStore();
  const [cursorPosition, setCursorPosition] = createSignal(0);

  // Sync cursor position when query changes externally
  createEffect(() => {
    setCursorPosition(store.ui.spanFilterQuery.length);
  });

  // Build the display text with cursor
  const displayText = () => {
    const query = store.ui.spanFilterQuery;
    const pos = cursorPosition();
    const beforeCursor = query.slice(0, pos);
    const afterCursor = query.slice(pos);
    return `${beforeCursor}_${afterCursor}`;
  };

  return (
    <box
      flexDirection="row"
      width="100%"
      padding={1}
      backgroundColor={theme.bgHighlight}
      border={["bottom"]}
      borderColor={theme.bgSelected}
    >
      <text style={{ fg: theme.primary, marginRight: 1 }}>Filter:</text>
      <text style={{ fg: theme.text, flexGrow: 1 }}>{displayText()}</text>
      <text style={{ fg: theme.muted, marginLeft: 1 }}>
        {store.ui.spanFilterQuery
          ? `[${store.ui.spanFilterQuery.length}]`
          : "[0]"}
      </text>
    </box>
  );
}
