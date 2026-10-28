// HIGH_LEVEL: #working together — the single seam for the local embeddings server
// (axil-auren `POST /v1/embeddings`, OpenAI-shaped). Operator-steering
// classification is nearest-exemplar search over these vectors: deterministic,
// millisecond-fast, no generation. Any failure — HTTP error, timeout, malformed or
// all-zero vectors — is `null` ("unavailable"), never a guess, and a failed endpoint
// is skipped for a short backoff so a dead server cannot stall every message.
import { type QuestConfig } from "../config.ts";

/** How long a failed endpoint is skipped. */
export const EMBED_BACKOFF_MS = 10_000;

const failedUntil = new Map<string, number>();

export function clearEmbedState(): void {
  failedUntil.clear();
}

/** Embeddings server base URL (no trailing slash), or null when embeddings are unavailable. */
export function embedBaseUrl(cfg: QuestConfig): string | null {
  if (cfg.embedMode === "off") return null;
  const raw = (cfg.embedUrl ?? cfg.judgeUrl ?? "").trim();
  if (raw === "") return null;
  return raw.replace(/\/api\/v1\/systemone\/?$/, "").replace(/\/+$/, "");
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

function toUnit(vec: unknown): number[] | null {
  if (!Array.isArray(vec) || vec.length === 0) return null;
  let norm = 0;
  for (const x of vec) {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    norm += x * x;
  }
  if (norm === 0) return null;
  const len = Math.sqrt(norm);
  return (vec as number[]).map((x) => x / len);
}

/**
 * Embed `texts` in ONE request. Resolves to unit vectors in input order, or null
 * when embeddings are off, unreachable, slow, or return anything malformed.
 */
export async function embedTexts(
  cfg: QuestConfig,
  texts: readonly string[],
  opts: { timeoutMs?: number } = {},
): Promise<number[][] | null> {
  const base = embedBaseUrl(cfg);
  if (base === null || texts.length === 0) return null;
  const now = Date.now();
  if ((failedUntil.get(base) ?? 0) > now) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? Math.max((cfg.judgeTimeoutMs || 2000) * 2, 4000));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.judgeKey && cfg.judgeKey.trim() !== "") headers["Authorization"] = `Bearer ${cfg.judgeKey.trim()}`;
  const fail = (): null => {
    failedUntil.set(base, Date.now() + EMBED_BACKOFF_MS);
    return null;
  };
  try {
    const res = await fetch(`${base}/v1/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: cfg.embedModel, input: texts }),
      signal: controller.signal,
    });
    if (!res.ok) return fail();
    const body: unknown = await res.json();
    const data = typeof body === "object" && body !== null ? (body as { data?: unknown }).data : undefined;
    if (!Array.isArray(data) || data.length !== texts.length) return fail();
    const ordered = [...data].sort(
      (a, b) => Number((a as { index?: number })?.index ?? 0) - Number((b as { index?: number })?.index ?? 0),
    );
    const out: number[][] = [];
    for (const item of ordered) {
      const unitVec = toUnit((item as { embedding?: unknown })?.embedding);
      if (unitVec === null) return fail();
      out.push(unitVec);
    }
    return out;
  } catch {
    return fail();
  } finally {
    clearTimeout(timer);
  }
}
