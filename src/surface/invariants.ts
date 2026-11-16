// HIGH_LEVEL: #storage — query active L2 invariants / standing directives from memory.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { QuestConfig } from "../config";
import { gate, mergeExemplars, nearestExemplar, type ExemplarTable } from "../judge/nearest";

export interface ActiveInvariant {
  ref?: number;
  summary: string;
  subsystem?: string;
  project?: string;
}

export const INVARIANT_EXEMPLARS: ExemplarTable = {
  standing_invariant: [
    "All UI modules in mods/*/ux/ must remain pure C without preprocessor branching or backend symbols.",
    "Database mutations must always be routed through the canonical storage API, never direct filesystem writes.",
    "Always write and run unit tests for each standalone library before integrating across modules.",
    "Run only targeted module verification for isolated changes; reserve the monolithic test suite for core server changes.",
    "Never use regular expressions for semantic intent or natural language classification; use embedding exemplars.",
    "JavaScript in htdocs/ must stay strictly generic library glue with zero domain-specific identifiers.",
    "Never modify files inside external/ submodules directly from the parent worktree.",
    "Search indexing and matching must preserve diacritics and accent sensitivity.",
    "Do not include self-congratulatory language or unverified claims when reporting engineering metrics.",
    "Worktree branch integration and conflict resolution during quest archive belong strictly to the harness.",
    "Keep source files and functions within the repository's complexity and line-count budgets.",
    "Server-side rendering is the primary contract; progressive client enhancement is additive.",
    "Regra permanente: nunca adicione dependências externas desnecessárias no caminho crítico.",
    "Diretriz de arquitetura: todos os testes unitários devem rodar hermeticamente sem estado global.",
    "Nunca faça commit de código sem antes executar a suíte de verificação correspondente.",
  ],
  transient_or_invalid: [
    "Commit the current changes right now, we will deal with the broken unit tests tomorrow.",
    "Please skip running the test suite for this quick fix and push the branch.",
    "Leave the failing tests for later and just commit what we have.",
    "Bypass the verification checks so we can save a work-in-progress snapshot.",
    "Make sure all the pending files in the working tree get committed in this WIP commit.",
    "Commit the current feature branch work so we don't lose progress.",
    "Just commit and push the files right now.",
    "Do not bother writing tests for this temporary commit.",
    "Save a quick WIP commit of the current directory.",
    "Look at the diff for the last commit and tell me what changed.",
    "This prompt is only an analysis question, do not edit any files.",
    "Faz só o commit agora, depois a gente vê os testes.",
    "Garante que o trabalho atual está comitado neste WIP.",
  ],
};

/**
 * Normalizes raw memory summary into a clean standing directive statement.
 * Strips episode wrapping ("Episode: Standing directive: <text> — tested: <proof>")
 * using pure string slicing without regular expressions.
 */
export function cleanInvariantSummary(raw: string): string {
  let text = raw.trim();
  if (text.toLowerCase().startsWith("episode:")) {
    text = text.slice("episode:".length).trim();
  }
  if (text.toLowerCase().startsWith("standing directive:")) {
    text = text.slice("standing directive:".length).trim();
  }
  const testedIdx = text.toLowerCase().lastIndexOf(" — tested:");
  if (testedIdx > 0) {
    text = text.slice(0, testedIdx).trim();
  }
  return text;
}

/**
 * Structural pre-check for candidate invariant strings:
 * must be non-empty, at least 8 characters, and not an interrogative question ("?").
 */
export function isEligibleStandingInvariant(summary: string): boolean {
  if (!summary || typeof summary !== "string") return false;
  const s = summary.trim();
  if (s.length < 8) return false;
  if (s.includes("?")) return false;
  return true;
}

