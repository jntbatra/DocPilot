import { create } from "zustand";
import type { GraphDTO, NodeState, StageEvent } from "./types";

interface S {
  graph: GraphDTO | null;
  events: StageEvent[];
  cursor: number;            // which stage is being displayed
  running: boolean;
  answer: string;
  error: string | null;
  selected: string | null;
  setGraph: (g: GraphDTO) => void;
  reset: () => void;
  push: (e: StageEvent) => void;
  setCursor: (i: number) => void;
  setRunning: (b: boolean) => void;
  setError: (e: string | null) => void;
  select: (id: string | null) => void;
}

export const useStore = create<S>((set) => ({
  graph: null, events: [], cursor: -1, running: false,
  answer: "", error: null, selected: null,
  setGraph: (g) => set({ graph: g }),
  reset: () => set({ events: [], cursor: -1, answer: "", error: null }),
  push: (e) => set((s) => ({
    events: [...s.events, e],
    cursor: s.events.length,
    answer: e.stage === "generate" ? (e.meta.answer ?? s.answer) : s.answer,
  })),
  setCursor: (i) => set({ cursor: i }),
  setRunning: (b) => set({ running: b }),
  setError: (e) => set({ error: e }),
  select: (id) => set({ selected: id }),
}));

/** Node visual state at the currently displayed stage — this is what makes the
 *  graph tell the story rather than just sit there. */
export function nodeStates(events: StageEvent[], cursor: number) {
  const map = new Map<string, NodeState>();
  const scores = new Map<string, number>();
  const moved = new Map<string, number>();
  const verdicts = new Map<string, "ACCEPT" | "REJECT">();

  events.slice(0, cursor + 1).forEach((ev) => {
    if (ev.stage === "retrieve") {
      ev.items.forEach((i) => { map.set(i.url, "candidate"); scores.set(i.url, i.score ?? 0); });
    }
    if (ev.stage === "rerank") {
      ev.items.forEach((i) => {
        map.set(i.url, "reranked");
        scores.set(i.url, i.score ?? 0);
        if (i.moved !== undefined) moved.set(i.url, i.moved);
      });
    }
    if (ev.stage === "judge") {
      ev.items.forEach((i) => {
        verdicts.set(i.url, i.verdict ?? "ACCEPT");
        map.set(i.url, i.verdict === "REJECT" ? "rejected" : "accepted");
      });
    }
    if (ev.stage === "expand") {
      ev.items.forEach((i) => {
        if (i.role === "neighbour") map.set(i.url, "neighbour");
        else map.set(i.url, "accepted");
      });
    }
    if (ev.stage === "generate") {
      ev.items.forEach((i) => {
        const cur = map.get(i.url);
        if (cur !== "rejected") map.set(i.url, "context");
      });
    }
  });
  return { map, scores, moved, verdicts };
}
