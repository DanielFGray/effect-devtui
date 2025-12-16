/**
 * Dependency Graph Module
 *
 * Builds and renders Effect Layer dependency graphs using dagre for layout
 * and ASCII box-drawing characters for terminal display.
 */

import dagre from "dagre";
import type { LayerDefinition } from "./layerResolverCore";

// ============================================================================
// Types
// ============================================================================

export interface GraphNode {
  id: string;
  label: string;
  provides: string | null;
  requires: string[];
  file: string;
  line: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isOrphan: boolean;
  isInCycle: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  points: Array<{ x: number; y: number }>;
}

export interface DependencyGraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  orphans: string[];
  cycles: string[][];
}

export interface RenderOptions {
  maxWidth?: number;
  maxHeight?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  selectedNode?: string;
  showOrphans?: boolean;
}

// ============================================================================
// Box Drawing Characters
// ============================================================================

const BOX = {
  // Corners
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  // Lines
  horizontal: "─",
  vertical: "│",
  // T-junctions
  topT: "┬",
  bottomT: "┴",
  leftT: "├",
  rightT: "┤",
  // Cross
  cross: "┼",
  // Arrows
  arrowDown: "▼",
  arrowUp: "▲",
  arrowRight: "▶",
  arrowLeft: "◀",
} as const;

// ============================================================================
// Graph Building
// ============================================================================

/**
 * Build a dagre graph from layer definitions
 */
export function buildDependencyGraph(
  layers: LayerDefinition[],
): dagre.graphlib.Graph {
  const g = new dagre.graphlib.Graph();

  // Set graph options for top-to-bottom layout
  g.setGraph({
    rankdir: "TB", // Top to bottom
    nodesep: 30, // Horizontal separation between nodes
    ranksep: 40, // Vertical separation between ranks
    marginx: 10,
    marginy: 10,
  });

  // Default edge label
  g.setDefaultEdgeLabel(() => ({}));

  // Build a map of service -> layer name for edge creation
  const serviceToLayer = new Map<string, string>();
  for (const layer of layers) {
    if (layer.provides) {
      serviceToLayer.set(layer.provides, layer.name);
    }
  }

  // Add nodes
  for (const layer of layers) {
    const labelWidth = layer.name.length + 4; // padding for box
    g.setNode(layer.name, {
      label: layer.name,
      width: labelWidth * 1.5, // Scale for character width
      height: 3, // 3 lines: top border, content, bottom border
      layer,
    });
  }

  // Add edges (from dependent layer to its requirement provider)
  for (const layer of layers) {
    for (const req of layer.requires) {
      const providerName = serviceToLayer.get(req);
      if (providerName && g.hasNode(providerName)) {
        // Edge from provider to consumer (top-down: provider is above)
        g.setEdge(providerName, layer.name);
      }
    }
  }

  return g;
}

/**
 * Detect circular dependencies using Tarjan's algorithm
 * Returns arrays of layer names that form cycles
 */
export function detectCycles(layers: LayerDefinition[]): string[][] {
  const serviceToLayer = new Map<string, string>();
  for (const layer of layers) {
    if (layer.provides) {
      serviceToLayer.set(layer.provides, layer.name);
    }
  }

  // Build adjacency list
  const adj = new Map<string, string[]>();
  for (const layer of layers) {
    const deps: string[] = [];
    for (const req of layer.requires) {
      const provider = serviceToLayer.get(req);
      if (provider) {
        deps.push(provider);
      }
    }
    adj.set(layer.name, deps);
  }

  // Tarjan's SCC algorithm
  let index = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongconnect(v: string) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) || []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);

      // Only report SCCs with more than one node (actual cycles)
      if (scc.length > 1) {
        sccs.push(scc);
      }
    }
  }

  for (const layer of layers) {
    if (!indices.has(layer.name)) {
      strongconnect(layer.name);
    }
  }

  return sccs;
}

/**
 * Find orphaned layers (defined but never required by any other layer)
 */
export function findOrphans(layers: LayerDefinition[]): string[] {
  const requiredServices = new Set<string>();
  for (const layer of layers) {
    for (const req of layer.requires) {
      requiredServices.add(req);
    }
  }

  const orphans: string[] = [];
  for (const layer of layers) {
    if (layer.provides && !requiredServices.has(layer.provides)) {
      // Check if this layer itself has no requirements (leaf node)
      // and is not required by anyone - it's truly orphaned
      orphans.push(layer.name);
    }
  }

  return orphans;
}

/**
 * Run dagre layout and extract node/edge positions
 */
