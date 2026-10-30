// HIGH_LEVEL: #working together — generic nearest-exemplar classification over the
// shared embeddings seam. A decision is a table `kind -> example sentences`; a probe
// is classified as the kind of its most similar example, with the margin over the
// best other kind reported alongside. `gate` then turns a raw verdict into a final
// kind: anything below the similarity floor, or an actionable kind that does not beat
// the runner-up by the margin, becomes the decision's harmless kind. Steering, quest
// detection, difficulty and any other categorical decision share this one engine;
// none of them owns a vector, a cache or a cosine of its own.
import { type QuestConfig } from "../config.ts";
import {
  cosine,
  DEFAULT_CLASSIFY_TIMEOUT_MS,
  embedBaseUrl,
  embedTexts,
  isCircuitOpen,
  recordCircuitFailure,
  withCircuitBreaker,
} from "./embed.ts";

export type ExemplarTable = Readonly<Record<string, readonly string[]>>;
export interface Exemplar {
  kind: string;
  text: string;
}

export interface NearestVerdict {
  kind: string;
  /** Cosine of the probe to its closest example of `kind`. */
  similarity: number;
  /** `similarity` minus the best similarity of any other kind (1 + sim when alone). */
  margin: number;
}

export interface GateOptions {
  minSimilarity: number;
  minMargin: number;
  /** Kind returned for anything that does not clear the gate; it must never change state. */
  harmless: string;
  /** Kinds that need the margin too (state-changing ones). The floor binds every kind. */
  actionable: ReadonlySet<string>;
}

interface Index {
  kinds: string[];
  vectors: number[][];
}

const indexes = new Map<string, Promise<Index | null>>();

export function clearNearestIndexes(): void {
  indexes.clear();
}

/** Shipped examples plus the operator's, de-duplicated, restricted to `allowedKinds` when given. */
export function mergeExemplars(
  defaults: ExemplarTable,
  extra: ExemplarTable,
  allowedKinds?: ReadonlySet<string>,
): Exemplar[] {
  const out: Exemplar[] = [];
  const seen = new Set<string>();
  const add = (kind: string, texts: readonly string[]): void => {
    if (allowedKinds !== undefined && !allowedKinds.has(kind)) return;
    for (const text of texts) {
      const key = `${kind}\u0000${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, text });
    }
  };
  for (const [kind, texts] of Object.entries(defaults)) add(kind, texts);
  for (const [kind, texts] of Object.entries(extra)) add(kind, texts);
  return out;
}

function exemplarIndex(cfg: QuestConfig, base: string, examples: readonly Exemplar[]): Promise<Index | null> {
  const key = [base, cfg.embedModel, examples.map((e) => `${e.kind}:${e.text}`).join("\u0001")].join("\u0000");
  let hit = indexes.get(key);
  if (hit === undefined) {
    // First use embeds every example in one batch; a slow cold start must not abort it.
    const timeoutMs = Math.max((cfg.judgeTimeoutMs || 2000) * 4, 8000);
    hit = embedTexts(cfg, examples.map((e) => e.text), { timeoutMs }).then((vectors) =>
      vectors === null ? null : { kinds: examples.map((e) => e.kind), vectors }
    );
    indexes.set(key, hit);
    void hit.then((v) => { if (v === null) indexes.delete(key); });
  }
  return hit;
}

async function classifyViaEndpoint(
  base: string,
  model: string,
  examples: readonly Exemplar[],
  text: string,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<NearestVerdict | null> {
  const labels: Record<string, string[]> = {};
  for (const ex of examples) {
    if (!labels[ex.kind]) labels[ex.kind] = [];
    labels[ex.kind]?.push(ex.text);
  }

  const url = `${base.replace(/\/+$/, "")}/v1/systemone`;

  return await withCircuitBreaker(
    base,
    async (signal) => {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, text, labels }),
        signal,
      });
      if (res.status >= 500) {
        recordCircuitFailure(base);
        return null;
      }
      if (!res.ok) return null;
      const body = await res.json() as {
        choice?: string;
        decision?: string;
        similarity?: number;
        confidence?: number;
        margin?: number;
      };
      const kind = body.decision ?? body.choice;
      const sim = body.similarity ?? body.confidence;
      if (typeof kind === "string" && typeof sim === "number" && typeof body.margin === "number") {
        return {
          kind,
          similarity: sim,
          margin: body.margin,
        };
      }
      return null;
    },
    { timeoutMs },
  );
}

/** Nearest-example verdict for `text`, or null when embeddings are unavailable. */
export async function nearestExemplar(
  cfg: QuestConfig,
  examples: readonly Exemplar[],
  text: string,
  fetchFn?: typeof fetch,
): Promise<NearestVerdict | null> {
  const base = embedBaseUrl(cfg);
  if (base === null || examples.length === 0) return null;
  if (isCircuitOpen(base)) return null;

  // Try fast in-memory server-side systemone classification endpoint first (<15ms, zero float vectors over TCP)
  const timeoutMs = Math.min(cfg.judgeTimeoutMs || DEFAULT_CLASSIFY_TIMEOUT_MS, 500);
  const serverChoice = await classifyViaEndpoint(
    base,
    cfg.embedModel,
    examples,
    text,
    timeoutMs,
    fetchFn,
  );
  if (serverChoice !== null) {
    return serverChoice;
  }

  // Graceful fallback to client-side vector batching if endpoint is unsupported/down,
  // but if the daemon is offline the circuit breaker has already tripped.
  if (isCircuitOpen(base)) return null;

  const index = await exemplarIndex(cfg, base, examples);
  if (index === null) return null;
  const vec = await embedTexts(cfg, [text], { fetchFn });
  const probe = vec?.[0];
  if (probe === undefined) return null;
  const best = new Map<string, number>();
  index.vectors.forEach((v, i) => {
    const kind = index.kinds[i] ?? "";
    const sim = cosine(probe, v);
    if (sim > (best.get(kind) ?? -Infinity)) best.set(kind, sim);
  });
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (top === undefined) return null;
  return { kind: top[0], similarity: top[1], margin: top[1] - (ranked[1]?.[1] ?? -1) };
}

/** Final kind for a raw verdict: the verdict's own kind only when it clears the gate. */
export function gate(v: NearestVerdict, o: GateOptions): string {
  if (v.similarity < o.minSimilarity) return o.harmless;
  if (o.actionable.has(v.kind) && v.margin < o.minMargin) return o.harmless;
  return v.kind;
}
