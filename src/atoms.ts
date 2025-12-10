/**
 * Atom definitions for Effect DevTools TUI
 * Centralized reactive state management using effect-atom
 */

import { Atom } from "@effect-atom/atom-react";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as Duration from "effect/Duration";
import type * as Domain from "@effect/experimental/DevTools/Domain";
import type { Client } from "./server";

/**
 * Server status atom - tracks whether the DevTools server is starting, listening, or connected
 */
export const serverStatusAtom = Atom.make<
  "starting" | "listening" | "connected"
>("starting").pipe(Atom.keepAlive);

/**
 * Help panel visibility atom - toggles the help/information panel
 */
export const showHelpAtom = Atom.make(false);

/**
 * Active clients set atom - stores all connected Effect application clients
 */
export const clientsAtom = Atom.make<HashSet.HashSet<Client>>(
  HashSet.empty(),
).pipe(Atom.keepAlive);

/**
 * Active client atom - stores the currently selected/active client
 */
export const activeClientAtom = Atom.make<Option.Option<Client>>(
  Option.none(),
).pipe(Atom.keepAlive);

/**
 * Client count atom - derived from clientsAtom, provides reactive count of connected clients
 */
export const clientCountAtom = Atom.map(clientsAtom, HashSet.size);

/**
 * Spans atom - stores the array of Effect spans from the active client
 * Keeps the last 100 spans for memory efficiency
 */
export const spansAtom = Atom.make<Array<Domain.Span>>([]).pipe(Atom.keepAlive);

/**
 * Span filtering options
 */
export interface SpanFilter {
  readonly name?: string;
  readonly minDuration?: Duration.Duration;
  readonly maxDuration?: Duration.Duration;
  readonly status?: "started" | "ended" | "all";
}

/**
 * Span filter atom - stores current filter criteria
 */
export const spanFilterAtom = Atom.make<SpanFilter>({
  status: "all",
}).pipe(Atom.keepAlive);

/**
 * Tree node representing a span in hierarchical structure
 */
export interface SpanTreeNode {
  readonly span: Domain.Span;
  children: Array<SpanTreeNode>;
  isExpanded: boolean;
  depth: number;
}

/**
 * Selected tree node atom - tracks which node is currently selected/focused
 */
export const selectedSpanIdAtom = Atom.make<Option.Option<string>>(
  Option.none(),
).pipe(Atom.keepAlive);

/**
 * Expanded span IDs atom - tracks which spans have their children visible
 */
export const expandedSpanIdsAtom = Atom.make<Set<string>>(() => new Set()).pipe(
  Atom.keepAlive,
);

/**
 * Filtered and hierarchical span tree atom
 * Computed from spans, filter, and expanded IDs
 */
export const spanTreeAtom = Atom.map(spansAtom, (spans) => {
  // We'll compute this in the component to access filter and expandedIds
  return spans;
});

/**
 * Builds hierarchical span tree from flat span array with filtering applied
 */
export function buildSpanTree(
  spans: Array<Domain.Span>,
  filter: SpanFilter,
  expandedIds: Set<string>,
): Array<SpanTreeNode> {
  // Filter spans based on criteria
  const filteredSpans = filterSpans(spans, filter);

  // Build tree structure
  const rootNodes: SpanTreeNode[] = [];
  const nodeMap = new Map<string, SpanTreeNode>();

  // First pass: create all nodes
  filteredSpans.forEach((span) => {
    const node: SpanTreeNode = {
      span,
      children: [],
      isExpanded: expandedIds.has(span.spanId),
      depth: 0,
    };
    nodeMap.set(span.spanId, node);
  });

  // Second pass: build parent-child relationships
  filteredSpans.forEach((span) => {
    const node = nodeMap.get(span.spanId)!;

    if (Option.isSome(span.parent)) {
      const parent = span.parent.value;
      if (parent._tag === "Span") {
        const parentNode = nodeMap.get(parent.spanId);
        if (parentNode) {
          // Set depth based on parent
          node.depth = parentNode.depth + 1;
          // Add to parent's children
          parentNode.children.push(node);
        } else {
          // Parent is filtered out, treat as root
          rootNodes.push(node);
        }
      } else {
        // Parent is external span, treat as root
        rootNodes.push(node);
      }
    } else {
      // No parent, it's a root node
      rootNodes.push(node);
    }
  });

  return rootNodes;
}

/**
 * Filters spans based on the provided criteria
 */
export function filterSpans(
  spans: Array<Domain.Span>,
  filter: SpanFilter,
): Array<Domain.Span> {
  return spans.filter((span) => {
    // Filter by name
    if (filter.name && !span.name.includes(filter.name)) {
      return false;
    }

    // Filter by status
    if (filter.status !== "all") {
      const isEnded = span.status._tag === "Ended";
      if (filter.status === "ended" && !isEnded) return false;
      if (filter.status === "started" && isEnded) return false;
    }

    // Filter by duration
    if (span.status._tag === "Ended") {
      const duration = Number(span.status.endTime - span.status.startTime);

      if (filter.minDuration !== undefined) {
        const minNanos = Duration.toNanos(filter.minDuration);
        if (duration < Number(minNanos)) return false;
      }

      if (filter.maxDuration !== undefined) {
        const maxNanos = Duration.toNanos(filter.maxDuration);
        if (duration > Number(maxNanos)) return false;
      }
    }

    return true;
  });
}

/**
 * Calculates the duration of a span in milliseconds
 */
export function getSpanDurationMs(span: {
  endTime: bigint | null;
  startTime: bigint;
}): number | null {
  if (span.endTime !== null) {
    return Number(span.endTime - span.startTime) / 1_000_000;
  }
  return null;
}

/**
 * Gets human-readable status text for a span
 */
export function getSpanStatusText(span: {
  status: string;
  endTime: number | null;
  startTime: number;
}): string {
  if (span.endTime !== null) {
    const durationMs = getSpanDurationMs(span);
    return durationMs !== null ? `${durationMs.toFixed(2)}ms` : "ended";
  }
  return "running";
}