export function layoutGraph(
  layers: LayerDefinition[],
): DependencyGraphLayout | null {
  if (layers.length === 0) {
    return null;
  }

  const g = buildDependencyGraph(layers);
  dagre.layout(g);

  const cycles = detectCycles(layers);
  const cycleNodes = new Set(cycles.flat());
  const orphans = findOrphans(layers);
  const orphanSet = new Set(orphans);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Extract node positions
  for (const nodeName of g.nodes()) {
    const node = g.node(nodeName);
    if (node) {
      const layerDef = (node as any).layer as LayerDefinition;
      nodes.push({
        id: nodeName,
        label: nodeName,
        provides: layerDef?.provides || null,
        requires: layerDef?.requires || [],
        file: layerDef?.file || "",
        line: layerDef?.line || 0,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        isOrphan: orphanSet.has(nodeName),
        isInCycle: cycleNodes.has(nodeName),
      });
    }
  }

  // Extract edge positions
  for (const edgeObj of g.edges()) {
    const edge = g.edge(edgeObj);
    if (edge && edge.points) {
      edges.push({
        from: edgeObj.v,
        to: edgeObj.w,
        points: edge.points,
      });
    }
  }

  const graphInfo = g.graph();

  return {
    nodes,
    edges,
    width: graphInfo?.width || 0,
    height: graphInfo?.height || 0,
    orphans,
    cycles,
  };
}

// ============================================================================
// ASCII Rendering
// ============================================================================

/**
 * Create a 2D character buffer
 */
function createBuffer(width: number, height: number): string[][] {
  const buffer: string[][] = [];
  for (let y = 0; y < height; y++) {
    buffer.push(new Array(width).fill(" "));
  }
  return buffer;
}

/**
 * Write a string to the buffer at position
 */
function writeString(
  buffer: string[][],
  x: number,
  y: number,
  str: string,
): void {
  if (y < 0 || y >= buffer.length) return;
  for (let i = 0; i < str.length; i++) {
    const col = x + i;
    if (col >= 0 && col < buffer[y].length) {
      buffer[y][col] = str[i];
    }
  }
}

/**
 * Draw a horizontal line
 */
function drawHorizontalLine(
  buffer: string[][],
  x1: number,
  x2: number,
  y: number,
  char: string = BOX.horizontal,
): void {
  if (y < 0 || y >= buffer.length) return;
  const startX = Math.min(x1, x2);
  const endX = Math.max(x1, x2);
  for (let x = startX; x <= endX; x++) {
    if (x >= 0 && x < buffer[y].length) {
      buffer[y][x] = char;
    }
  }
}

/**
 * Draw a vertical line
 */
function drawVerticalLine(
  buffer: string[][],
  x: number,
  y1: number,
  y2: number,
  char: string = BOX.vertical,
): void {
  const startY = Math.min(y1, y2);
  const endY = Math.max(y1, y2);
  for (let y = startY; y <= endY; y++) {
    if (y >= 0 && y < buffer.length && x >= 0 && x < buffer[y].length) {
      buffer[y][x] = char;
    }
  }
}

/**
 * Draw a box around text
 */
function drawBox(
  buffer: string[][],
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
): void {
  // Top border
  if (y >= 0 && y < buffer.length) {
    writeString(buffer, x, y, BOX.topLeft);
    drawHorizontalLine(buffer, x + 1, x + width - 2, y);
    writeString(buffer, x + width - 1, y, BOX.topRight);
  }

  // Middle with label
  const midY = y + Math.floor(height / 2);
  if (midY >= 0 && midY < buffer.length) {
    writeString(buffer, x, midY, BOX.vertical);
    // Center the label
    const labelStart = x + 1 + Math.floor((width - 2 - label.length) / 2);
    writeString(buffer, labelStart, midY, label);
    writeString(buffer, x + width - 1, midY, BOX.vertical);
  }

  // Bottom border
  const bottomY = y + height - 1;
  if (bottomY >= 0 && bottomY < buffer.length) {
    writeString(buffer, x, bottomY, BOX.bottomLeft);
    drawHorizontalLine(buffer, x + 1, x + width - 2, bottomY);
    writeString(buffer, x + width - 1, bottomY, BOX.bottomRight);
  }
}

/**
 * Render the graph layout to ASCII art
 * Returns an array of lines
 *
 * This uses a grid-based approach where each node gets a fixed cell size,
 * and edges are drawn between cells. Nodes are wrapped to multiple visual
 * rows when they would exceed maxWidth.
 */
