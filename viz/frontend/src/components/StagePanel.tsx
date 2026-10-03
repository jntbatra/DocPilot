import { useStore } from "../store";
import type { Stage } from "../types";

const STAGES: { key: Stage; name: string; sub: string }[] = [
  { key: "retrieve", name: "Recall",  sub: "bi-encoder + keywords" },
  { key: "rerank",   name: "Rerank",  sub: "cross-encoder" },
  { key: "judge",    name: "Judge",   sub: "accept / reject" },
  { key: "expand",   name: "Expand",  sub: "graph neighbours" },
  { key: "generate", name: "Generate",sub: "Gemini" },
];

export default function StagePanel() {
  const { events, cursor, setCursor, running } = useStore();
  const seen = new Map(events.map((e, i) => [e.stage, i]));
  const current = events[cursor];

  return (
    <div className="stages">
      <div className="stage-rail">
        {STAGES.map((s, i) => {
          const idx = seen.get(s.key);
          const done = idx !== undefined;
          const active = done && idx === cursor;
          const ev = done ? events[idx!] : null;
          return (
            <button
              key={s.key}
              className={`stage ${done ? "done" : "pending"} ${active ? "active" : ""}`}
              disabled={!done}
              onClick={() => idx !== undefined && setCursor(idx)}
            >
              <span className="stage-num">{i + 1}</span>
              <span className="stage-body">
                <span className="stage-name">{s.name}</span>
                <span className="stage-sub">{ev ? ev.label : s.sub}</span>
              </span>
              {ev && <span className="stage-ms">{ev.elapsed_ms}ms</span>}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="stage-detail">
          <div className="sd-head">
            {current.stage.toUpperCase()}
            <span>{current.items.length} items</span>
          </div>
          <div className="sd-list">
            {current.items.slice(0, 40).map((it, i) => (
              <div key={i} className={`sd-row ${it.verdict === "REJECT" ? "rej" : ""}`}>
                <span className="sd-rank">{it.rank ?? i + 1}</span>
                <span className="sd-url" title={it.url}>{shorten(it.url)}</span>
                {it.moved !== undefined && it.moved !== 0 && (
                  <span className={`sd-move ${it.moved > 0 ? "up" : "down"}`}>
                    {it.moved > 0 ? `▲${it.moved}` : `▼${Math.abs(it.moved)}`}
                  </span>
                )}
                {it.verdict && <span className={`sd-v ${it.verdict.toLowerCase()}`}>{it.verdict[0]}</span>}
                {it.role && <span className="sd-role">{it.role}</span>}
                {it.score !== undefined && <span className="sd-score">{it.score.toFixed(2)}</span>}
              </div>
            ))}
          </div>
          {current.meta?.fell_back_to_bi_encoder && (
            <div className="sd-warn">
              Judge rejected everything — pipeline fell back to raw bi-encoder ranking.
              This is why it can never refuse.
            </div>
          )}
        </div>
      )}
      {running && <div className="running">running…</div>}
    </div>
  );
}

function shorten(u: string) {
  return u.replace(/^https?:\/\//, "").replace(/\/$/, "").split("/").slice(-2).join("/");
}
