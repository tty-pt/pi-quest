// HIGH_LEVEL: #modes — draftQuality. A deterministic, configurable depth bar
// on top of the requirement/evidence counts: evidence must be verifiable
// (citations that resolve on disk), the plan must be actionable (enough
// discrete steps) and say how it will be verified. Under the bypass policies
// (balanced/off) no reviewer reads the plan, so this is what stands between a
// shallow draft and promotion; under strict it is advisory input to the
// reviewer. No model calls — pure text and disk probes.
import type { QuestDifficulty, QuestKind } from "../domain/quest";
import type { PiCtx } from "../hooks/events";
import type { QuestConfig } from "../config";
import { mergeExemplars, nearestExemplar } from "../judge/nearest";
import { VERIFICATION_EXEMPLARS, VERIFY_CLUSTERS } from "./verification-exemplars";
import { resolveCitations } from "./citations";
import { deliverableBody, type DraftSections } from "./plan-text";

export { DEFAULT_DRAFT_QUALITY, parseDraftQuality } from "./quality-config";
export type { DraftQualityConfig, DraftQualityMode, DraftQualityTier } from "./quality-config";

// A step is a list item: numbered ("1." / "1)"), bulleted, or a checkbox.
// Prose paragraphs and headings are not steps.
export function countSteps(plan: string): number {
  return plan.split("\n").filter((line) => /^\s*(?:\d+[.)]|[-*+])\s+\S/.test(line)).length;
}

/**
 * Decomposed step evaluation: extracts steps and classifies them against fine-grained
 * verification categories via in-memory server-side or local nearest-exemplar embeddings.
 * S_verify = max(sim in verify clusters)
 * S_other = max(sim in non_verify clusters)
 * step_margin = S_verify - S_other
 */
export async function evaluateVerificationDecomposed(config: QuestConfig, plan: string): Promise<boolean | null> {
  const steps = plan
    .split("\n")
    .map((l) => /^\s*(?:\d+[.)]|[-*+])\s+(\S.*)$/.exec(l)?.[1]?.trim() ?? "")
    .filter((s) => s !== "");

  if (steps.length === 0) return null;

  const examples = mergeExemplars(VERIFICATION_EXEMPLARS, {});
  const verdicts = await Promise.all(steps.map((step) => nearestExemplar(config, examples, step)));
  let anyEvaluated = false;

  for (const verdict of verdicts) {
    if (!verdict) continue;
    anyEvaluated = true;
    if (VERIFY_CLUSTERS.has(verdict.kind) && verdict.similarity >= 0.50 && verdict.margin >= 0.05) {
      return true;
    }
  }

  return anyEvaluated ? false : null;
}

/**
 * true/false from decomposed classification; null when embeddings are unavailable (advisory, never blocks).
 */
export async function judgeHasVerificationStep(config: QuestConfig, plan: string): Promise<boolean | null> {
  return await evaluateVerificationDecomposed(config, plan);
}

export interface QualityResult {
  gaps: string[];
  blocks: boolean;
  resolved: number;
  total: number;
  summary: string;
}

const EMPTY: QualityResult = { gaps: [], blocks: false, resolved: 0, total: 0, summary: "" };

export async function assessDraftQuality(
  ctx: PiCtx,
  config: QuestConfig,
  sections: DraftSections,
  kind: QuestKind,
  difficulty: QuestDifficulty,
): Promise<QualityResult> {
  const cfg = config.draftQuality;
  if (cfg.mode === "off") return EMPTY;
  const tier = cfg.tiers[difficulty];
  const body = deliverableBody(sections, kind);
  const report = await resolveCitations(ctx.cwd, `${sections.evidence.join("\n")}\n${body}`);
  const gaps: string[] = [];
  if (report.resolved < tier.citations) {
    const bad = report.problems.length > 0 ? ` (${report.problems.length} unresolved: ${report.problems.slice(0, 3).join("; ")})` : "";
    gaps.push(`add ${tier.citations - report.resolved} more resolvable citations (file:line) in evidence or the ${kind === "analysis" ? "analysis" : "plan"} (have ${report.resolved}/${tier.citations})${bad}`);
  }
  let steps = 0;
  if (kind === "standard") {
    steps = countSteps(body);
    if (steps < tier.steps) gaps.push(`break the plan into at least ${tier.steps} discrete steps as a numbered or bulleted list (have ${steps})`);
    if (tier.requireVerification && (await judgeHasVerificationStep(config, body)) === false) {
      gaps.push("add a verification step (a test or check that proves the change)");
    }
  }
  const stepNote = kind === "standard" ? `, ${steps} steps` : "";
  const summary = `draft quality (${difficulty}, ${cfg.mode}): ${report.resolved}/${report.total} citations resolve${stepNote}; ` +
    (gaps.length === 0 ? "bar met" : `missing: ${gaps.join("; ")}`);
  return { gaps, blocks: cfg.mode === "enforce" && gaps.length > 0, resolved: report.resolved, total: report.total, summary };
}
