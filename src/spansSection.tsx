/**
 * Spans Section Component
 * Displays span tree with filter and details panel
 */

import { Show, createMemo, createEffect, onMount } from "solid-js";
import { theme } from "./theme";
import * as Option from "effect/Option";
import { useStore, type FocusedSection } from "./store";
import { SpanTreeView, SpanDetailsPanel } from "./spanTree";
import { SpanFilterInput } from "./spanFilterInput";
import type { ScrollBoxRenderable } from "@opentui/core";

/**
 * Helper to get section header color based on focus state
 */
function getSectionHeaderColor(
  focusedSection: FocusedSection,
  section: FocusedSection,
): string {
  return focusedSection === section ? theme.primary : theme.muted;
}

/**
 * Spans section with tree view and details panel
 */
export function SpansSection() {
  const { store } = useStore();

  // Ref for the spans scrollbox to disable its keyboard handling
  let spansScrollBoxRef: ScrollBoxRenderable | undefined;

  // Disable scrollbox keyboard handling on mount
  onMount(() => {
    if (spansScrollBoxRef) {
      // Access the protected _focusable property to prevent scrollbox from handling keys
      (spansScrollBoxRef as any)._focusable = false;
    }
  });

  // Auto-scroll to keep selected span in view
  createEffect(() => {
    const selectedSpanId = store.ui.selectedSpanId;
    if (!selectedSpanId || !spansScrollBoxRef) return;

    // The span tree is wrapped in a box, so we need to get the children of that box
    const scrollBoxChildren = spansScrollBoxRef.getChildren();
    if (scrollBoxChildren.length === 0) return;

    // Get the actual span text elements (children of the first box)
    const spanElements = scrollBoxChildren[0].getChildren();
    const target = spanElements.find((child) => child.id === selectedSpanId);
    if (!target) return;

    // Calculate relative position
    const y = target.y - spansScrollBoxRef.y;

    // Scroll down if needed
    if (y >= spansScrollBoxRef.height) {
      spansScrollBoxRef.scrollBy(y - spansScrollBoxRef.height + 1);
    }
    // Scroll up if needed
    if (y < 0) {
      spansScrollBoxRef.scrollBy(y);
    }
  });

  const spanCount = createMemo(() => store.spans.length);

  const activeClientName = createMemo(() =>
    store.activeClient
      .pipe(Option.map((c) => c.name))
      .pipe(Option.getOrElse(() => "None")),
  );

  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      flexGrow={1}
      minHeight={6}
    >
      <text
        height={1}
        flexShrink={0}
        style={{ fg: getSectionHeaderColor(store.ui.focusedSection, "spans") }}
      >
        {`Spans (${spanCount()}) - Active: ${activeClientName()}`}
      </text>

      {/* Span filter input (shown when typing) */}
      <Show when={store.ui.showSpanFilter}>
        <SpanFilterInput />
      </Show>

      {/* Active filter indicator (shown when filter closed but query active) */}
      <Show
        when={!store.ui.showSpanFilter && store.ui.spanFilterQuery.length > 0}
      >
        <box
          flexDirection="row"
          width="100%"
          paddingLeft={1}
          paddingBottom={1}
          flexShrink={0}
        >
          <text style={{ fg: theme.error }}>
            {`Filter: "${store.ui.spanFilterQuery}" (press / to edit, Esc to clear)`}
          </text>
        </box>
      </Show>

      {/* Side-by-side: Span list and details */}
      <box flexDirection="row" flexGrow={1}>
        {/* Span list - left side */}
        <scrollbox
          ref={(r) => (spansScrollBoxRef = r)}
          width="60%"
          marginRight={1}
        >
          <SpanTreeView
            spans={store.spans}
            selectedSpanId={store.ui.selectedSpanId}
            expandedSpanIds={store.ui.expandedSpanIds}
            filterQuery={store.ui.spanFilterQuery || undefined}
          />
        </scrollbox>

        {/* Span Details - right side */}
        <scrollbox
          width="40%"
          paddingLeft={1}
          style={{
            rootOptions: {
              border: ["left"],
              borderColor: theme.bgSelected,
            },
          }}
        >
          <Show
            when={store.ui.selectedSpanId !== null}
            fallback={
              <text style={{ fg: theme.muted }}>
                {`Select a span with j/k\nPress → to expand or Enter`}
              </text>
            }
          >
            <SpanDetailsPanel
              spans={store.spans}
              spanId={store.ui.selectedSpanId}
            />
          </Show>
        </scrollbox>
      </box>
    </box>
  );
}
