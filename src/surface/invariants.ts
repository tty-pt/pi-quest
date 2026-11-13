// HIGH_LEVEL: #storage — query active L2 invariants / standing directives from memory.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ActiveInvariant {
  ref?: number;
  summary: string;
  subsystem?: string;
  project?: string;
}

const HARMFUL_INVARIANT_PATTERNS: RegExp[] = [
  // Anti-testing and skipping verification
  /\b(?:work on tests later|tests?\s+later|skip tests?|ignore tests?|bypass tests?|no tests?(?:\s+needed)?|without(?: running)? tests?)\b/i,
  // Transient WIP / one-off commit instructions
  /\b(?:wip commit|as part of this wip|wip commit thing|just commit\b)/i,
  /\bmake sure (?:the )?[a-z0-9_-]+ work is committed\b/i,
  /\bmake sure everything is committed and pushed\b/i,
  // Conversational analysis markers
  /\bthis is an analysis request\b/i,
];

/**
 * Normalizes raw memory summary into a clean standing directive statement.
 * Strips episode wrapping ("Episode: Standing directive: <text> — tested: <proof>").
 */
export function cleanInvariantSummary(raw: string): string {
  let text = raw.trim();
  const episodeDirectiveMatch = text.match(/^Episode:\s*Standing directive:\s*(.*?)(?:\s*—\s*tested:.*)?$/i);
  if (episodeDirectiveMatch && episodeDirectiveMatch[1].trim().length > 0) {
    text = episodeDirectiveMatch[1].trim();
  } else {
    const episodeGenericMatch = text.match(/^Episode:\s*(.*?)(?:\s*—\s*tested:.*)?$/i);
    if (episodeGenericMatch && episodeGenericMatch[1].trim().length > 0) {
      text = episodeGenericMatch[1].trim();
    }
  }
  return text;
}

/**
 * Validates whether an invariant is a genuine, non-harmful standing technical invariant.
 * Rejects questions, transient WIP/commit commands, and harmful directives that contradict
 * testing or quality gates (e.g. 'just commit, we can work on tests later').
 */
export function isEligibleStandingInvariant(summary: string): boolean {
  if (!summary || typeof summary !== "string") return false;
  const s = summary.trim();
  if (s.length < 8) return false;

  // Interrogatives, conversational queries, or confirmations are never standing invariants
  if (s.endsWith("?") || /\?\s*$/i.test(s) || /\b(?:Correct|Understood|Right)\?\s*$/i.test(s)) {
    return false;
  }
  if (/^(?:is|are|can|could|would|should|how|what|why|where|when|who|which|judging by)\b/i.test(s) && s.includes("?")) {
    return false;
  }

  // Reject harmful patterns
  for (const pattern of HARMFUL_INVARIANT_PATTERNS) {
    if (pattern.test(s)) return false;
  }

  return true;
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

export async function fetchActiveInvariants(cwd: string): Promise<ActiveInvariant[]> {
  // 1. Try globalThis in-memory scheduler or directives cache (0ms)
  try {
    const globalObj = globalThis as Record<string, unknown>;
    const cached = globalObj["__pi_mm_directives"];
    if (Array.isArray(cached) && cached.length > 0) {
      return cached
        .map(parseInvariantItem)
        .filter((inv): inv is ActiveInvariant => inv !== null);
    }
    const scheduler = globalObj["__pi_mm_scheduler"] as { getDirectives?: () => unknown[] } | undefined;
    if (scheduler && typeof scheduler.getDirectives === "function") {
      const dirs = scheduler.getDirectives();
      if (Array.isArray(dirs) && dirs.length > 0) {
        return dirs
          .map(parseInvariantItem)
          .filter((inv): inv is ActiveInvariant => inv !== null);
      }
    }
  } catch {
    // Best-effort in-memory check
  }

  // 2. Try reading standing_directives.json or invariants.json from .pi/mm on disk
  const candidateFiles = [
    join(cwd, ".pi", "mm", "standing_directives.json"),
    join(cwd, ".pi", "mm", "invariants.json"),
  ];

  for (const filePath of candidateFiles) {
    if (existsSync(filePath)) {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
            .map(parseInvariantItem)
            .filter((inv): inv is ActiveInvariant => inv !== null);
        }
      } catch {
        // Fall through
      }
    }
  }

  return [];
}

export function formatInvariantsComment(invariants: Array<ActiveInvariant | string>): string {
  if (!invariants || invariants.length === 0) return "";
  const validItems: string[] = [];
  for (const inv of invariants) {
    if (typeof inv === "string") {
      const cleaned = cleanInvariantSummary(inv);
      if (isEligibleStandingInvariant(cleaned)) {
        validItems.push(`  • Invariant: ${cleaned}`);
      }
    } else {
      const cleaned = cleanInvariantSummary(inv.summary);
      if (isEligibleStandingInvariant(cleaned)) {
        const refStr = inv.ref !== undefined ? ` (Ref ${inv.ref})` : "";
        validItems.push(`  • Invariant${refStr}: ${cleaned}`);
      }
    }
  }
  if (validItems.length === 0) return "";
  const lines: string[] = [
    "<!-- [Compliance Criteria]",
    "[Active Mid-Quest Directives - Must be satisfied]",
    "[Standing Repository Invariants from Memory]:",
    ...validItems,
    "-->",
  ];
  return lines.join("\n");
}
