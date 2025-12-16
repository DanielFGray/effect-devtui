/**
 * Span Tree View Component
 * Displays spans in a hierarchical tree structure with selection and expand/collapse
 */

import { For, Show, createMemo } from "solid-js";
import { theme } from "./theme";

import type { SimpleSpan } from "./store";

/**
 * Calculates the duration of a span in milliseconds
 */
function getSpanDurationMs(span: {
  endTime: bigint | null;
  startTime: bigint;
}): number | null {
  if (span.endTime !== null) {
    return Number(span.endTime - span.startTime) / 1_000_000;
  }
  return null;
}

/**
 * Tree node with depth information
 */
interface TreeNode {
  span: SimpleSpan | null;
  traceId: string | null;
  depth: number;
  hasChildren: boolean;
  isLastChild: boolean;
  isTraceGroup: boolean; // Always false now, kept for compatibility
  ancestorLines: boolean[]; // For each depth level, whether to draw a vertical line
  rootSpan: SimpleSpan | null; // Reference to root span for waterfall time calculations
}

/**
 * Build hierarchical span tree without trace grouping
 */
function buildHierarchicalSpanTree(
  spans: ReadonlyArray<SimpleSpan>,
  expandedSpanIds: Set<string>,
  filterQuery?: string,
): TreeNode[] {
  const result: TreeNode[] = [];

  // Deduplicate spans - keep only the latest version of each spanId
  // Prefer "ended" over "running" status
  const deduped = new Map<string, SimpleSpan>();
  for (const span of spans) {
    const existing = deduped.get(span.spanId);
    if (!existing || span.status === "ended") {
      deduped.set(span.spanId, span);
    }
  }
  let uniqueSpans = Array.from(deduped.values());

  // Apply filter if provided
  if (filterQuery && filterQuery.trim()) {
    const lowerQuery = filterQuery.toLowerCase();
    uniqueSpans = uniqueSpans.filter((span) =>
      span.name.toLowerCase().includes(lowerQuery),
    );
  }

  const spanMap = new Map(uniqueSpans.map((s) => [s.spanId, s]));
  const visited = new Set<string>(); // Track visited spans to prevent duplicates

  // Build children map for all spans
  const childrenMap = new Map<string, SimpleSpan[]>();
  for (const span of uniqueSpans) {
    if (span.parent) {
      const children = childrenMap.get(span.parent) || [];
      children.push(span);
      childrenMap.set(span.parent, children);
    }
  }

  // Sort children by start time within each parent
  for (const children of childrenMap.values()) {
    children.sort((a, b) => {
      if (a.startTime < b.startTime) return -1;
      if (a.startTime > b.startTime) return 1;
      return 0;
    });
  }

  // DFS to build visible tree
  const visitSpan = (
    span: SimpleSpan,
    depth: number,
    isLastChild: boolean,
    ancestorLines: boolean[],
    rootSpan: SimpleSpan,
  ) => {
    // Prevent visiting the same span twice
    if (visited.has(span.spanId)) {
      console.log(
        `[SpanTree] WARNING: Attempt to visit span ${span.name} (${span.spanId.substring(0, 8)}) twice! Skipping.`,
      );
      return;
    }
    visited.add(span.spanId);

    const children = childrenMap.get(span.spanId) || [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedSpanIds.has(span.spanId);

    result.push({
      span,
      traceId: null,
      depth,
      hasChildren,
      isLastChild,
      isTraceGroup: false,
      ancestorLines,
      rootSpan,
    });

    if (hasChildren && isExpanded) {
      children.forEach((child, idx) => {
        const childIsLast = idx === children.length - 1;
        // For children, add to ancestorLines whether current node continues down
        const newAncestorLines = [...ancestorLines, !isLastChild];
        visitSpan(child, depth + 1, childIsLast, newAncestorLines, rootSpan);
      });
    }
  };

  // Get root spans (spans with no parent or parent not in the current span set)
  const rootSpans = uniqueSpans.filter(
    (s) => s.parent === null || !spanMap.has(s.parent),
  );

  // Sort root spans by start time
  rootSpans.sort((a, b) => {
    if (a.startTime < b.startTime) return -1;
    if (a.startTime > b.startTime) return 1;
    return 0;
  });

  // Visit each root span (passing itself as the rootSpan reference)
  rootSpans.forEach((root, idx) => {
    visitSpan(root, 0, idx === rootSpans.length - 1, [], root);
  });

  return result;
}

/**
 * Format duration in ms
 */
function formatDuration(span: SimpleSpan): string {
  const durationMs = getSpanDurationMs(span);
  if (durationMs === null) return "";
  if (durationMs < 1) {
    return `${(durationMs * 1000).toFixed(0)}μs`;
  }
  if (durationMs < 1000) {
    return `${durationMs.toFixed(1)}ms`;
  }
  return `${(durationMs / 1000).toFixed(2)}s`;
}

/**
 * Render a waterfall bar using box-drawing characters
 *
 * Design:
 *   Root span (completed): ●──────────────●
 *   Root span (running):   ●──────────────▶
 *   Child spans:           ├──────────┤
 *   Child (running):       ├────────────────────────▸
 */
function renderWaterfallBar(
  startOffset: number, // 0-1, where span starts relative to time range
  endOffset: number, // 0-1, where span ends (1.0 for running spans)
  barWidth: number, // available characters for the bar area
  isRunning: boolean,
  isRoot: boolean,
): string {
  if (barWidth < 3) return "";

  const startCol = Math.floor(startOffset * barWidth);
  const endCol = Math.min(Math.floor(endOffset * barWidth), barWidth - 1);
  // Ensure minimum width of 2 so we always get start+end characters
  const spanWidth = Math.max(endCol - startCol, 2);

  // Build the bar string
  let bar = "";

  // Leading spaces
  bar += " ".repeat(startCol);

  // The bar itself
  if (isRoot) {
    if (isRunning) {
      // Root span running: ●────▶
      bar += "●";
      bar += "─".repeat(Math.max(spanWidth - 2, 0));
      bar += "▶";
    } else {
      // Root span completed: ●────●
      bar += "●";
      bar += "─".repeat(Math.max(spanWidth - 2, 0));
      bar += "●";
    }
  } else {
    if (isRunning) {
      // Child span running: ├────▸
      bar += "├";
      bar += "─".repeat(Math.max(spanWidth - 2, 0));
      bar += "▸";
    } else {
      // Child span completed: ├────┤
      bar += "├";
      bar += "─".repeat(Math.max(spanWidth - 2, 0));
      bar += "┤";
    }
  }

  // Trailing spaces to fill width
  const remaining = barWidth - bar.length;
  if (remaining > 0) {
    bar += " ".repeat(remaining);
  }

  return bar;
}

/**
 * Get time range for a span (relative to its root span)
 */
function getTimeRange(node: TreeNode): {
  min: bigint;
  max: bigint;
  duration: number;
} {
  const rootSpan = node.rootSpan;
  if (!rootSpan) return { min: 0n, max: 0n, duration: 0 };

  const minTime = rootSpan.startTime;
  let maxTime = rootSpan.endTime ?? rootSpan.startTime;

  // If root is still running, extend the range
  if (rootSpan.status === "running") {
    const extension = (maxTime - minTime) / 2n;
    maxTime = maxTime + (extension > 0n ? extension : 1000000000n); // At least 1 second
  }

  const duration = Number(maxTime - minTime);
  return { min: minTime, max: maxTime, duration };
}

/**
 * Calculate waterfall bar offsets for a span
 */
function getWaterfallOffsets(
  span: SimpleSpan,
  node: TreeNode,
): { startOffset: number; endOffset: number } {
  const range = getTimeRange(node);
  const isRunning = span.status === "running";

  let startOffset = 0;
  let endOffset = 1;

  if (range.duration > 0) {
    startOffset = Number(span.startTime - range.min) / range.duration;
    if (isRunning) {
      endOffset = 1; // Extend to end
    } else {
      endOffset =
        Number((span.endTime ?? span.startTime) - range.min) / range.duration;
    }
  }

  // Clamp offsets
  startOffset = Math.max(0, Math.min(1, startOffset));
  endOffset = Math.max(startOffset + 0.01, Math.min(1, endOffset));

  return { startOffset, endOffset };
}

/**
 * Get tree prefix for a node
 */
function getTreePrefix(node: TreeNode, expandedSpanIds: Set<string>): string {
  if (!node.span) {
    return "";
  }

  if (node.depth === 0) {
    if (node.hasChildren) {
      return expandedSpanIds.has(node.span.spanId) ? "▼ " : "▶ ";
    }
    return "  ";
  }

  // Build prefix from ancestor lines
  let prefix = "";
  for (let i = 0; i < node.depth; i++) {
    if (node.ancestorLines[i]) {
      prefix += "│ ";
    } else {
      prefix += "  ";
    }
  }

  const branch = node.isLastChild ? "└─" : "├─";
  const expand = node.hasChildren
    ? expandedSpanIds.has(node.span.spanId)
      ? "▼ "
      : "▶ "
    : "─ ";

  return prefix + branch + expand;
}

/**
 * Format attribute value for display
 * Handles objects, arrays, and truncates long strings
 */
function formatAttributeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }
    const keys = Object.keys(value);
    return `{${keys.length} keys}`;
  }

  const str = String(value);
  if (str.length > 50) {
    return str.substring(0, 47) + "...";
  }
  return str;
}

