/** Client-side demo: the same graph + the same five-stage event shape the
 *  backend emits, generated in the browser. Lets the visualiser be deployed
 *  as a pure static site with no server behind it. */
import type { GraphDTO, StageEvent } from "./types";

const TREE: Record<string, string[]> = {
  quickstart: ["installation", "first-crawl", "configuration"],
  core: ["async-crawler", "browser-config", "deep-crawl", "markdown-generator"],
  advanced: ["proxy-rotation", "hooks", "session-management", "extraction-strategies"],
  api: ["arun", "arun-many", "crawler-result", "error-codes"],
  guides: ["rate-limiting", "authentication"],
};
const KW: Record<string, string[]> = {
  quickstart: ["install", "setup", "start", "pip", "quickstart"],
  core: ["crawler", "async", "browser", "config", "markdown"],
  advanced: ["proxy", "hooks", "session", "strategy", "extraction"],
  api: ["api", "reference", "parameters", "returns", "result"],
  guides: ["rate", "limit", "auth", "token", "guide"],
};
const ROOT = "https://docs.example.com/";

export function demoGraph(): GraphDTO {
  const nodes: GraphDTO["nodes"] = [
    { id: ROOT, label: "Home", depth: 0, keywords: ["docs", "overview", "start"], content_chars: 3400 },
  ];
  const edges: GraphDTO["edges"] = [];

  for (const [section, children] of Object.entries(TREE)) {
    const su = `${ROOT}${section}/`;
    nodes.push({ id: su, label: title(section), depth: 1, keywords: KW[section], content_chars: rnd(2000, 6000) });
    edges.push(link(ROOT, su, nodes[0].keywords, KW[section]));
    for (const c of children) {
      const cu = `${su}${c}/`;
      const kws = [...KW[section].slice(0, 3), ...c.split("-")];
      nodes.push({ id: cu, label: title(c.replace(/-/g, " ")), depth: 2, keywords: kws, content_chars: rnd(1200, 11000) });
      edges.push(link(su, cu, KW[section], kws));
    }
  }
  return { nodes, edges, metadata: { total_nodes: nodes.length, max_depth: 2, root_url: ROOT, demo: true } };
}

function link(a: string, b: string, ka: string[], kb: string[]): GraphDTO["edges"][number] {
  const shared = ka.filter((k) => kb.includes(k));
  return { source: a, target: b, common_keywords: shared,
           semantic_similarity: +(shared.length / Math.max(ka.length, kb.length)).toFixed(3) };
}
const title = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
const rnd = (a: number, b: number) => Math.floor(a + Math.random() * (b - a));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Yields the same StageEvents the server would, with realistic pauses. */
export async function* demoStream(opts: {
  query: string; rerank: boolean; judge: boolean;
  rerank_top_n: number; final_top_k: number; token_budget: number | null;
}): AsyncGenerator<StageEvent> {
  const g = demoGraph();
  const words = new Set(opts.query.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean));

  const score = (n: GraphDTO["nodes"][number]) => {
    const overlap = n.keywords.filter((k) => words.has(k)).length;
    const labelHit = n.label.toLowerCase().split(" ").some((w) => words.has(w)) ? 1 : 0;
    return overlap * 2.0 + labelHit * 1.6 + Math.random() * 1.5;
  };

  const ranked = [...g.nodes].sort((a, b) => score(b) - score(a));
  const cands = ranked.slice(0, opts.rerank_top_n);

  await sleep(520);
  yield { stage: "retrieve", label: `Bi-encoder + keyword recall → ${cands.length} candidates`,
    items: cands.map((n, i) => ({ url: n.id, score: +score(n).toFixed(3), rank: i + 1 })),
    meta: { top_n: opts.rerank_top_n, query: opts.query }, elapsed_ms: 520 };

  let pool = cands;
  const before = new Map(cands.map((n, i) => [n.id, i + 1]));

  if (opts.rerank) {
    await sleep(880);
    // cross-encoder shuffles meaningfully: deeper, longer pages tend to win
    pool = [...cands].sort((a, b) =>
      (b.keywords.filter((k) => words.has(k)).length * 3 + b.depth + Math.random() * 2) -
      (a.keywords.filter((k) => words.has(k)).length * 3 + a.depth + Math.random() * 2)
    ).slice(0, opts.final_top_k * 2);
    yield { stage: "rerank", label: `Cross-encoder rerank → kept ${pool.length}`,
      items: pool.map((n, i) => ({ url: n.id, score: +(Math.random() * 9 - 1).toFixed(3), rank: i + 1,
        rank_before: before.get(n.id), moved: (before.get(n.id) ?? 0) - (i + 1) })),
      meta: { model: "cross-encoder/ms-marco-MiniLM-L-6-v2" }, elapsed_ms: 1400 };
  }

  let accepted = pool.slice(0, opts.final_top_k).map((n) => n.id);
  if (opts.judge) {
    await sleep(1100);
    const judged = pool.map((n) => {
      const hit = n.keywords.filter((k) => words.has(k)).length > 0;
      const verdict: "ACCEPT" | "REJECT" = hit || Math.random() > 0.6 ? "ACCEPT" : "REJECT";
      return { url: n.id, verdict, score: +(Math.random() * 8).toFixed(3) };
    });
    accepted = judged.filter((j) => j.verdict === "ACCEPT").map((j) => j.url).slice(0, opts.final_top_k);
    yield { stage: "judge",
      label: `LLM judge → ${accepted.length} accepted, ${judged.length - accepted.length} rejected`,
      items: judged,
      meta: { accepted: accepted.length, rejected: judged.length - accepted.length }, elapsed_ms: 3200 };
  }

  await sleep(700);
  const seeds = new Set(accepted);
  const nbrs: string[] = [];
  for (const e of g.edges) {
    if (seeds.has(e.source) && !seeds.has(e.target) && !nbrs.includes(e.target)) nbrs.push(e.target);
    if (seeds.has(e.target) && !seeds.has(e.source) && !nbrs.includes(e.source)) nbrs.push(e.source);
  }
  const neighbours = nbrs.slice(0, 8);
  yield { stage: "expand", label: `Graph expansion → ${accepted.length + neighbours.length} nodes in context`,
    items: [...accepted.map((u) => ({ url: u, role: "seed" as const })),
            ...neighbours.map((u) => ({ url: u, role: "neighbour" as const }))],
    meta: { seeds: accepted.length, neighbours: neighbours.length,
            relationships: g.edges.filter((e) => seeds.has(e.source)).slice(0, 10),
            fell_back_to_bi_encoder: accepted.length === 0, token_budget: opts.token_budget },
    elapsed_ms: 3500 };

  await sleep(850);
  yield { stage: "generate", label: "Answer generated",
    items: [...accepted, ...neighbours].map((u) => ({ url: u })),
    meta: { answer:
`Demo mode — no model was called. This is a synthetic documentation graph so the visualiser works with no backend and no API keys.

Your question: "${opts.query}"

Pipeline: ${cands.length} candidates recalled → ${opts.rerank ? `reranked to ${pool.length}` : "rerank skipped"} → ${opts.judge ? `${accepted.length} accepted by the judge` : "judge skipped"} → ${neighbours.length} neighbours added by graph expansion.

The ${neighbours.length} blue nodes never ranked on their own. They reached the answer only because the graph connected them to a page that did — which is the entire argument for GraphRAG over flat vector search.

Try it again with the judge switched off and watch how much noise reaches the prompt.` },
    elapsed_ms: 4300 };

  await sleep(150);
  yield { stage: "done", label: "Complete", items: [], meta: {}, elapsed_ms: 4450 };
}
