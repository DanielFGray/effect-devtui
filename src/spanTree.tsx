/**
 * Span Tree View Component
 * Displays spans grouped by trace in a hierarchical tree with selection and expand/collapse
 */

import { For, Show, createMemo } from "solid-js";
import { theme } from "./theme";
import { prepareSpanTree } from "./spanTreeUtils";

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
 * Metadata for a trace group header row
 */
interface TraceGroupInfo {
  traceId: string;
  rootSpanName: string;
  spanCount: number;
  durationMs: number | null;
  hasError: boolean;
}

/**
 * Tree node with depth information
 */
interface TreeNode {
  span: SimpleSpan | null;
  traceId: string | null;
  traceInfo: TraceGroupInfo | null;
  depth: number;
  hasChildren: boolean;
  isLastChild: boolean;
  isTraceGroup: boolean;
  ancestorLines: boolean[]; // For each depth level, whether to draw a vertical line
  rootSpan: SimpleSpan | null; // Reference to root span for waterfall time calculations
}

/**
 * Build hierarchical span tree with trace grouping.
 *
 * Spans are grouped by traceId. Each trace produces a header node followed by
 * its span tree (if expanded).
 */
function buildHierarchicalSpanTree(
  spans: ReadonlyArray<SimpleSpan>,
  expandedSpanIds: Set<string>,
  expandedTraceIds: Set<string>,
  filterQuery?: string,
): TreeNode[] {
  const result: TreeNode[] = [];
  const { traceGroups, childrenMap } = prepareSpanTree(spans, filterQuery);
  const visited = new Set<string>();

  // DFS to build visible span tree within a trace
  const visitSpan = (
    span: SimpleSpan,
    depth: number,
    isLastChild: boolean,
    ancestorLines: boolean[],
    rootSpan: SimpleSpan,
  ) => {
    if (visited.has(span.spanId)) return;
    visited.add(span.spanId);

    const children = childrenMap.get(span.spanId) || [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedSpanIds.has(span.spanId);

    result.push({
      span,
      traceId: null,
      traceInfo: null,
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
        const newAncestorLines = [...ancestorLines, !isLastChild];
        visitSpan(child, depth + 1, childIsLast, newAncestorLines, rootSpan);
      });
    }
  };

  // Emit each trace group
  for (const group of traceGroups) {
    const primaryRoot = group.rootSpans[0];

    // Compute trace header info
    const rootDurationMs = getSpanDurationMs(primaryRoot);
    const hasError = group.spans.some((s) => {
      const errAttr = s.attributes["error"] ?? s.attributes["error.message"];
      return errAttr !== undefined && errAttr !== null;
    });

    const traceInfo: TraceGroupInfo = {
      traceId: group.traceId,
      rootSpanName: primaryRoot.name,
      spanCount: group.spans.length,
      durationMs: rootDurationMs,
      hasError,
    };

    // Emit trace header node
    result.push({
      span: null,
      traceId: group.traceId,
      traceInfo,
      depth: 0,
      hasChildren: true,
      isLastChild: false,
      isTraceGroup: true,
      ancestorLines: [],
      rootSpan: null,
    });

    // If trace is expanded, emit its span tree
    if (expandedTraceIds.has(group.traceId)) {
      group.rootSpans.forEach((root, idx) => {
        visitSpan(root, 0, idx === group.rootSpans.length - 1, [], root);
      });
    }
  }

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

  // If root is still running (no endTime), extend the range
  if (rootSpan.endTime === null) {
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
  // Use endTime to determine if span is still running (more reliable than status)
  const isRunning = span.endTime === null;

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
 * Format a duration in ms for trace headers
 */
function formatDurationMs(ms: number | null): string {
  if (ms === null) return "running";
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Main span tree view component with hierarchy and trace grouping
 */
export function SpanTreeView(props: {
  spans: ReadonlyArray<SimpleSpan>;
  selectedSpanId: string | null;
  selectedTraceId: string | null;
  expandedSpanIds: Set<string>;
  expandedTraceIds: Set<string>;
  filterQuery?: string;
  showWaterfall?: boolean;
  waterfallBarWidth?: number;
}) {
  // Memoize tree - will re-run whenever spans, expandedSpanIds, expandedTraceIds, or filterQuery change
  const visibleNodes = createMemo(() =>
    buildHierarchicalSpanTree(
      props.spans,
      props.expandedSpanIds,
      props.expandedTraceIds,
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
            // Handle trace group header nodes
            if (node.isTraceGroup && node.traceInfo) {
              const info = node.traceInfo;
              const isSelected = () =>
                props.selectedTraceId !== null &&
                props.selectedTraceId === info.traceId;
              const isExpanded = () =>
                props.expandedTraceIds.has(info.traceId);

              const headerContent = () => {
                const selector = isSelected() ? "> " : "  ";
                const expandIcon = isExpanded() ? "▼ " : "▶ ";
                const errorIndicator = info.hasError ? " !" : "";
                const duration = formatDurationMs(info.durationMs);
                return `${selector}${expandIcon}${info.rootSpanName} (${info.spanCount} spans, ${duration})${errorIndicator}`;
              };

              const headerColor = () => {
                if (isSelected()) return theme.bg;
                if (info.hasError) return theme.error;
                return theme.primary;
              };

              return (
                <text
                  id={`trace:${info.traceId}`}
                  style={{
                    fg: headerColor(),
                    bg: isSelected() ? theme.primary : undefined,
                  }}
                >
                  {headerContent()}
                </text>
              );
            }

            // Handle regular span nodes
            if (!node.span) return null;

            const span = node.span;
            const isSelected = () =>
              props.selectedSpanId !== null &&
              props.selectedSpanId === span.spanId;

            const statusColor = () =>
              span.status === "running" ? theme.warning : theme.success;

            // Build the row content - consistent column layout
            // 2 columns always: [tree+name] [duration]
            // 3 columns with waterfall: [tree+name] [waterfall bar] [duration]
            const rowContent = () => {
              const selector = isSelected() ? "> " : "  ";
              const prefix = getTreePrefix(node, props.expandedSpanIds);
              // Duration must be computed inside reactive function to update when span changes
              const duration = formatDuration(span);

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
                const isRunning = span.endTime === null;
                const { startOffset, endOffset } = getWaterfallOffsets(
                  span,
                  node,
                );
                const bar = renderWaterfallBar(
                  startOffset,
                  endOffset,
                  props.waterfallBarWidth,
                  isRunning,
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
