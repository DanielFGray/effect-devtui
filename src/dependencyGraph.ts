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
  /** Whether this is a container node (composed of other layers) */
  isContainer: boolean;
  /** Names of child layers if this is a container */
  children: string[];
  /** Type of composition used */
  compositionType: "mergeAll" | "merge" | "provide" | "provideMerge" | "none";
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
      const isContainer = (layerDef?.composedOf?.length ?? 0) > 0;
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
        isContainer,
        children: layerDef?.composedOf ?? [],
        compositionType: layerDef?.compositionType ?? "none",
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

// Characters that are part of node boxes and should not be overwritten by edges
const BOX_CHARS = new Set<string>([
  BOX.topLeft,
  BOX.topRight,
  BOX.bottomLeft,
  BOX.bottomRight,
  BOX.leftT,
  BOX.rightT,
  BOX.topT,
  BOX.bottomT,
  BOX.cross,
]);

/**
 * Check if a character is part of a node box (should not be overwritten)
 */
function isBoxChar(char: string): boolean {
  return BOX_CHARS.has(char) || /[A-Za-z0-9…]/.test(char);
}

/**
 * Draw a horizontal line, skipping over box characters
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
      const existing = buffer[y][x];
      // Don't overwrite box characters
      if (!isBoxChar(existing)) {
        buffer[y][x] = char;
      }
    }
  }
}

/**
 * Draw a vertical line, skipping over box characters
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
      const existing = buffer[y][x];
      // Don't overwrite box characters
      if (!isBoxChar(existing)) {
        buffer[y][x] = char;
      }
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
 * Draw a container box with child boxes inside
 * Container boxes have a title at the top and nested child boxes below
 */
