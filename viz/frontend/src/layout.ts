import dagre from "dagre";
import type { Node, Edge } from "reactflow";

const W = 190;
const H = 62;

/** Left-to-right hierarchical layout — mirrors the crawl's depth structure. */
export function layout(nodes: Node[], edges: Edge[], dir: "LR" | "TB" = "LR") {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: dir, nodesep: 26, ranksep: 130, marginx: 40, marginy: 40 });

  nodes.forEach((n) => g.setNode(n.id, { width: W, height: H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    return {
      ...n,
      position: { x: p.x - W / 2, y: p.y - H / 2 },
      targetPosition: dir === "LR" ? "left" : "top",
      sourcePosition: dir === "LR" ? "right" : "bottom",
    } as Node;
  });
}
