"""DocPilot visualiser backend.

Serves the knowledge graph and streams the retrieval pipeline stage by stage
so the frontend can show *why* an answer happened.

    uvicorn server:app --reload --port 8000

Runs in demo mode (synthetic graph, scripted stages, no API keys) when no
--graph is configured, so the visualiser is always demoable.
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# make the DocPilot package importable (repo root is two levels up)
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

app = FastAPI(title="DocPilot Visualiser")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

GRAPH_PATH = os.environ.get("DOCPILOT_GRAPH")   # path to {name}_kg.h5
STATE: Dict[str, Any] = {"graph": None, "rag": None,
                         "demo": GRAPH_PATH is None, "path": GRAPH_PATH}


# --------------------------------------------------------------------------
# demo graph — lets the visualiser run with zero setup
# --------------------------------------------------------------------------
def build_demo_graph() -> Dict[str, Any]:
    sections = {
        "https://docs.example.com/": ("Home", 0, ["docs", "overview", "start"]),
    }
    tree = {
        "quickstart": ["installation", "first-crawl", "configuration"],
        "core": ["async-crawler", "browser-config", "deep-crawl", "markdown"],
        "advanced": ["proxy", "hooks", "session", "extraction-strategies"],
        "api": ["arun", "arun-many", "crawler-result", "error-codes"],
    }
    kw = {
        "quickstart": ["install", "setup", "start", "pip"],
        "core": ["crawler", "async", "browser", "config"],
        "advanced": ["proxy", "hooks", "session", "strategy"],
        "api": ["api", "reference", "parameters", "returns"],
    }
    for parent, children in tree.items():
        pu = f"https://docs.example.com/{parent}/"
        sections[pu] = (parent.title(), 1, kw[parent])
        for c in children:
            sections[f"{pu}{c}/"] = (c.replace("-", " ").title(), 2, kw[parent] + [c.split("-")[0]])

    nodes = [
        {"id": url, "label": label, "depth": depth, "keywords": keys,
         "content_chars": random.randint(1200, 9000)}
        for url, (label, depth, keys) in sections.items()
    ]
    edges = []
    for url, (_, depth, keys) in sections.items():
        if depth == 0:
            continue
        parent = "/".join(url.rstrip("/").split("/")[:-1]) + "/"
        if parent in sections:
            shared = list(set(keys) & set(sections[parent][2]))
            edges.append({
                "source": parent, "target": url,
                "common_keywords": shared,
                "semantic_similarity": round(
                    len(shared) / max(len(keys), len(sections[parent][2])), 3),
            })
    return {"nodes": nodes, "edges": edges,
            "metadata": {"total_nodes": len(nodes), "max_depth": 2,
                         "root_url": "https://docs.example.com/", "demo": True}}


def load_real_graph(path: str) -> Dict[str, Any]:
    from main import load_graph_hdf5   # lives in main.py, not deepcrawl.py
    g = load_graph_hdf5(path)
    nodes = [
        {"id": url, "label": _name(url), "depth": int(n.depth),
         "keywords": [str(k) for k in (n.keywords or [])][:12],
         "content_chars": len(n.content or "")}
        for url, n in g.nodes.items()
    ]
    edges = [
        {"source": e["source"], "target": e["target"],
         "common_keywords": [str(k) for k in e.get("common_keywords", [])][:8],
         "semantic_similarity": float(e.get("semantic_similarity", 0.0))}
        for e in g.edges
    ]
    STATE["graph"] = g
    # HDF5 hands back numpy scalars — coerce so FastAPI can serialise them
    meta = {k: (int(v) if hasattr(v, "item") and not isinstance(v, str) else v)
            for k, v in dict(g.metadata).items()}
    return {"nodes": nodes, "edges": edges, "metadata": {**meta, "demo": False}}


def _name(url: str) -> str:
    part = url.rstrip("/").split("/")[-1]
    return (part.replace("-", " ").replace("_", " ").title() or "Home")[:40]


@app.get("/api/graph")
def get_graph():
    path = STATE.get("path") or GRAPH_PATH
    if STATE["demo"] or not path:
        return build_demo_graph()
    try:
        return load_real_graph(path)
    except Exception as e:
        raise HTTPException(500, f"could not load graph: {e}")


class Query(BaseModel):
    query: str
    rerank: bool = True
    judge: bool = True
    rerank_top_n: int = 30
    final_top_k: int = 10
    token_budget: Optional[int] = None


def sse(event: Dict[str, Any]) -> str:
    return f"data: {json.dumps(event)}\n\n"


async def demo_stream(q: Query):
    """Scripted stages over the demo graph — no models, no keys, same event shape."""
    g = build_demo_graph()
    urls = [n["id"] for n in g["nodes"]]
    words = set(q.query.lower().split())

    def score(n):
        overlap = len(words & set(n["keywords"]))
        return overlap * 2.0 + random.random() * 1.5

    ranked = sorted(g["nodes"], key=score, reverse=True)
    cands = ranked[: q.rerank_top_n]

    await asyncio.sleep(0.5)
    yield sse({"stage": "retrieve",
               "label": f"Bi-encoder + keyword recall → {len(cands)} candidates",
               "items": [{"url": n["id"], "score": round(score(n), 3), "rank": i + 1}
                         for i, n in enumerate(cands)],
               "meta": {"top_n": q.rerank_top_n, "query": q.query}, "elapsed_ms": 480})

    await asyncio.sleep(0.9)
    reranked = random.sample(cands, min(len(cands), q.final_top_k * 2))
    before = {n["id"]: i + 1 for i, n in enumerate(cands)}
    yield sse({"stage": "rerank",
               "label": f"Cross-encoder rerank → kept {len(reranked)}",
               "items": [{"url": n["id"], "score": round(random.uniform(-2, 8), 3),
                          "rank": i + 1, "rank_before": before.get(n["id"]),
                          "moved": before.get(n["id"], 0) - (i + 1)}
                         for i, n in enumerate(reranked)],
               "meta": {"model": "cross-encoder/ms-marco-MiniLM-L-6-v2"}, "elapsed_ms": 1400})

    await asyncio.sleep(0.9)
    judged = [{"url": n["id"], "verdict": "ACCEPT" if random.random() > 0.35 else "REJECT",
               "score": round(random.uniform(0, 8), 3)} for n in reranked]
    accepted = [j["url"] for j in judged if j["verdict"] == "ACCEPT"][: q.final_top_k]
    yield sse({"stage": "judge",
               "label": f"LLM judge → {len(accepted)} accepted, {len(judged) - len(accepted)} rejected",
               "items": judged,
               "meta": {"accepted": len(accepted), "rejected": len(judged) - len(accepted)},
               "elapsed_ms": 3100})

    await asyncio.sleep(0.7)
    nbrs = []
    for e in g["edges"]:
        if e["source"] in accepted and e["target"] not in accepted:
            nbrs.append(e["target"])
    nbrs = nbrs[:8]
    yield sse({"stage": "expand",
               "label": f"Graph expansion → {len(accepted) + len(nbrs)} nodes in context",
               "items": [{"url": u, "role": "seed"} for u in accepted]
                        + [{"url": u, "role": "neighbour"} for u in nbrs],
               "meta": {"seeds": len(accepted), "neighbours": len(nbrs),
                        "relationships": [e for e in g["edges"] if e["source"] in accepted][:10],
                        "fell_back_to_bi_encoder": False, "token_budget": q.token_budget},
               "elapsed_ms": 3400})

    await asyncio.sleep(0.8)
    yield sse({"stage": "generate", "label": "Answer generated",
               "items": [{"url": u} for u in accepted + nbrs],
               "meta": {"answer": (
                   f"**Demo mode.** This is a scripted run over a synthetic documentation "
                   f"graph, so no model was called.\n\nYour question — *{q.query}* — was routed "
                   f"through all five stages: {len(cands)} candidates recalled, reranked to "
                   f"{len(reranked)}, {len(accepted)} accepted by the judge, then expanded with "
                   f"{len(nbrs)} graph neighbours.\n\nStart the server with `DOCPILOT_GRAPH=path/to/"
                   f"name_kg.h5` and a `gemini_api_key` to run it for real.")},
               "elapsed_ms": 4200})
    yield sse({"stage": "done", "label": "Complete", "items": [], "meta": {}, "elapsed_ms": 4300})


async def real_stream(q: Query):
    from graphrag import create_graphrag
    from main import load_graph_hdf5   # lives in main.py, not deepcrawl.py
    from pipeline import InstrumentedPipeline

    if STATE["rag"] is None:
        graph = STATE["graph"] or load_graph_hdf5(STATE.get("path") or GRAPH_PATH)
        STATE["graph"] = graph
        STATE["rag"] = await create_graphrag(
            graph, os.environ.get("gemini_api_key", ""),
            token_budget=q.token_budget, rerank_enabled=q.rerank,
            judge_enabled=q.judge, rerank_top_n=q.rerank_top_n,
            final_top_k=q.final_top_k)

    rag = STATE["rag"]
    rag.rerank_enabled, rag.judge_enabled = q.rerank, q.judge
    rag.rerank_top_n, rag.final_top_k = q.rerank_top_n, q.final_top_k
    rag.token_budget = q.token_budget

    async for ev in InstrumentedPipeline(rag).run(q.query):
        yield sse(ev.to_dict())


@app.post("/api/query")
async def query(q: Query):
    gen = demo_stream(q) if STATE["demo"] else real_stream(q)
    return StreamingResponse(gen, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


class CrawlRequest(BaseModel):
    url: str
    max_depth: int = 2
    max_pages: int = 40
    name: Optional[str] = None
    output_dir: str = str(ROOT / "output")


@app.get("/api/graphs")
def list_graphs():
    """Every *_kg.h5 we can find, so the UI can switch between crawled sites."""
    out = []
    for d in {ROOT / "output", Path(os.environ.get("DOCPILOT_OUTPUT", ROOT / "output"))}:
        if not Path(d).is_dir():
            continue
        for f in sorted(Path(d).glob("*_kg.h5")):
            out.append({
                "name": f.stem.removesuffix("_kg"),
                "path": str(f),
                "size_mb": round(f.stat().st_size / 1e6, 2),
                "active": str(f) == (STATE.get("path") or GRAPH_PATH),
            })
    return {"graphs": out, "active": STATE.get("path") or GRAPH_PATH}


@app.post("/api/crawl")
async def crawl(req: CrawlRequest):
    """Crawl a docs site and stream progress; the graph is drawn as it lands."""
    from crawler import crawl_stream

    async def gen():
        async for ev in crawl_stream(req.url, req.max_depth, req.max_pages,
                                     req.output_dir, req.name):
            if ev.get("type") == "saved":
                # make the freshly crawled graph the active one
                STATE["path"] = ev["path"]
                STATE["graph"] = None
                STATE["rag"] = None
                STATE["demo"] = False
            yield sse(ev)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


class SelectRequest(BaseModel):
    path: str


@app.post("/api/select")
def select_graph(req: SelectRequest):
    if not Path(req.path).is_file():
        raise HTTPException(404, "no such graph file")
    STATE["path"] = req.path
    STATE["graph"] = None
    STATE["rag"] = None
    STATE["demo"] = False
    return {"ok": True, "active": req.path}


@app.get("/api/health")
def health():
    return {"ok": True, "demo": STATE["demo"],
            "graph": STATE.get("path") or GRAPH_PATH}