function drawContainerBox(
  buffer: string[][],
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  children: string[],
  innerBoxWidth: number,
  innerBoxHeight: number,
  nodesByName: Map<string, GraphNode>,
): void {
  // Top border with label
  if (y >= 0 && y < buffer.length) {
    writeString(buffer, x, y, BOX.topLeft);
    // Draw label in top border (like a title)
    const maxLabelLen = width - 4;
    let displayLabel = label;
    if (displayLabel.length > maxLabelLen) {
      displayLabel = displayLabel.substring(0, maxLabelLen - 1) + "…";
    }
    const labelStart = x + 2;
    writeString(buffer, labelStart, y, displayLabel);
    // Fill rest of top border
    for (let i = labelStart + displayLabel.length; i < x + width - 1; i++) {
      if (i >= 0 && i < buffer[y].length && buffer[y][i] === " ") {
        buffer[y][i] = BOX.horizontal;
      }
    }
    // Fill between corner and label
    for (let i = x + 1; i < labelStart; i++) {
      if (i >= 0 && i < buffer[y].length) {
        buffer[y][i] = BOX.horizontal;
      }
    }
    writeString(buffer, x + width - 1, y, BOX.topRight);
  }

  // Draw side borders for the full height
  for (let row = y + 1; row < y + height - 1; row++) {
    if (row >= 0 && row < buffer.length) {
      writeString(buffer, x, row, BOX.vertical);
      writeString(buffer, x + width - 1, row, BOX.vertical);
    }
  }

  // Draw child boxes inside the container
  const childY = y + 1; // Start children right after the title
  const childrenCount = children.length;
  const totalChildWidth = childrenCount * (innerBoxWidth + 1) - 1;
  const childStartX = x + 1 + Math.floor((width - 2 - totalChildWidth) / 2);

  for (let i = 0; i < children.length; i++) {
    const childName = children[i];
    const childX = childStartX + i * (innerBoxWidth + 1);

    // Truncate child label
    const maxChildLabelLen = innerBoxWidth - 4;
    let childLabel = childName;
    if (childLabel.length > maxChildLabelLen) {
      childLabel = childLabel.substring(0, maxChildLabelLen - 1) + "…";
    }

    // Draw smaller inner box for each child
    drawInnerBox(
      buffer,
      childX,
      childY,
      innerBoxWidth,
      innerBoxHeight,
      childLabel,
    );
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
 * Draw a smaller inner box (used for children inside containers)
 */
function drawInnerBox(
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
    for (let i = x + 1; i < x + width - 1; i++) {
      if (i >= 0 && i < buffer[y].length) {
        buffer[y][i] = BOX.horizontal;
      }
    }
    writeString(buffer, x + width - 1, y, BOX.topRight);
  }

  // Middle with label
  const midY = y + Math.floor(height / 2);
  if (midY >= 0 && midY < buffer.length) {
    writeString(buffer, x, midY, BOX.vertical);
    const labelStart = x + 1 + Math.floor((width - 2 - label.length) / 2);
    writeString(buffer, labelStart, midY, label);
    writeString(buffer, x + width - 1, midY, BOX.vertical);
  }

  // Bottom border
  const bottomY = y + height - 1;
  if (bottomY >= 0 && bottomY < buffer.length) {
    writeString(buffer, x, bottomY, BOX.bottomLeft);
    for (let i = x + 1; i < x + width - 1; i++) {
      if (i >= 0 && i < buffer[bottomY].length) {
        buffer[bottomY][i] = BOX.horizontal;
      }
    }
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
 *
 * Container nodes (merged layers) are rendered as larger boxes that contain
 * their child layers visually nested inside.
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
  const INNER_BOX_WIDTH = 14; // Width of child boxes inside containers
  const INNER_BOX_HEIGHT = 3; // Height of child boxes inside containers

  // Identify container nodes and build parent-child relationships
  const containerNodes = layout.nodes.filter(
    (n) => n.isContainer && n.children.length > 0,
  );
  const childToParent = new Map<string, string>();
  for (const container of containerNodes) {
    for (const childName of container.children) {
      childToParent.set(childName, container.id);
    }
  }

  // Filter out nodes that are children (they'll be rendered inside their container)
  const topLevelNodes = layout.nodes.filter((n) => !childToParent.has(n.id));

  // Create a lookup for all nodes by name
  const nodesByName = new Map<string, GraphNode>();
  for (const node of layout.nodes) {
    nodesByName.set(node.id, node);
  }

  // Calculate container dimensions based on number of children
  const getContainerWidth = (node: GraphNode): number => {
    if (!node.isContainer || node.children.length === 0) {
      return BOX_WIDTH;
    }
    // Width for children: each child is INNER_BOX_WIDTH + padding
    const childrenWidth = node.children.length * (INNER_BOX_WIDTH + 2) + 2;
    return Math.max(BOX_WIDTH, childrenWidth);
  };

  const getContainerHeight = (node: GraphNode): number => {
    if (!node.isContainer || node.children.length === 0) {
      return BOX_HEIGHT;
    }
    // Height: title row + padding + child boxes + padding + bottom
    return INNER_BOX_HEIGHT + 4; // title + children + margins
  };

  const getContainerCellWidth = (node: GraphNode): number => {
    return getContainerWidth(node) + 4; // Add padding
  };

  const getContainerCellHeight = (node: GraphNode): number => {
    return getContainerHeight(node) + 2; // Add padding for edges
  };

  // Sort top-level nodes by y position (rank) then x position
  const sortedNodes = [...topLevelNodes].sort((a, b) => {
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

  // Calculate max container cell width for this layout
  const maxCellWidth = Math.max(
    CELL_WIDTH,
    ...topLevelNodes.map(getContainerCellWidth),
  );

  // Calculate how many nodes fit per visual row
  const nodesPerRow = Math.max(1, Math.floor(maxWidth / maxCellWidth));

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

  // Calculate row heights (some rows may have taller container nodes)
  const rowHeights: number[] = visualRows.map(({ nodes }) =>
    Math.max(CELL_HEIGHT, ...nodes.map(getContainerCellHeight)),
  );

  // Calculate cumulative Y positions for each row
  const rowYPositions: number[] = [];
  let cumulativeY = 0;
  for (const height of rowHeights) {
    rowYPositions.push(cumulativeY);
    cumulativeY += height;
  }

  // Calculate grid dimensions
  const gridWidth = Math.min(nodesPerRow * maxCellWidth, maxWidth);
  const gridHeight = cumulativeY + 1;

  // Create buffer
  const buffer = createBuffer(gridWidth, gridHeight);

  // Create a map of node id to grid position
  const nodePositions = new Map<
    string,
    {
      col: number;
      row: number;
      x: number;
      y: number;
      dagreRank: number;
      boxHeight: number;
    }
  >();

  // Track box regions for collision detection when drawing edges
  // Maps row index to array of {xStart, xEnd} ranges where boxes are drawn
  const boxRegions = new Map<number, Array<{ xStart: number; xEnd: number }>>();

  // Draw nodes row by row
  for (let rowIdx = 0; rowIdx < visualRows.length; rowIdx++) {
    const { nodes, dagreRank } = visualRows[rowIdx];
    const y = rowYPositions[rowIdx];

    // Center the row horizontally
    const totalWidth = nodes.length * maxCellWidth;
    const startX = Math.max(0, Math.floor((gridWidth - totalWidth) / 2));

    for (let nodeIdx = 0; nodeIdx < nodes.length; nodeIdx++) {
      const node = nodes[nodeIdx];
      const boxWidth = getContainerWidth(node);
      const boxHeight = getContainerHeight(node);
      const x =
        startX +
        nodeIdx * maxCellWidth +
        Math.floor((maxCellWidth - boxWidth) / 2);

      // Store position for edge drawing
      nodePositions.set(node.id, {
        col: nodeIdx,
        row: rowIdx,
        x: x + Math.floor(boxWidth / 2), // Center x
        y: y + Math.floor(boxHeight / 2), // Center y
        dagreRank,
        boxHeight,
      });

      // Also store positions for child nodes (for edge routing purposes)
      if (node.isContainer && node.children.length > 0) {
        for (const childName of node.children) {
          const childNode = nodesByName.get(childName);
          if (childNode) {
            // Child position is the same as container for external edge routing
            nodePositions.set(childName, {
              col: nodeIdx,
              row: rowIdx,
              x: x + Math.floor(boxWidth / 2),
              y: y + Math.floor(boxHeight / 2),
              dagreRank,
              boxHeight,
            });
          }
        }
      }

      // Truncate label if needed
      const maxLabelLen = boxWidth - 4;
      let label = node.label;
      if (label.length > maxLabelLen) {
        label = label.substring(0, maxLabelLen - 1) + "…";
      }

      if (node.isContainer && node.children.length > 0) {
        // Draw container box with children inside
        drawContainerBox(
          buffer,
          x,
          y,
          boxWidth,
          boxHeight,
          label,
          node.children,
          INNER_BOX_WIDTH,
          INNER_BOX_HEIGHT,
          nodesByName,
        );
      } else {
        // Draw regular box
        drawBox(buffer, x, y, boxWidth, boxHeight, label);
      }

      // Track this box region for edge collision detection
      // Add a margin to prevent edges from drawing through or immediately adjacent to boxes
      // The margin accounts for centering differences between rows with different node counts
      if (!boxRegions.has(rowIdx)) {
        boxRegions.set(rowIdx, []);
      }
      boxRegions.get(rowIdx)!.push({ xStart: x - 4, xEnd: x + boxWidth + 3 });

      // Add markers
      if (node.isInCycle) {
        writeString(buffer, x - 1, y, "*");
      }
      if (node.isOrphan) {
        writeString(buffer, x + boxWidth, y, "?");
      }
    }
  }

  // Draw edges - only draw edges between nodes on different dagre ranks
  // (edges within the same rank are typically not meaningful dependencies)

  // Helper function to check if an X position collides with any box in a given row
  const xCollidesWithBoxInRow = (x: number, rowIdx: number): boolean => {
    const regions = boxRegions.get(rowIdx);
    if (!regions) return false;
    return regions.some((region) => x >= region.xStart && x <= region.xEnd);
  };

  // Helper to find which row a Y coordinate belongs to
  const findRowForY = (
    yCoord: number,
  ): { rowIdx: number; rowStartY: number; rowHeight: number } | null => {
    for (let i = 0; i < rowYPositions.length; i++) {
      const rowStartY = rowYPositions[i];
      const rowHeight = rowHeights[i];
      if (yCoord >= rowStartY && yCoord < rowStartY + rowHeight) {
        return { rowIdx: i, rowStartY, rowHeight };
      }
    }
    return null;
  };

  // Helper function to draw a vertical line, skipping Y positions where X collides with a box
  const drawVerticalLineAvoidingBoxes = (
    x: number,
    y1: number,
    y2: number,
  ): void => {
    const startY = Math.min(y1, y2);
    const endY = Math.max(y1, y2);
    for (let yCoord = startY; yCoord <= endY; yCoord++) {
      // Determine which visual row this Y position belongs to
      const rowInfo = findRowForY(yCoord);
      if (rowInfo) {
        const { rowIdx, rowStartY } = rowInfo;
        const positionInRow = yCoord - rowStartY;
        const rowBoxHeight = rowHeights[rowIdx] - 2; // Approximate box height for this row

        // Only check for collision if we're in the box area of the row
        if (positionInRow < rowBoxHeight) {
          if (xCollidesWithBoxInRow(x, rowIdx)) {
            // Skip drawing at this position - it would go through a box
            continue;
          }
        }
      }

      if (
        yCoord >= 0 &&
        yCoord < buffer.length &&
        x >= 0 &&
        x < buffer[yCoord].length
      ) {
        const existing = buffer[yCoord][x];
        if (!isBoxChar(existing)) {
          buffer[yCoord][x] = BOX.vertical;
        }
      }
    }
  };

  for (const edge of layout.edges) {
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);

    if (fromPos && toPos && fromPos.dagreRank !== toPos.dagreRank) {
      // Calculate connection points using dynamic row positions
      const fromRowY = rowYPositions[fromPos.row] ?? 0;
      const toRowY = rowYPositions[toPos.row] ?? 0;
      const fromBoxHeight = fromPos.boxHeight;
      const toBoxHeight = toPos.boxHeight;

      const fromY = fromRowY + fromBoxHeight; // Bottom of source box
      const toY = toRowY - 1; // Just above target box
      const fromX = fromPos.x;
      const toX = toPos.x;

      if (fromY < toY) {
        // Draw vertical line down from source
        // Calculate midY as the midpoint between source bottom and target top
        const midY = Math.floor((fromY + toY) / 2);

        // From bottom of source, go down
        drawVerticalLineAvoidingBoxes(fromX, fromY, midY);

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
        drawVerticalLineAvoidingBoxes(toX, midY, toY);

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
