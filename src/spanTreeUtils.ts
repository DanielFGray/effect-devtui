/**
 * Shared span tree utilities
 *
 * Extracted from spanTree.tsx and store.tsx to eliminate duplication of
 * trace grouping, deduplication, filtering, and child map building.
 */

import type { SimpleSpan } from "./storeTypes";

/**
 * A trace group: traceId, its spans, and identified root spans
 */
export interface TraceGroup {
  traceId: string;
  spans: SimpleSpan[];
  rootSpans: SimpleSpan[];
}

/**
 * Compare bigints for sorting (ascending)
 */
function compareBigint(a: bigint, b: bigint): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Deduplicate spans by spanId, preferring "ended" over "running" status
 */
export function deduplicateSpans(
  spans: ReadonlyArray<SimpleSpan>,
): SimpleSpan[] {
  const deduped = new Map<string, SimpleSpan>();
  for (const span of spans) {
    const existing = deduped.get(span.spanId);
    if (!existing || span.status === "ended") {
      deduped.set(span.spanId, span);
    }
  }
  return Array.from(deduped.values());
}

/**
 * Filter spans by name query (case-insensitive substring match)
 */
export function filterSpansByName(
  spans: SimpleSpan[],
  query: string | undefined,
): SimpleSpan[] {
  if (!query || !query.trim()) return spans;
  const lowerQuery = query.toLowerCase();
  return spans.filter((span) => span.name.toLowerCase().includes(lowerQuery));
}

/**
 * Build a map from parent spanId to sorted child spans
 */
export function buildChildrenMap(
  spans: SimpleSpan[],
): Map<string, SimpleSpan[]> {
  const childrenMap = new Map<string, SimpleSpan[]>();
  for (const span of spans) {
    if (span.parent) {
      const children = childrenMap.get(span.parent) || [];
      children.push(span);
      childrenMap.set(span.parent, children);
    }
  }
  for (const children of childrenMap.values()) {
    children.sort((a, b) => compareBigint(a.startTime, b.startTime));
  }
  return childrenMap;
}

/**
 * Group spans by traceId, sorted by earliest startTime.
 * Each group includes identified root spans (no parent or parent not in span set).
 */
export function groupByTrace(spans: SimpleSpan[]): TraceGroup[] {
  const spanMap = new Map(spans.map((s) => [s.spanId, s]));

  const traceGroupMap = new Map<string, SimpleSpan[]>();
  for (const span of spans) {
    const group = traceGroupMap.get(span.traceId) || [];
    group.push(span);
    traceGroupMap.set(span.traceId, group);
  }

  return Array.from(traceGroupMap.entries())
    .map(([traceId, traceSpans]) => {
      const rootSpans = traceSpans
        .filter((s) => s.parent === null || !spanMap.has(s.parent))
        .sort((a, b) => compareBigint(a.startTime, b.startTime));

      return {
        traceId,
        spans: traceSpans,
        rootSpans: rootSpans.length > 0 ? rootSpans : [traceSpans[0]],
      };
    })
    .sort((a, b) => {
      const aMin = a.spans.reduce(
        (min, s) => (s.startTime < min ? s.startTime : min),
        a.spans[0].startTime,
      );
      const bMin = b.spans.reduce(
        (min, s) => (s.startTime < min ? s.startTime : min),
        b.spans[0].startTime,
      );
      return compareBigint(aMin, bMin);
    });
}

/**
 * Prepare spans for tree traversal: deduplicate, filter, group by trace, build children map.
 * Returns all shared data structures needed by both rendering and navigation.
 */
export function prepareSpanTree(
  spans: ReadonlyArray<SimpleSpan>,
  filterQuery?: string,
): {
  traceGroups: TraceGroup[];
  childrenMap: Map<string, SimpleSpan[]>;
} {
  const uniqueSpans = deduplicateSpans(spans);
  const filteredSpans = filterSpansByName(uniqueSpans, filterQuery);
  const traceGroups = groupByTrace(filteredSpans);
  const childrenMap = buildChildrenMap(filteredSpans);
  return { traceGroups, childrenMap };
}
