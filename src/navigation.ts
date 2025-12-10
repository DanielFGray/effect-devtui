/**
 * Navigation helpers for trace grouping
 * Handles navigation through both trace groups and spans
 */

import type { SimpleSpan } from "./store";

/**
 * Navigable items in the trace tree
 */
export type NavigableItem =
  | { type: "trace"; traceId: string }
  | { type: "span"; span: SimpleSpan };

/**
 * Get visible items (trace groups + spans) for navigation
 */
export function getVisibleItems(
  spans: ReadonlyArray<SimpleSpan>,
  expandedSpanIds: Set<string>,
  expandedTraceIds: Set<string>,
): NavigableItem[] {
  const result: NavigableItem[] = [];
  const spanMap = new Map(spans.map((s) => [s.spanId, s]));

  // Group spans by trace ID
  const traceGroups = new Map<string, SimpleSpan[]>();
  for (const span of spans) {
    const traceSpans = traceGroups.get(span.traceId) || [];
    traceSpans.push(span);
    traceGroups.set(span.traceId, traceSpans);
  }

  // Sort traces by earliest span start time
  const sortedTraces = Array.from(traceGroups.entries()).sort((a, b) => {
    const aMin = a[1].reduce(
      (min, s) => (s.startTime < min ? s.startTime : min),
      a[1][0].startTime,
    );
    const bMin = b[1].reduce(
      (min, s) => (s.startTime < min ? s.startTime : min),
      b[1][0].startTime,
    );
    if (aMin < bMin) return -1;
    if (aMin > bMin) return 1;
    return 0;
  });

  // Build children map helper
  const buildChildrenMap = (traceSpans: SimpleSpan[]) => {
    const childrenMap = new Map<string, SimpleSpan[]>();
    for (const span of traceSpans) {
      if (span.parent) {
        const children = childrenMap.get(span.parent) || [];
        children.push(span);
        childrenMap.set(span.parent, children);
      }
    }
    return childrenMap;
  };

  // DFS to collect visible spans within a trace
  const visitSpan = (
    span: SimpleSpan,
    childrenMap: Map<string, SimpleSpan[]>,
  ) => {
    result.push({ type: "span", span });

    if (expandedSpanIds.has(span.spanId)) {
      const children = childrenMap.get(span.spanId) || [];
      children.sort((a, b) => {
        if (a.startTime < b.startTime) return -1;
        if (a.startTime > b.startTime) return 1;
        return 0;
      });
      for (const child of children) {
        visitSpan(child, childrenMap);
      }
    }
  };

  // Process each trace group
  for (const [traceId, traceSpans] of sortedTraces) {
    // Add trace group header
    result.push({ type: "trace", traceId });

    // If trace is expanded, add its spans
    if (expandedTraceIds.has(traceId)) {
      const childrenMap = buildChildrenMap(traceSpans);
      const rootSpans = traceSpans.filter(
        (s) => s.parent === null || !spanMap.has(s.parent),
      );

      rootSpans.sort((a, b) => {
        if (a.startTime < b.startTime) return -1;
        if (a.startTime > b.startTime) return 1;
        return 0;
      });

      for (const root of rootSpans) {
        visitSpan(root, childrenMap);
      }
    }
  }

  return result;
}