/**
 * Format ID for display - show full ID with visual truncation
 * Displays: "a659abb3-... (full)"
 */
function formatIdDisplay(id: string, maxLength: number = 16): string {
  if (id.length <= maxLength) {
    return id;
  }
  return `${id.substring(0, maxLength - 4)}... (${id.length} chars)`;
}

/**
 * Main span tree view component with hierarchy
 */
export function SpanTreeView(props: {
  spans: ReadonlyArray<SimpleSpan>;
  selectedSpanId: string | null;
  expandedSpanIds: Set<string>;
  filterQuery?: string;
  showWaterfall?: boolean;
  waterfallBarWidth?: number;
}) {
  // Memoize tree - will re-run whenever spans, expandedSpanIds, or filterQuery change
  const visibleNodes = createMemo(() =>
    buildHierarchicalSpanTree(
      props.spans,
      props.expandedSpanIds,
      props.filterQuery,
    ),
  );

  return (
    <Show
      when={props.spans.length > 0}
      fallback={<text style={{ fg: theme.muted }}>No spans received yet</text>}
    >
      <box flexDirection="column" width="100%" padding={1}>
        <For each={visibleNodes()}>
          {(node) => {
            // Handle regular span nodes
            if (!node.span) return null;

            const span = node.span;
            const isSelected = () =>
              props.selectedSpanId !== null &&
              props.selectedSpanId === span.spanId;

            const statusColor = () =>
              span.status === "running" ? theme.warning : theme.success;

            const duration = formatDuration(span);

            // Build the row content - consistent column layout
            // 2 columns always: [tree+name] [duration]
            // 3 columns with waterfall: [tree+name] [waterfall bar] [duration]
            const rowContent = () => {
              const selector = isSelected() ? "> " : "  ";
              const prefix = getTreePrefix(node, props.expandedSpanIds);

              const TREE_NAME_WIDTH = 24; // Fixed width for tree prefix + span name combined
              const DURATION_WIDTH = 10; // Fixed width for duration

              // Combine tree prefix and span name, then pad/truncate to fixed width
              const treeName = prefix + span.name;
              const paddedTreeName =
                treeName.length > TREE_NAME_WIDTH
                  ? treeName.slice(0, TREE_NAME_WIDTH - 1) + "…"
                  : treeName.padEnd(TREE_NAME_WIDTH);

              if (props.showWaterfall && props.waterfallBarWidth) {
                // With waterfall bar
                const { startOffset, endOffset } = getWaterfallOffsets(
                  span,
                  node,
                );
                const bar = renderWaterfallBar(
                  startOffset,
                  endOffset,
                  props.waterfallBarWidth,
                  span.status === "running",
                  node.depth === 0,
                );

                return `${selector}${paddedTreeName} ${bar} ${duration.padStart(DURATION_WIDTH)}`;
              } else {
                // Without waterfall bar - just tree+name and duration
                return `${selector}${paddedTreeName} ${duration.padStart(DURATION_WIDTH)}`;
              }
            };

            return (
              <text
                id={span.spanId}
                style={{
                  fg: isSelected() ? theme.bg : statusColor(),
                  bg: isSelected() ? theme.primary : undefined,
                }}
              >
                {rowContent()}
              </text>
            );
          }}
        </For>
      </box>
    </Show>
  );
}

