import { useStore } from "../store";

export default function SidePanel() {
  const { graph, answer, selected, events, error } = useStore();
  const node = graph?.nodes.find((n) => n.id === selected);

  const judged = events.find((e) => e.stage === "judge");
  const expand = events.find((e) => e.stage === "expand");

  return (
    <aside className="side">
      {error && <div className="err">{error}</div>}

      {node && (
        <section className="card">
          <h3>{node.label}</h3>
          <a className="url" href={node.id} target="_blank" rel="noreferrer">{node.id}</a>
          <div className="kv"><span>depth</span><b>{node.depth}</b></div>
          <div className="kv"><span>content</span><b>{node.content_chars.toLocaleString()} chars</b></div>
          <div className="kv warn-kv">
            <span>embedded</span>
            <b>~first 1,000 chars</b>
          </div>
          <p className="hint">
            MiniLM reads 256 tokens. Anything past that was never embedded — the
            finding this visualiser makes obvious.
          </p>
          <div className="chips">
            {node.keywords.map((k) => <span key={k} className="chip">{k}</span>)}
          </div>
        </section>
      )}

      {(judged || expand) && (
        <section className="card">
          <h3>Funnel</h3>
          <div className="funnel">
            {events.filter((e) => ["retrieve","rerank","judge","expand"].includes(e.stage))
              .map((e) => (
              <div key={e.stage} className="fn-row">
                <span>{e.stage}</span>
                <div className="fn-bar">
                  <i style={{ width: `${Math.min(100, e.items.length * 3)}%` }} />
                </div>
                <b>{e.stage === "judge" ? e.meta.accepted ?? e.items.length : e.items.length}</b>
              </div>
            ))}
          </div>
        </section>
      )}

      {answer && (
        <section className="card answer">
          <h3>Answer</h3>
          <div className="md">{answer}</div>
        </section>
      )}

      {!node && !answer && (
        <section className="card muted">
          <h3>How to read this</h3>
          <ul>
            <li><b>Amber</b> — recalled by the bi-encoder</li>
            <li><b>Green</b> — survived the judge</li>
            <li><b>Red</b> — judge rejected it</li>
            <li><b>Blue</b> — pulled in by graph expansion, never ranked on its own</li>
          </ul>
          <p className="hint">
            Click any stage on the left to rewind the graph to that moment.
          </p>
        </section>
      )}
    </aside>
  );
}
