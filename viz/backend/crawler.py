"""Crawl a documentation site from the UI and stream progress.

Wraps deepcrawl.deep_crawl() without modifying it: the crawl itself runs in a
worker thread while we emit heartbeats, then each resulting page is emitted as
its own event so the frontend can draw the graph node by node as it lands.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, AsyncIterator, Dict, Optional

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def slugify(url: str) -> str:
    s = re.sub(r"^https?://", "", url).strip("/")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:60] or "site"


def _name(url: str) -> str:
    part = url.rstrip("/").split("/")[-1]
    return (part.replace("-", " ").replace("_", " ").title() or "Home")[:40]


async def crawl_stream(
    url: str,
    max_depth: int,
    max_pages: int,
    output_dir: str,
    name: Optional[str] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Yield progress dicts: status | node | edge | saved | error | done."""
    t0 = time.time()
    ms = lambda: int((time.time() - t0) * 1000)

    name = name or slugify(url)
    out = Path(output_dir).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{name}_kg.h5"

    yield {"type": "status", "phase": "starting",
           "message": f"Crawling {url} — depth {max_depth}, max {max_pages} pages",
           "elapsed_ms": ms()}

    try:
        import deepcrawl
    except Exception as e:
        yield {"type": "error",
               "message": f"DocPilot dependencies not installed in the venv: {e}",
               "elapsed_ms": ms()}
        return

    # deep_crawl() does TextRank + embedding *synchronously* inside an async
    # function, which would block this server's event loop for the whole crawl
    # (health checks time out, the UI thinks the backend died). So run the whole
    # thing on its own loop in a worker thread and keep this one free.
    def _run_in_thread():
        return asyncio.run(deepcrawl.deep_crawl(url, max_depth, max_pages))

    task = asyncio.create_task(asyncio.to_thread(_run_in_thread))

    while not task.done():
        await asyncio.sleep(1.0)
        if not task.done():
            secs = int(time.time() - t0)
            yield {"type": "status", "phase": "crawling",
                   "message": f"Crawling… {secs}s elapsed"
                              + (" (large sites take a while — TextRank runs per page)"
                                 if secs > 45 else ""),
                   "elapsed_ms": ms()}

    try:
        graph = task.result()
    except Exception as e:
        yield {"type": "error", "message": f"crawl failed: {e}", "elapsed_ms": ms()}
        return

    nodes = list(graph.nodes.items())
    yield {"type": "status", "phase": "building",
           "message": f"Crawled {len(nodes)} pages — building graph",
           "total": len(nodes), "elapsed_ms": ms()}

    # emit nodes progressively so the UI can animate the graph forming
    for i, (u, n) in enumerate(nodes):
        yield {"type": "node", "index": i, "total": len(nodes),
               "node": {"id": u, "label": _name(u), "depth": int(n.depth),
                        "keywords": [str(k) for k in (n.keywords or [])][:12],
                        "content_chars": len(n.content or "")},
               "elapsed_ms": ms()}
        if i % 5 == 0:
            await asyncio.sleep(0)   # let the event loop flush

    for e in graph.edges:
        yield {"type": "edge",
               "edge": {"source": e["source"], "target": e["target"],
                        "common_keywords": [str(k) for k in e.get("common_keywords", [])][:8],
                        "semantic_similarity": float(e.get("semantic_similarity", 0.0))},
               "elapsed_ms": ms()}

    yield {"type": "status", "phase": "saving",
           "message": f"Writing {target.name}", "elapsed_ms": ms()}
    try:
        await asyncio.to_thread(deepcrawl.save_graph_hdf5, graph, str(target))
    except Exception as e:
        yield {"type": "error", "message": f"save failed: {e}", "elapsed_ms": ms()}
        return

    yield {"type": "saved", "path": str(target), "name": name,
           "nodes": len(graph.nodes), "edges": len(graph.edges), "elapsed_ms": ms()}
    yield {"type": "done", "elapsed_ms": ms()}
