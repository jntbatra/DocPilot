import { useEffect, useState } from "react";
import { ReactFlowProvider } from "reactflow";
import GraphCanvas from "./components/GraphCanvas";
import QueryBar from "./components/QueryBar";
import SidePanel from "./components/SidePanel";
import StagePanel from "./components/StagePanel";
import CrawlPanel from "./components/CrawlPanel";
import { fetchGraph, isLive } from "./api";
import { useStore } from "./store";

export default function App() {
  const { graph, setGraph, setError } = useStore();
  const [crawlOpen, setCrawlOpen] = useState(false);

  useEffect(() => {
    fetchGraph().then(setGraph).catch((e) => setError(e.message));
  }, [setGraph, setError]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="dot" />
          DocPilot
          <span className="tag">GraphRAG retrieval, visualised</span>
        </div>
        {graph && (
          <div className="stats">
            <button className="crawl-btn" onClick={() => setCrawlOpen(true)}>+ Crawl a site</button>
            <span><b>{graph.metadata.total_nodes}</b> pages</span>
            <span><b>{graph.edges.length}</b> links</span>
            <span>depth <b>{graph.metadata.max_depth}</b></span>
            {graph.metadata.demo && <span className="demo">demo graph</span>}
            <span className={isLive() ? "live" : "offline"}>{isLive() ? "backend live" : "browser only"}</span>
            <a className="gh" href="https://github.com/jntbatra/DocPilot" target="_blank" rel="noreferrer">source</a>
          </div>
        )}
      </header>

      <div className="body">
        <div className="left">
          <QueryBar />
          <StagePanel />
        </div>
        <main className="canvas">
          <ReactFlowProvider>
            <GraphCanvas />
          </ReactFlowProvider>
        </main>
        <SidePanel />
      </div>
      {crawlOpen && <CrawlPanel onClose={() => setCrawlOpen(false)} />}
    </div>
  );
}
