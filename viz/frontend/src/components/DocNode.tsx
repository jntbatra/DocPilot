import { Handle, Position, type NodeProps } from "reactflow";
import type { NodeState } from "../types";

export interface DocNodeData {
  label: string;
  depth: number;
  keywords: string[];
  chars: number;
  state: NodeState;
  score?: number;
  moved?: number;
  verdict?: "ACCEPT" | "REJECT";
}

export default function DocNode({ data, selected }: NodeProps<DocNodeData>) {
  const s = data.state;
  return (
    <div className={`docnode state-${s} ${selected ? "sel" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="dn-top">
        <span className="dn-depth">d{data.depth}</span>
        <span className="dn-label">{data.label}</span>
      </div>
      <div className="dn-bottom">
        {data.score !== undefined && s !== "dim" && (
          <span className="dn-score">{data.score.toFixed(2)}</span>
        )}
        {data.moved !== undefined && data.moved !== 0 && (
          <span className={`dn-moved ${data.moved > 0 ? "up" : "down"}`}>
            {data.moved > 0 ? `▲${data.moved}` : `▼${Math.abs(data.moved)}`}
          </span>
        )}
        {data.verdict === "REJECT" && <span className="dn-x">REJECTED</span>}
        {s === "neighbour" && <span className="dn-nb">via graph</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