export async function classifyInvariantByEmbedding(
  summary: string,
  cfg: QuestConfig,
): Promise<boolean> {
  const cleaned = cleanInvariantSummary(summary);
  if (!isEligibleStandingInvariant(cleaned)) return false;
  if (cfg.embedMode === "off" || cfg.judgeMode === "off") return true;
  const examples = mergeExemplars(INVARIANT_EXEMPLARS, {});
  const verdict = await nearestExemplar(cfg, examples, cleaned);
  if (verdict === null) return true;
  const gated = gate(verdict, {
    minSimilarity: cfg.intentMinSimilarity,
    minMargin: 0.01,
    harmless: "standing_invariant",
    actionable: new Set(["transient_or_invalid"]),
  });
  return gated !== "transient_or_invalid";
}

function parseInvariantItem(item: unknown): ActiveInvariant | null {
  if (typeof item !== "object" || item === null) return null;
  const d = item as Record<string, unknown>;
  const rawSummary = typeof d["summary"] === "string" ? d["summary"] : typeof d["text"] === "string" ? d["text"] : "";
  if (!rawSummary) return null;
  const summary = cleanInvariantSummary(rawSummary);
  if (!isEligibleStandingInvariant(summary)) return null;
  return {
    ref: typeof d["ref"] === "number" ? d["ref"] : undefined,
    summary,
    subsystem: typeof d["subsystem"] === "string" ? d["subsystem"] : undefined,
    project: typeof d["project"] === "string" ? d["project"] : undefined,
  };
}

export async function fetchActiveInvariants(
  cwd: string,
  cfg?: QuestConfig,
): Promise<ActiveInvariant[]> {
  let candidates: ActiveInvariant[] = [];

  // 1. Try globalThis in-memory scheduler or directives cache (0ms)
  try {
    const globalObj = globalThis as Record<string, unknown>;
    const cached = globalObj["__pi_mm_directives"];
    if (Array.isArray(cached) && cached.length > 0) {
      candidates = cached.map(parseInvariantItem).filter((inv): inv is ActiveInvariant => inv !== null);
    } else {
      const scheduler = globalObj["__pi_mm_scheduler"] as { getDirectives?: () => unknown[] } | undefined;
      if (scheduler && typeof scheduler.getDirectives === "function") {
        const dirs = scheduler.getDirectives();
        if (Array.isArray(dirs) && dirs.length > 0) {
          candidates = dirs.map(parseInvariantItem).filter((inv): inv is ActiveInvariant => inv !== null);
        }
      }
    }
  } catch { /* best-effort in-memory check */ }

  // 2. Try reading standing_directives.json or invariants.json from .pi/mm on disk
  if (candidates.length === 0) {
    for (const filePath of [join(cwd, ".pi", "mm", "standing_directives.json"), join(cwd, ".pi", "mm", "invariants.json")]) {
      if (!existsSync(filePath)) continue;
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8"));
        if (Array.isArray(parsed) && parsed.length > 0) {
          candidates = parsed.map(parseInvariantItem).filter((inv): inv is ActiveInvariant => inv !== null);
          if (candidates.length > 0) break;
        }
      } catch { /* fall through */ }
    }
  }

  if (candidates.length === 0 || !cfg || cfg.embedMode === "off" || cfg.judgeMode === "off") {
    return candidates;
  }

  const verified: ActiveInvariant[] = [];
  for (const inv of candidates) {
    if (await classifyInvariantByEmbedding(inv.summary, cfg)) {
      verified.push(inv);
    }
  }
  return verified;
}

export function formatInvariantsComment(invariants: Array<ActiveInvariant | string>): string {
  if (!invariants || invariants.length === 0) return "";
  const validItems: string[] = [];
  for (const inv of invariants) {
    const raw = typeof inv === "string" ? inv : inv.summary;
    const cleaned = cleanInvariantSummary(raw);
    if (!isEligibleStandingInvariant(cleaned)) continue;
    const refStr = typeof inv !== "string" && inv.ref !== undefined ? ` (Ref ${inv.ref})` : "";
    validItems.push(`  • Invariant${refStr}: ${cleaned}`);
  }
  if (validItems.length === 0) return "";
  return [
    "<!-- [Compliance Criteria]",
    "[Active Mid-Quest Directives - Must be satisfied]",
    "[Standing Repository Invariants from Memory]:",
    ...validItems,
    "-->",
  ].join("\n");
}
