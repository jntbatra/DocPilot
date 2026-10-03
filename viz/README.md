# DocPilot Visualiser

Watch a GraphRAG query happen. Not a chat box with a graph next to it — the
graph *is* the explanation: which pages were recalled, how the cross-encoder
reordered them, what the judge threw out, and which neighbours the graph pulled
in that never ranked on their own.

## Run

Two processes.

```bash
# 1. backend  (demo mode — no keys, no models, synthetic graph)
cd viz/backend
../../.venv/bin/python -m uvicorn server:app --reload --port 8000

# 2. frontend
cd viz/frontend
npm install     # first time only
npm run dev
```

Open http://localhost:5173

## Run against a real crawl

```bash
# build a graph first
python main.py --url https://docs.crawl4ai.com/ --output_dir ./output \
               --name crawl4ai --max_depth 2 --max_pages 40

# then point the backend at it
cd viz/backend
DOCPILOT_GRAPH=../../output/crawl4ai_kg.h5 \
  ../../.venv/bin/python -m uvicorn server:app --port 8000
```

Needs `gemini_api_key` in `.env` for generation, and whatever `LLM_PROVIDER`
you've configured for the judge. Set `LLM_PROVIDER=stub` to exercise the
pipeline without a judge backend.

## What you're looking at

| Colour | Meaning |
|---|---|
| grey | not retrieved |
| amber | recalled by the bi-encoder |
| amber, brighter | survived the cross-encoder |
| green | judge accepted it |
| red, faded | judge rejected it |
| blue | pulled in by graph expansion — never ranked on its own |

Click any stage in the left rail to rewind the graph to that moment. Positions
never change between stages, so the eye can track what moved.

Animated edges show graph expansion: a solid link from an accepted node to a
blue one is a page that made it into the answer purely because of the graph.
That edge is the entire argument for GraphRAG over flat vector search.

## Knobs

`cross-encoder` and `LLM judge` toggle the corresponding stages (same as
`--no_rerank` / `--no_judge`). `top_n`, `top_k` and `budget` map to
`--rerank_top_n`, `--final_top_k` and `--token_budget`.

Turning the judge off and re-running the same query is the demo: watch how many
irrelevant pages reach the prompt without it.

## Layout

```
backend/
  server.py      FastAPI — /api/graph, /api/query (SSE), demo mode
  pipeline.py    instrumented copy of retrieve_and_generate that emits a
                 StageEvent per stage, without touching graphrag.py
frontend/src/
  api.ts         SSE reader
  store.ts       zustand + nodeStates(): the stage→colour mapping
  layout.ts      dagre hierarchical layout (depth = column)
  components/    GraphCanvas, StagePanel, QueryBar, SidePanel, DocNode
```

`pipeline.py` deliberately mirrors `GraphRAGSystem.retrieve_and_generate`
step for step, including the fall-back when the judge rejects everything — the
visualiser flags that case in red, because it's the reason the system can never
refuse.
