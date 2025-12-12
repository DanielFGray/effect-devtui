/**
 * Span Tree View Component
 * Displays spans in a hierarchical tree structure with selection and expand/collapse
 */

import { For, Show, createMemo } from "solid-js";

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
    });

    if (hasChildren && isExpanded) {
      children.forEach((child, idx) => {
        const childIsLast = idx === children.length - 1;
        // For children, add to ancestorLines whether current node continues down
        const newAncestorLines = [...ancestorLines, !isLastChild];
        visitSpan(child, depth + 1, childIsLast, newAncestorLines);
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

  // Visit each root span
  rootSpans.forEach((root, idx) => {
    visitSpan(root, 0, idx === rootSpans.length - 1, []);
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
      fallback={<text style={{ fg: "#565f89" }}>No spans received yet</text>}
    >
      <box flexDirection="column" width="100%" padding={1}>
        <For each={visibleNodes()}>
          {(node) => {
            // Handle regular span nodes
            if (!node.span) return null;

            const isSelected = () =>
              props.selectedSpanId !== null &&
              props.selectedSpanId === node.span!.spanId;

            const statusColor = () =>
              node.span!.status === "running" ? "#e0af68" : "#9ece6a";

            const duration = formatDuration(node.span);
            const prefix = getTreePrefix(node, props.expandedSpanIds);

            return (
              <text
                id={node.span.spanId}
                style={{
                  fg: isSelected() ? "#1a1b26" : statusColor(),
                  bg: isSelected() ? "#7aa2f7" : undefined,
                }}
              >
                {`${isSelected() ? "> " : "  "}${prefix}${node.span.name}${duration ? ` (${duration})` : ""}`}
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
        <text style={{ fg: "#565f89" }}>
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
            <text style={{ fg: "#7aa2f7" }} marginBottom={1}>
              {span.name}
            </text>

            {/* IDs Section */}
            <text style={{ fg: "#9ece6a" }}>IDs:</text>
            <text style={{ fg: "#c0caf5" }} marginLeft={1}>
              {`Span:  ${span.spanId}`}
            </text>
            <text style={{ fg: "#c0caf5" }} marginLeft={1} marginBottom={1}>
              {`Trace: ${span.traceId}`}
            </text>

            {/* Status Section */}
            <text
              style={{
                fg: span.status === "running" ? "#e0af68" : "#9ece6a",
              }}
            >
              {`Status: ${span.status}${durationMs !== null ? ` (${formatDuration(span)})` : ""}`}
            </text>

            <Show when={span.parent}>
              <text style={{ fg: "#565f89" }}>{`Parent: ${span.parent}`}</text>
            </Show>

            {/* Events Section */}
            <Show when={eventCount > 0}>
              <text style={{ fg: "#9ece6a" }} marginTop={1}>
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
                      <text style={{ fg: "#f7768e" }}>
                        {`+${relativeTimeMs.toFixed(2)}ms: ${event.name}`}
                      </text>
                      <Show when={eventHasAttrs}>
                        <For
                          each={Object.entries(event.attributes).slice(0, 3)}
                        >
                          {([key, value]) => {
                            const valueStr = formatAttributeValue(value);
                            return (
                              <text style={{ fg: "#565f89" }} marginLeft={1}>
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
                <text style={{ fg: "#565f89" }} marginLeft={1}>
                  {`... and ${eventCount - 5} more`}
                </text>
              </Show>
            </Show>

            {/* Attributes Section */}
            <Show when={attrCount > 0}>
              <text style={{ fg: "#9ece6a" }} marginTop={1}>
                {`Attributes: ${attrCount}`}
              </text>
              <For each={Object.entries(span.attributes).slice(0, 8)}>
                {([key, value]) => {
                  const valueStr = formatAttributeValue(value);
                  return (
                    <text style={{ fg: "#bb9af7" }} marginLeft={1}>
                      {`${key}: ${valueStr}`}
                    </text>
                  );
                }}
              </For>
              <Show when={attrCount > 8}>
                <text style={{ fg: "#565f89" }} marginLeft={1}>
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
