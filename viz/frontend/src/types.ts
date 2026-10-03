export type Stage = "idle" | "retrieve" | "rerank" | "judge" | "expand" | "generate" | "done";

export interface GraphNodeDTO {
  id: string; label: string; depth: number; keywords: string[]; content_chars: number;
}
export interface GraphEdgeDTO {
  source: string; target: string; common_keywords: string[]; semantic_similarity: number;
}
export interface GraphDTO {
  nodes: GraphNodeDTO[]; edges: GraphEdgeDTO[];
  metadata: { total_nodes: number; max_depth: number; root_url: string; demo?: boolean };
}
export interface StageItem {
  url: string; score?: number; rank?: number; rank_before?: number;
  moved?: number; verdict?: "ACCEPT" | "REJECT"; role?: "seed" | "neighbour";
}
export interface StageEvent {
  stage: Stage; label: string; items: StageItem[];
  meta: Record<string, any>; elapsed_ms: number;
}
export type NodeState =
  | "dim" | "candidate" | "reranked" | "accepted" | "rejected" | "neighbour" | "context";

export interface CrawlEvent {
  type: "status" | "node" | "edge" | "saved" | "error" | "done";
  phase?: string; message?: string; index?: number; total?: number;
  node?: GraphNodeDTO; edge?: GraphEdgeDTO;
  path?: string; name?: string; nodes?: number; edges?: number;
  elapsed_ms: number;
}
export interface GraphFile {
  name: string; path: string; size_mb: number; active: boolean;
}