export function renderToAscii(
  layout: DependencyGraphLayout,
  options: RenderOptions = {},
): string[] {
  const { maxWidth = 80 } = options;

  if (layout.nodes.length === 0) {
    return ["No layers found"];
  }

  // Fixed cell dimensions in characters
  const CELL_WIDTH = 22; // Width of each node box + padding
  const CELL_HEIGHT = 5; // Height of each node box + padding for edges
  const BOX_WIDTH = 18; // Actual box width
  const BOX_HEIGHT = 3; // Actual box height (top, middle, bottom)

  // Calculate how many nodes fit per visual row
  const nodesPerRow = Math.max(1, Math.floor(maxWidth / CELL_WIDTH));

  // Sort nodes by y position (rank) then x position
  const sortedNodes = [...layout.nodes].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 10) return a.y - b.y;
    return a.x - b.x;
  });

  // Group nodes by rank (similar y values from dagre)
  const dagreRanks: GraphNode[][] = [];
  let currentRank: GraphNode[] = [];
  let lastY = -Infinity;

  for (const node of sortedNodes) {
    if (node.y - lastY > 20) {
      if (currentRank.length > 0) {
        dagreRanks.push(currentRank);
      }
      currentRank = [node];
    } else {
      currentRank.push(node);
    }
    lastY = node.y;
  }
  if (currentRank.length > 0) {
    dagreRanks.push(currentRank);
  }

  // Sort each rank by x position
  for (const rank of dagreRanks) {
    rank.sort((a, b) => a.x - b.x);
  }

  // Now split ranks into visual rows if they exceed nodesPerRow
  // This handles the case where we have many orphan nodes on one rank
  const visualRows: Array<{ nodes: GraphNode[]; dagreRank: number }> = [];

  for (let dagreRankIdx = 0; dagreRankIdx < dagreRanks.length; dagreRankIdx++) {
    const rank = dagreRanks[dagreRankIdx];
    for (let i = 0; i < rank.length; i += nodesPerRow) {
      visualRows.push({
        nodes: rank.slice(i, i + nodesPerRow),
        dagreRank: dagreRankIdx,
      });
    }
  }

  // Calculate grid dimensions
  const gridWidth = Math.min(nodesPerRow * CELL_WIDTH, maxWidth);
  const gridHeight = visualRows.length * CELL_HEIGHT + 1;

  // Create buffer
  const buffer = createBuffer(gridWidth, gridHeight);

  // Create a map of node id to grid position
  const nodePositions = new Map<
    string,
    { col: number; row: number; x: number; y: number; dagreRank: number }
  >();

  // Draw nodes row by row
  for (let rowIdx = 0; rowIdx < visualRows.length; rowIdx++) {
    const { nodes, dagreRank } = visualRows[rowIdx];
    const y = rowIdx * CELL_HEIGHT;

    // Center the row horizontally
    const totalWidth = nodes.length * CELL_WIDTH;
    const startX = Math.max(0, Math.floor((gridWidth - totalWidth) / 2));

    for (let nodeIdx = 0; nodeIdx < nodes.length; nodeIdx++) {
      const node = nodes[nodeIdx];
      const x =
        startX +
        nodeIdx * CELL_WIDTH +
        Math.floor((CELL_WIDTH - BOX_WIDTH) / 2);

      // Store position for edge drawing
      nodePositions.set(node.id, {
        col: nodeIdx,
        row: rowIdx,
        x: x + Math.floor(BOX_WIDTH / 2), // Center x
        y: y + Math.floor(BOX_HEIGHT / 2), // Center y
        dagreRank,
      });

      // Truncate label if needed
      const maxLabelLen = BOX_WIDTH - 4;
      let label = node.label;
      if (label.length > maxLabelLen) {
        label = label.substring(0, maxLabelLen - 1) + "…";
      }

      // Draw the box
      drawBox(buffer, x, y, BOX_WIDTH, BOX_HEIGHT, label);

      // Add markers
      if (node.isInCycle) {
        writeString(buffer, x - 1, y, "*");
      }
      if (node.isOrphan) {
        writeString(buffer, x + BOX_WIDTH, y, "?");
      }
    }
  }

  // Draw edges - only draw edges between nodes on different dagre ranks
  // (edges within the same rank are typically not meaningful dependencies)
  for (const edge of layout.edges) {
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);

    if (fromPos && toPos && fromPos.dagreRank !== toPos.dagreRank) {
      // Calculate connection points
      const fromY = fromPos.row * CELL_HEIGHT + BOX_HEIGHT; // Bottom of source box
      const toY = toPos.row * CELL_HEIGHT - 1; // Just above target box
      const fromX = fromPos.x;
      const toX = toPos.x;

      if (fromY < toY) {
        // Draw vertical line down from source
        const midY = Math.floor((fromY + toY) / 2);

        // From bottom of source, go down
        drawVerticalLine(buffer, fromX, fromY, midY);

        // If horizontal offset needed, draw horizontal segment
        if (fromX !== toX) {
          drawHorizontalLine(buffer, fromX, toX, midY);
          // Add corner characters
          if (fromX < toX) {
            writeString(
              buffer,
              fromX,
              midY,
              BOX.topLeft === buffer[midY]?.[fromX] ? BOX.cross : "└",
            );
            writeString(buffer, toX, midY, "┐");
          } else {
            writeString(buffer, fromX, midY, "┘");
            writeString(buffer, toX, midY, "└");
          }
        }

        // Go down to target
        drawVerticalLine(buffer, toX, midY, toY);

        // Draw arrow pointing to target
        if (
          toY >= 0 &&
          toY < buffer.length &&
          toX >= 0 &&
          toX < buffer[toY].length
        ) {
          buffer[toY][toX] = BOX.arrowDown;
        }
      }
    }
  }

  // Convert buffer to lines, trimming trailing spaces
  return buffer.map((row) => row.join("").trimEnd());
}
