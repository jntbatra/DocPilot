"""Instrumented GraphRAG pipeline that emits an event per stage.

Wraps the existing GraphRAGSystem so the visualiser can show *why* an answer
happened: which nodes were candidates, how the cross-encoder reordered them,
what the judge rejected, and which neighbours the graph pulled in.

The real pipeline in graphrag.py returns only the final answer. This one yields
the same computation as a stream of events without changing that file.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, asdict
from typing import Any, AsyncIterator, Dict, List, Optional

from rerank import RankedCandidate


@dataclass
class StageEvent:
    stage: str                 # retrieve | rerank | judge | expand | generate | done
    label: str
    items: List[Dict[str, Any]]
    meta: Dict[str, Any]
    elapsed_ms: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class InstrumentedPipeline:
    """Runs the same five stages as GraphRAGSystem.retrieve_and_generate,
    yielding a StageEvent after each one."""

    def __init__(self, rag):
        self.rag = rag

    async def run(self, query: str) -> AsyncIterator[StageEvent]:
        t0 = time.time()

        def ms() -> int:
            return int((time.time() - t0) * 1000)

        # ---- Stage 1: bi-encoder + keyword recall -------------------------
        candidate_urls = await self.rag._find_relevant_urls(query, self.rag.rerank_top_n)
        candidates = [
            RankedCandidate(
                url=url,
                content=self.rag.entities[url].content_snippet if url in self.rag.entities else "",
                bi_encoder_score=float(score),
            )
            for url, score in candidate_urls
        ]
        yield StageEvent(
            stage="retrieve",
            label=f"Bi-encoder + keyword recall → {len(candidates)} candidates",
            items=[
                {"url": c.url, "score": round(c.bi_encoder_score, 4), "rank": i + 1}
                for i, c in enumerate(candidates)
            ],
            meta={"top_n": self.rag.rerank_top_n, "query": query},
            elapsed_ms=ms(),
        )

        # ---- Stage 2: cross-encoder rerank --------------------------------
        before = {c.url: i + 1 for i, c in enumerate(candidates)}
        if self.rag.rerank_enabled and candidates:
            candidates = await asyncio.to_thread(
                self.rag.reranker.rerank, query, candidates, self.rag.final_top_k * 2
            )
            yield StageEvent(
                stage="rerank",
                label=f"Cross-encoder rerank → kept {len(candidates)}",
                items=[
                    {
                        "url": c.url,
                        "score": round(float(c.rerank_score or 0), 4),
                        "rank": i + 1,
                        "rank_before": before.get(c.url),
                        "moved": (before.get(c.url) or 0) - (i + 1),
                    }
                    for i, c in enumerate(candidates)
                ],
                meta={"model": getattr(self.rag.reranker, "model_name", "cross-encoder")},
                elapsed_ms=ms(),
            )

        # ---- Stage 3: LLM judge -------------------------------------------
        judged: List[Dict[str, Any]] = []
        if self.rag.judge_enabled and candidates:
            accepted: List[RankedCandidate] = []
            for c in candidates:
                verdict = await asyncio.to_thread(self.rag.judge.judge, query, c)
                c.judge_verdict = verdict
                judged.append({"url": c.url, "verdict": verdict,
                               "score": round(float(c.rerank_score or 0), 4)})
                if verdict == "ACCEPT":
                    accepted.append(c)
            candidates = accepted
            yield StageEvent(
                stage="judge",
                label=f"LLM judge → {len(accepted)} accepted, {len(judged) - len(accepted)} rejected",
                items=judged,
                meta={"accepted": len(accepted), "rejected": len(judged) - len(accepted)},
                elapsed_ms=ms(),
            )

        relevant_urls = [c.url for c in candidates[: self.rag.final_top_k]]
        fell_back = False
        if not relevant_urls:
            # mirrors graphrag.py: never return zero context
            relevant_urls = [u for u, _ in candidate_urls[: self.rag.final_top_k]]
            fell_back = True

        # ---- Stage 4: graph expansion --------------------------------------
        expanded = self.rag._expand_context_with_graph(relevant_urls)
        seed_set = set(relevant_urls)
        expanded_urls = [
            e.source_urls[0] for e in expanded.get("entities", []) if e.source_urls
        ]
        yield StageEvent(
            stage="expand",
            label=f"Graph expansion → {len(expanded_urls)} nodes in context",
            items=[
                {"url": u, "role": "seed" if u in seed_set else "neighbour"}
                for u in expanded_urls
            ],
            meta={
                "seeds": len(seed_set),
                "neighbours": max(0, len(expanded_urls) - len(seed_set)),
                "relationships": expanded.get("relationships", []),
                "fell_back_to_bi_encoder": fell_back,
                "token_budget": self.rag.token_budget,
            },
            elapsed_ms=ms(),
        )

        # ---- Stage 5: generation -------------------------------------------
        answer = await self.rag._generate_enhanced_answer(query, expanded)
        yield StageEvent(
            stage="generate",
            label="Answer generated",
            items=[{"url": u} for u in expanded_urls],
            meta={"answer": answer},
            elapsed_ms=ms(),
        )

        yield StageEvent(stage="done", label="Complete", items=[], meta={}, elapsed_ms=ms())
