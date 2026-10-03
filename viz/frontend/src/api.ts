import { demoGraph, demoStream } from "./demo";
import type { CrawlEvent, GraphDTO, GraphFile, StageEvent } from "./types";

const BASE = import.meta.env.VITE_API ?? "http://localhost:8000";

/** Probe the backend once. If it's up we run the real pipeline; if not we fall
 *  back to the in-browser demo so the app is never dead. */
let backendUp: boolean | null = null;

export async function probeBackend(): Promise<boolean> {
  if (backendUp !== null) return backendUp;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1200);
    const r = await fetch(`${BASE}/api/health`, { signal: c.signal });
    clearTimeout(t);
    backendUp = r.ok;
  } catch {
    backendUp = false;
  }
  return backendUp;
}

export const isLive = () => backendUp === true;

export async function fetchGraph(): Promise<GraphDTO> {
  if (!(await probeBackend())) return demoGraph();
  const r = await fetch(`${BASE}/api/graph`);
  if (!r.ok) throw new Error(`graph fetch failed: ${r.status}`);
  return r.json();
}

export async function* streamQuery(body: any): AsyncGenerator<StageEvent> {
  if (!(await probeBackend())) {
    yield* demoStream(body);
    return;
  }
  const r = await fetch(`${BASE}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.body) throw new Error("no stream body");

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      yield JSON.parse(line.slice(5).trim()) as StageEvent;
    }
  }
}

/** Generic SSE reader — the crawl and query endpoints share a wire format. */
async function* sseStream<T>(path: string, body: unknown): AsyncGenerator<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
  if (!r.body) throw new Error("no stream body");

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      yield JSON.parse(line.slice(5).trim()) as T;
    }
  }
}

export function crawlSite(body: {
  url: string; max_depth: number; max_pages: number; name?: string;
}): AsyncGenerator<CrawlEvent> {
  return sseStream<CrawlEvent>("/api/crawl", body);
}

export async function listGraphs(): Promise<GraphFile[]> {
  if (!(await probeBackend())) return [];
  const r = await fetch(`${BASE}/api/graphs`);
  if (!r.ok) return [];
  return (await r.json()).graphs ?? [];
}

export async function selectGraph(path: string): Promise<void> {
  await fetch(`${BASE}/api/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}
