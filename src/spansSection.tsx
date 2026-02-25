/**
 * Spans Section Component
 * Displays span tree with filter, stats summary, and details panel
 */

import { Show, createMemo, createEffect, onMount } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
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
  const dimensions = useTerminalDimensions();

  // Ref for the spans scrollbox to disable its keyboard handling
  let spansScrollBoxRef: ScrollBoxRenderable | undefined;

  // Disable scrollbox keyboard handling on mount
  onMount(() => {
    if (spansScrollBoxRef) {
      // Access the protected _focusable property to prevent scrollbox from handling keys
      (spansScrollBoxRef as any)._focusable = false;
    }
  });

  // Auto-scroll to keep selected span or trace in view
  createEffect(() => {
    const selectedSpanId = store.ui.selectedSpanId;
    const selectedTraceId = store.ui.selectedTraceId;
    const targetId = selectedSpanId || (selectedTraceId ? `trace:${selectedTraceId}` : null);
    if (!targetId || !spansScrollBoxRef) return;

    // The span tree is wrapped in a box, so we need to get the children of that box
    const scrollBoxChildren = spansScrollBoxRef.getChildren();
    if (scrollBoxChildren.length === 0) return;

    // Get the actual span/trace text elements (children of the first box)
    const spanElements = scrollBoxChildren[0].getChildren();
    const target = spanElements.find((child) => child.id === targetId);
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

  const showWaterfall = createMemo(() => store.ui.spanViewMode === "waterfall");

  // Calculate bar width for waterfall view based on terminal width
  const waterfallBarWidth = createMemo(() => {
    if (!showWaterfall()) return 0;
    const termWidth = dimensions().width;
    const spansWidth = Math.floor(termWidth * 0.6) - 4; // 60% minus padding
    const available = spansWidth - 48;
    return Math.max(20, available);
  });

  // Aggregate span stats - computed via createMemo from store.spans
  const spanStats = createMemo(() => {
    const spans = store.spans;
    if (spans.length === 0) {
      return { spanCount: 0, traceCount: 0, errorCount: 0, errorPct: 0, avgMs: 0 };
    }

    const traceIds = new Set<string>();
    let errorCount = 0;
    let totalDurationMs = 0;
    let durationCount = 0;

    for (const span of spans) {
      traceIds.add(span.traceId);

      // Check for error attributes
      const errAttr = span.attributes["error"] ?? span.attributes["error.message"];
      if (errAttr !== undefined && errAttr !== null) {
        errorCount++;
      }

      // Accumulate duration for average
      if (span.endTime !== null) {
        const durationMs = Number(span.endTime - span.startTime) / 1_000_000;
        totalDurationMs += durationMs;
        durationCount++;
      }
    }

    const avgMs = durationCount > 0 ? totalDurationMs / durationCount : 0;
    const errorPct = spans.length > 0 ? (errorCount / spans.length) * 100 : 0;

    return {
      spanCount: spans.length,
      traceCount: traceIds.size,
      errorCount,
      errorPct,
      avgMs,
    };
  });

  // Format the stats summary line
  const statsLine = createMemo(() => {
    const stats = spanStats();
    if (stats.spanCount === 0) return "";

    const avgStr =
      stats.avgMs < 1
        ? `${(stats.avgMs * 1000).toFixed(0)}us`
        : stats.avgMs < 1000
          ? `${stats.avgMs.toFixed(1)}ms`
          : `${(stats.avgMs / 1000).toFixed(2)}s`;

    return `Spans: ${stats.spanCount} | Traces: ${stats.traceCount} | Errors: ${stats.errorCount} (${stats.errorPct.toFixed(1)}%) | Avg: ${avgStr}`;
  });

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
        {`Spans (${spanCount()})${showWaterfall() ? " [Waterfall]" : ""} - Active: ${activeClientName()}`}
      </text>

      {/* Stats summary bar */}
      <Show when={spanStats().spanCount > 0}>
        <text
          height={1}
          flexShrink={0}
          style={{ fg: spanStats().errorCount > 0 ? theme.warning : theme.muted }}
        >
          {statsLine()}
        </text>
      </Show>

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

      {/* Main content: span list + details panel */}
      <box flexDirection="row" flexGrow={1}>
        {/* Span list - left side */}
        <scrollbox
          ref={(r) => {
            spansScrollBoxRef = r;
          }}
          width="60%"
          marginRight={1}
        >
          <SpanTreeView
            spans={store.spans}
            selectedSpanId={store.ui.selectedSpanId}
            selectedTraceId={store.ui.selectedTraceId}
            expandedSpanIds={store.ui.expandedSpanIds}
            expandedTraceIds={store.ui.expandedTraceIds}
            filterQuery={store.ui.spanFilterQuery || undefined}
            showWaterfall={showWaterfall()}
            waterfallBarWidth={waterfallBarWidth()}
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
