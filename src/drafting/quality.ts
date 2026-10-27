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
import { resolveCitations } from "./citations";
import { deliverableBody, type DraftSections } from "./plan-text";

export { DEFAULT_DRAFT_QUALITY, parseDraftQuality } from "./quality-config";
export type { DraftQualityConfig, DraftQualityMode, DraftQualityTier } from "./quality-config";

// A step is a list item: numbered ("1." / "1)"), bulleted, or a checkbox.
// Prose paragraphs and headings are not steps.
export function countSteps(plan: string): number {
  return plan.split("\n").filter((line) => /^\s*(?:\d+[.)]|[-*+])\s+\S/.test(line)).length;
}

export function hasVerificationStep(plan: string): boolean {
  return /\b(tests?|testing|verif(?:y|ies|ied|ication)|assert\w*|validat\w+|lint|smoke|e2e|regression|acceptance)\b/i.test(plan);
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
    if (tier.requireVerification && !hasVerificationStep(body)) {
      gaps.push("add a verification step (a test or check that proves the change)");
    }
  }
  const stepNote = kind === "standard" ? `, ${steps} steps` : "";
  const summary = `draft quality (${difficulty}, ${cfg.mode}): ${report.resolved}/${report.total} citations resolve${stepNote}; ` +
    (gaps.length === 0 ? "bar met" : `missing: ${gaps.join("; ")}`);
  return { gaps, blocks: cfg.mode === "enforce" && gaps.length > 0, resolved: report.resolved, total: report.total, summary };
}
