"""Three-stage retrieval refinement: cross-encoder rerank + LLM judge accept/reject.

Sits after the bi-encoder retrieval stage in graphrag.py:
    bi-encoder (broad recall) -> CrossEncoder rerank (precision) -> LLMJudge (accept/reject)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Tuple

from llm_client import LLMClient, make_llm_client

DEFAULT_RERANK_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
MAX_JUDGE_SNIPPET_CHARS = 1500

JUDGE_PROMPT = """You are a strict relevance judge for a documentation search system.
Decide whether the DOCUMENT below is relevant enough to help answer the QUERY.

QUERY: {query}

DOCUMENT (url: {url}):
{snippet}

Respond with a one-line verdict in exactly this format, nothing else:
Verdict: <<ACCEPT>> or Verdict: <<REJECT>>
"""


@dataclass
class RankedCandidate:
    url: str
    content: str
    bi_encoder_score: float
    rerank_score: Optional[float] = None
    judge_verdict: Optional[str] = None  # "ACCEPT" / "REJECT" / None if not judged


class CrossEncoderReranker:
    """Stage 2: precision reranking of bi-encoder candidates via a cross-encoder."""

    def __init__(self, model_name: str = DEFAULT_RERANK_MODEL):
        from sentence_transformers import CrossEncoder

        self.model_name = model_name
        self.model = CrossEncoder(model_name)

    def rerank(self, query: str, candidates: List[RankedCandidate], top_k: int) -> List[RankedCandidate]:
        if not candidates:
            return []

        pairs = [(query, c.content[:MAX_JUDGE_SNIPPET_CHARS] or c.url) for c in candidates]
        scores = self.model.predict(pairs)

        for candidate, score in zip(candidates, scores):
            candidate.rerank_score = float(score)

        candidates.sort(key=lambda c: c.rerank_score, reverse=True)
        return candidates[:top_k]


class LLMJudge:
    """Stage 3: LLM-as-judge accept/reject filter over reranked candidates."""

    def __init__(self, llm: Optional[LLMClient] = None):
        self.llm = llm or make_llm_client()

    def judge(self, query: str, candidate: RankedCandidate) -> str:
        """Return 'ACCEPT' or 'REJECT'. Defaults to ACCEPT on unparseable/errored output
        so a flaky judge call degrades to pre-judge behavior instead of losing context."""
        prompt = JUDGE_PROMPT.format(
            query=query,
            url=candidate.url,
            snippet=(candidate.content or "")[:MAX_JUDGE_SNIPPET_CHARS],
        )
        try:
            output = self.llm.generate(prompt, temperature=0.0, max_tokens=50)
        except Exception as e:
            print(f"⚠️  Judge call failed for {candidate.url}: {e}. Defaulting to ACCEPT.")
            return "ACCEPT"

        match = re.search(r"<<\s*(ACCEPT|REJECT)\s*>>", output, re.IGNORECASE)
        verdict = match.group(1).upper() if match else "ACCEPT"
        return verdict

    def filter(self, query: str, candidates: List[RankedCandidate]) -> List[RankedCandidate]:
        accepted = []
        for candidate in candidates:
            verdict = self.judge(query, candidate)
            candidate.judge_verdict = verdict
            if verdict == "ACCEPT":
                accepted.append(candidate)
            else:
                print(f"  ✗ Judge rejected: {candidate.url}")
        return accepted
