import { useState } from "react";
import { streamQuery } from "../api";
import { useStore } from "../store";

const SAMPLES = [
  "How do I configure the browser?",
  "What does arun return?",
  "How do I set up a proxy?",
  "How do I limit crawl depth?",
];

export default function QueryBar() {
  const { reset, push, setRunning, setError, running } = useStore();
  const [q, setQ] = useState("");
  const [rerank, setRerank] = useState(true);
  const [judge, setJudge] = useState(true);
  const [topN, setTopN] = useState(30);
  const [topK, setTopK] = useState(10);
  const [budget, setBudget] = useState<number | "">("");

  async function run(text: string) {
    if (!text.trim() || running) return;
    reset(); setRunning(true); setError(null);
    try {
      for await (const ev of streamQuery({
        query: text, rerank, judge,
        rerank_top_n: topN, final_top_k: topK,
        token_budget: budget === "" ? null : Number(budget),
      })) push(ev);
    } catch (e: any) {
      setError(e?.message ?? "stream failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="querybar">
      <form onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Ask the documentation…" disabled={running}
        />
        <button type="submit" disabled={running || !q.trim()}>
          {running ? "…" : "Run"}
        </button>
      </form>

      <div className="samples">
        {SAMPLES.map((s) => (
          <button key={s} onClick={() => { setQ(s); run(s); }} disabled={running}>{s}</button>
        ))}
      </div>

      <div className="knobs">
        <label className={rerank ? "on" : ""}>
          <input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} />
          cross-encoder
        </label>
        <label className={judge ? "on" : ""}>
          <input type="checkbox" checked={judge} onChange={(e) => setJudge(e.target.checked)} />
          LLM judge
        </label>
        <label className="num">top_n
          <input type="number" min={5} max={200} value={topN}
                 onChange={(e) => setTopN(+e.target.value)} />
        </label>
        <label className="num">top_k
          <input type="number" min={1} max={50} value={topK}
                 onChange={(e) => setTopK(+e.target.value)} />
        </label>
        <label className="num">budget
          <input type="number" min={0} step={500} value={budget} placeholder="∞"
                 onChange={(e) => setBudget(e.target.value === "" ? "" : +e.target.value)} />
        </label>
      </div>
    </div>
  );
}
