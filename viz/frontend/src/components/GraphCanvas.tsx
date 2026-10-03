import { useEffect, useMemo } from "react";
import ReactFlow, {
  Background, BackgroundVariant, Controls, MiniMap,
  useEdgesState, useNodesState, type Edge, type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import DocNode from "./DocNode";
import { layout } from "../layout";
import { nodeStates, useStore } from "../store";

const nodeTypes = { doc: DocNode };

export default function GraphCanvas() {
  const graph = useStore((s) => s.graph);
  const events = useStore((s) => s.events);
  const cursor = useStore((s) => s.cursor);
  const select = useStore((s) => s.select);

  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

  const derived = useMemo(() => nodeStates(events, cursor), [events, cursor]);

  // build once per graph
  useEffect(() => {
    if (!graph) return;
    const ns: Node[] = graph.nodes.map((n) => ({
      id: n.id, type: "doc", position: { x: 0, y: 0 },
      data: { label: n.label, depth: n.depth, keywords: n.keywords,
              chars: n.content_chars, state: "dim" },
    }));
    const es: Edge[] = graph.edges.map((e, i) => ({
      id: `e${i}`, source: e.source, target: e.target,
      type: "smoothstep",
      data: { sim: e.semantic_similarity, kw: e.common_keywords },
      style: { stroke: "#2a2a33", strokeWidth: 1 + e.semantic_similarity * 2.5 },
    }));
    setNodes(layout(ns, es));
    setEdges(es);
  }, [graph, setNodes, setEdges]);

  // repaint on stage change — no relayout, so the eye can track movement
  useEffect(() => {
    setNodes((cur) =>
      cur.map((n) => ({
        ...n,
        data: {
          ...n.data,
          state: derived.map.get(n.id) ?? "dim",
          score: derived.scores.get(n.id),
          moved: derived.moved.get(n.id),
          verdict: derived.verdicts.get(n.id),
        },
      }))
    );
    setEdges((cur) =>
      cur.map((e) => {
        const a = derived.map.get(e.source);
        const b = derived.map.get(e.target);
        const live = a && a !== "dim" && a !== "rejected" && b === "neighbour";
        return {
          ...e,
          animated: !!live,
          style: {
            ...e.style,
            stroke: live ? "#4d9de0" : "#2a2a33",
            strokeWidth: live ? 2.4 : (e.style?.strokeWidth ?? 1),
          },
        };
      })
    );
  }, [derived, setNodes, setEdges]);

  return (
    <ReactFlow
      nodes={nodes} edges={edges}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => select(n.id)}
      onPaneClick={() => select(null)}
      fitView minZoom={0.05} maxZoom={2.5}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#23232b" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable zoomable
        maskColor="rgba(10,10,14,0.75)"
        nodeColor={(n: any) => {
          const s = n.data?.state;
          return s === "rejected" ? "#8c2f2f"
            : s === "accepted" || s === "context" ? "#3f8f5f"
            : s === "neighbour" ? "#3c6f96"
            : s === "reranked" || s === "candidate" ? "#a97c3a"
            : "#26262e";
        }}
      />
    </ReactFlow>
  );
}
