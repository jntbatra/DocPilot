import { useEffect, useState } from "react";
import { crawlSite, fetchGraph, isLive, listGraphs, selectGraph } from "../api";
import { useStore } from "../store";
import type { GraphDTO, GraphFile } from "../types";

export default function CrawlPanel({ onClose }: { onClose: () => void }) {
  const { setGraph, setError, reset } = useStore();
  const [url, setUrl] = useState("https://docs.crawl4ai.com/");
  const [depth, setDepth] = useState(2);
  const [pages, setPages] = useState(30);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [files, setFiles] = useState<GraphFile[]>([]);

  useEffect(() => { listGraphs().then(setFiles).catch(() => {}); }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !url.trim()) return;
    if (!isLive()) {
      setError("Crawling needs the backend running — start it with ./run.sh");
      return;
    }
    setBusy(true); setLog([]); setProgress(null); setError(null); reset();

    // build the graph live as pages arrive
    const live: GraphDTO = {
      nodes: [], edges: [],
      metadata: { total_nodes: 0, max_depth: 0, root_url: url, demo: false },
    };

    try {
      for await (const ev of crawlSite({
        url: url.trim(), max_depth: depth, max_pages: pages,
      })) {
        if (ev.type === "status" && ev.message) {
          setLog((l) => [...l.slice(-40), ev.message!]);
        }
        if (ev.type === "node" && ev.node) {
          live.nodes.push(ev.node);
          live.metadata.total_nodes = live.nodes.length;
          live.metadata.max_depth = Math.max(live.metadata.max_depth, ev.node.depth);
          setProgress({ done: (ev.index ?? 0) + 1, total: ev.total ?? 0 });
          if (live.nodes.length % 4 === 0) setGraph({ ...live, nodes: [...live.nodes] });
        }
        if (ev.type === "edge" && ev.edge) live.edges.push(ev.edge);
        if (ev.type === "saved") {
          setGraph({ ...live, nodes: [...live.nodes], edges: [...live.edges] });
          setLog((l) => [...l, `Saved ${ev.nodes} pages, ${ev.edges} links → ${ev.name}_kg.h5`]);
          listGraphs().then(setFiles).catch(() => {});
        }
        if (ev.type === "error") {
          setError(ev.message ?? "crawl failed");
          setLog((l) => [...l, `error: ${ev.message}`]);
        }
        if (ev.type === "done") {
          const fresh = await fetchGraph().catch(() => null);
          if (fresh) setGraph(fresh);
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "crawl failed");
    } finally {
      setBusy(false);
    }
  }

  async function pick(f: GraphFile) {
    await selectGraph(f.path);
    const g = await fetchGraph();
    setGraph(g); reset();
    setFiles(await listGraphs());
    onClose();
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Crawl a documentation site</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <form onSubmit={run} className="crawl-form">
          <input
            value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.example.com/" disabled={busy}
          />
          <div className="crawl-knobs">
            <label>depth
              <input type="number" min={1} max={5} value={depth} disabled={busy}
                     onChange={(e) => setDepth(+e.target.value)} />
            </label>
            <label>max pages
              <input type="number" min={5} max={500} step={5} value={pages} disabled={busy}
                     onChange={(e) => setPages(+e.target.value)} />
            </label>
            <button type="submit" disabled={busy || !url.trim()}>
              {busy ? "crawling…" : "Crawl"}
            </button>
          </div>
        </form>

        {!isLive() && (
          <div className="note">
            Backend is not running — crawling is disabled. Start it with
            <code>./run.sh</code> and reload.
          </div>
        )}

        {progress && (
          <div className="prog">
            <div className="prog-bar">
              <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
            <span>{progress.done} / {progress.total} pages</span>
          </div>
        )}

        {log.length > 0 && (
          <pre className="crawl-log">{log.slice(-8).join("\n")}</pre>
        )}

        {files.length > 0 && (
          <div className="saved-graphs">
            <h4>Saved graphs</h4>
            {files.map((f) => (
              <button key={f.path} className={`gfile ${f.active ? "active" : ""}`}
                      onClick={() => pick(f)} disabled={busy}>
                <span className="gf-name">{f.name}</span>
                <span className="gf-size">{f.size_mb} MB</span>
                {f.active && <span className="gf-active">active</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