/**
 * Span details panel - shows detailed information about selected span
 */
export function SpanDetailsPanel(props: {
  spans: ReadonlyArray<SimpleSpan>;
  spanId: string | null;
}) {
  const selectedSpan = createMemo(() => {
    if (props.spanId === null) return null;
    const found = props.spans.find((s) => s.spanId === props.spanId);
    return found || null;
  });

  return (
    <Show
      when={selectedSpan() !== null}
      fallback={
        <text style={{ fg: theme.muted }}>
          {`Select a span with j/k\nPress Enter to expand`}
        </text>
      }
    >
      {(() => {
        const span = selectedSpan()!;
        const durationMs = getSpanDurationMs(span);
        const eventCount = span.events?.length || 0;
        const attrCount = Object.keys(span.attributes).length;

        return (
          <box flexDirection="column" width="100%" padding={1}>
            {/* Span Name Header */}
            <text style={{ fg: theme.primary }} marginBottom={1}>
              {span.name}
            </text>

            {/* IDs Section */}
            <text style={{ fg: theme.success }}>IDs:</text>
            <text style={{ fg: theme.text }} marginLeft={1}>
              {`Span:  ${span.spanId}`}
            </text>
            <text style={{ fg: theme.text }} marginLeft={1} marginBottom={1}>
              {`Trace: ${span.traceId}`}
            </text>

            {/* Status Section */}
            <text
              style={{
                fg: span.status === "running" ? theme.warning : theme.success,
              }}
            >
              {`Status: ${span.status}${durationMs !== null ? ` (${formatDuration(span)})` : ""}`}
            </text>

            <Show when={span.parent}>
              <text
                style={{ fg: theme.muted }}
              >{`Parent: ${span.parent}`}</text>
            </Show>

            {/* Events Section */}
            <Show when={eventCount > 0}>
              <text style={{ fg: theme.success }} marginTop={1}>
                {`Events: ${eventCount}`}
              </text>
              <For each={span.events.slice(0, 5)}>
                {(event) => {
                  // Calculate event time relative to span start
                  const relativeTimeMs =
                    Number(event.startTime - span.startTime) / 1_000_000;
                  const eventHasAttrs =
                    Object.keys(event.attributes).length > 0;

                  return (
                    <box flexDirection="column" marginLeft={1}>
                      <text style={{ fg: theme.error }}>
                        {`+${relativeTimeMs.toFixed(2)}ms: ${event.name}`}
                      </text>
                      <Show when={eventHasAttrs}>
                        <For
                          each={Object.entries(event.attributes).slice(0, 3)}
                        >
                          {([key, value]) => {
                            const valueStr = formatAttributeValue(value);
                            return (
                              <text style={{ fg: theme.muted }} marginLeft={1}>
                                {`${key}: ${valueStr}`}
                              </text>
                            );
                          }}
                        </For>
                      </Show>
                    </box>
                  );
                }}
              </For>
              <Show when={eventCount > 5}>
                <text style={{ fg: theme.muted }} marginLeft={1}>
                  {`... and ${eventCount - 5} more`}
                </text>
              </Show>
            </Show>

            {/* Attributes Section */}
            <Show when={attrCount > 0}>
              <text style={{ fg: theme.success }} marginTop={1}>
                {`Attributes: ${attrCount}`}
              </text>
              <For each={Object.entries(span.attributes).slice(0, 8)}>
                {([key, value]) => {
                  const valueStr = formatAttributeValue(value);
                  return (
                    <text style={{ fg: theme.secondary }} marginLeft={1}>
                      {`${key}: ${valueStr}`}
                    </text>
                  );
                }}
              </For>
              <Show when={attrCount > 8}>
                <text style={{ fg: theme.muted }} marginLeft={1}>
                  {`... and ${attrCount - 8} more`}
                </text>
              </Show>
            </Show>
          </box>
        );
      })()}
    </Show>
  );
}
