/**
 * Dependency graph helpers backed by Effect Graph + beautiful-mermaid.
 */

import { Graph } from "effect";
import { renderMermaidAscii } from "beautiful-mermaid";
import type { LayerDefinition } from "./layerResolverCore";

export interface DependencyGraphLayout {
  mermaid: string;
  cycles: string[][];
  orphans: string[];
  layerCount: number;
}

export interface RenderOptions {
  maxWidth?: number;
  maxHeight?: number;
  selectedNode?: string;
  showOrphans?: boolean;
}

function buildServiceToLayer(layers: LayerDefinition[]): Map<string, string> {
  const serviceToLayer = new Map<string, string>();
  for (const layer of layers) {
    if (layer.provides) {
      serviceToLayer.set(layer.provides, layer.name);
    }
  }
  return serviceToLayer;
}

function buildGraph(layers: LayerDefinition[]) {
  const serviceToLayer = buildServiceToLayer(layers);

  return Graph.directed<LayerDefinition, string>((mutable) => {
    const nodeIndexByName = new Map<string, number>();

    for (const layer of layers) {
      const index = Graph.addNode(mutable, layer);
      nodeIndexByName.set(layer.name, index);
    }

    for (const layer of layers) {
      const targetIndex = nodeIndexByName.get(layer.name);
      if (targetIndex === undefined) continue;

      for (const requirement of layer.requires) {
        const providerName = serviceToLayer.get(requirement);
        if (!providerName) continue;

        const sourceIndex = nodeIndexByName.get(providerName);
        if (sourceIndex === undefined) continue;

        Graph.addEdge(mutable, sourceIndex, targetIndex, requirement);
      }
    }
  });
}

export function detectCycles(layers: LayerDefinition[]): string[][] {
  if (layers.length === 0) return [];

  const graph = buildGraph(layers);
  const sccs = Graph.stronglyConnectedComponents(graph);

  return sccs
    .filter((component) => component.length > 1)
    .map((component) =>
      component
        .map((index) => graph.nodes.get(index)?.name)
        .filter((name): name is string => Boolean(name))
        .sort(),
    );
}

export function findOrphans(layers: LayerDefinition[]): string[] {
  const requiredServices = new Set<string>();
  for (const layer of layers) {
    for (const requirement of layer.requires) {
      requiredServices.add(requirement);
    }
  }

  return layers
    .filter((layer) => layer.provides && !requiredServices.has(layer.provides))
    .map((layer) => layer.name);
}

export function layoutGraph(layers: LayerDefinition[]): DependencyGraphLayout | null {
  if (layers.length === 0) return null;

  const graph = buildGraph(layers);
  const cycles = detectCycles(layers);
  const orphans = findOrphans(layers);
  const cycleSet = new Set(cycles.flat());
  const orphanSet = new Set(orphans);

  const mermaid = Graph.toMermaid(graph, {
    diagramType: "flowchart",
    direction: "TB",
    edgeLabel: () => "",
    nodeLabel: (layer) => {
      const cycleTag = cycleSet.has(layer.name) ? " [cycle]" : "";
      const orphanTag = orphanSet.has(layer.name) ? " [orphan]" : "";
      return `${layer.name}${cycleTag}${orphanTag}`;
    },
    nodeShape: (layer) =>
      layer.composedOf.length > 0 ? "subroutine" : "rounded",
  });

  return {
    mermaid,
    cycles,
    orphans,
    layerCount: layers.length,
  };
}

export function renderToAscii(
  layout: DependencyGraphLayout,
  options: RenderOptions = {},
): string[] {
  const { maxWidth = 72, maxHeight } = options;

  try {
    const rendered = renderMermaidAscii(layout.mermaid, {
      useAscii: false,
      paddingX: 2,
      paddingY: 1,
      boxBorderPadding: 1,
    });

    const lines = rendered
      .split("\n")
      .map((line) => (line.length > maxWidth ? `${line.slice(0, maxWidth - 1)}…` : line));

    return maxHeight ? lines.slice(0, maxHeight) : lines;
  } catch {
    return ["Failed to render graph"]; 
  }
}
