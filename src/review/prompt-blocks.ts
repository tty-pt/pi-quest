import type { QuestDifficulty, QuestKind, ReviewVerdict } from "../domain/quest";

export interface ReviewMaterial {
  objective: string;
  plan: string;
  kind?: QuestKind;
  difficulty?: QuestDifficulty;
  evidence: string[];
  amendments: string[];
  rebuttal?: string;
  implementationSummary?: string;
  planDiff?: string;
  previousVerdict?: ReviewVerdict;
  previousFindings?: string;
  revisionNote?: string;
  planRevisionHistory?: string[];
  transcriptExtract?: string;
  claimManifest?: string;
  codeDiff?: string;
  testReceipt?: string;
  rtmChecklist?: string;
  touchedFiles?: string[];
  requirements?: string[];
  refinements?: string[];
  assumptions?: string[];
}

export const READ_ONLY_RULES = `MANDATORY INVARIANTS:
1. You are strictly read-only. Do not edit files, run mutating commands, or change project state.
2. Do not trust summaries or claims. Independently inspect the repository and verify important claims with your read/search tools.
3. You judge and report. You never modify quest state, the plan, or implementation files.
4. Stray repo-root notes and forensics docs (e.g. RUN1.md, RUN*.md) are NOT quest history — they document unrelated sessions. The QUEST MATERIAL below is the only authority for this review; ignore any document the material does not reference.
5. Spot-check the CLAIM MANIFEST lines when present; do not re-derive the whole tree for claims the manifest does not make.`;

export const SELF_ATTACK = `TWO-PASS SELF-ATTACK:
PASS 1: Independently evaluate the material against the request and repository evidence.
PASS 2: Attack your own conclusion — what requirement could still be missing, what assumption is most dangerous, what is least supported by evidence?
Only the post-self-critique verdict counts.`;

export const OUTPUT_FORMAT = `OUTPUT FORMAT — your response MUST end with exactly this structure:

VERDICT: PASS | FAIL
SEVERITY: NONE | MINOR | MAJOR | CRITICAL

BUDGET: decide first, then write. Put the VERDICT: and SEVERITY: lines at the very start of your final reply — a run ending on analysis with no VERDICT counts as FAIL.

On PASS, approval is unconditional — do NOT write a REQUIRED REVISIONS section:
SUPPORTING FINDINGS:
- Finding: <why the material passes, with concrete evidence>

ADVISORIES (optional, non-blocking observations only):
- <observation the implementer may consider; never a condition of approval>

On FAIL:
FINDINGS:
- Issue: <concrete issue or omission>
  Evidence: <concrete evidence from repository, plan, or logs>

REQUIRED REVISIONS:
- <concrete change or targeted investigation required>`;

export const AMENDMENT_VALIDITY_GUIDANCE = `AMENDMENT VALIDITY EVALUATION:
When RECORDED AMENDMENTS are present, you MUST explicitly evaluate whether each amendment is VALID:
- An amendment is valid ONLY if it resolves a genuine, proven contradiction between the original request and existing codebase reality, architectural invariants, physical/technical impossibility, or mutually conflicting instructions. The reason must cite concrete repository facts or evidence.
- An amendment is INVALID if it weakens acceptance criteria for convenience, drops requirements without demonstrating a real contradiction, or misrepresents repository state.
- If ANY recorded amendment is invalid, ungrounded, or unnecessary, you MUST issue VERDICT: FAIL specifying why the amendment fails.`;

export function contextBlock(material: ReviewMaterial): string {
  const evidence = material.evidence.length > 0 ? material.evidence.join("\n") : "(no evidence items recorded in the draft file)";
  const amendments = material.amendments.length > 0 ? material.amendments.join("\n") : "(no amendments recorded)";
  const rebuttal = material.rebuttal ? `\n--- IMPLEMENTER REBUTTAL ---\n${material.rebuttal}\n` : "";
  const diff = material.planDiff ? `\nCHANGES SINCE LAST REVIEW:\n${material.planDiff}\n` : "";
  const prior = material.previousVerdict ? `\nPRIOR VERDICT: ${material.previousVerdict}\nPRIOR FINDINGS:\n${material.previousFindings ?? "(none)"}\nRe-verify prior findings yourself against the full material above; a prior FAIL presumes nothing about this revision.\n` : "";
  const revision = material.revisionNote ? `\nPLAN REVISION UNDER REVIEW:\n${material.revisionNote}\nThe objective above is unchanged — a revision that introduces a new goal or acceptance criterion is out of scope and must FAIL.\n` : "";
  const history = (material.planRevisionHistory ?? []).length > 0 ? `\nPLAN REVISION HISTORY (the approved plan moved during implementation):\n${(material.planRevisionHistory ?? []).join("\n")}\n` : "";
  const manifest = material.claimManifest ? `\nCLAIM MANIFEST (spot-check these in the tree; do not re-derive the whole tree):\n${material.claimManifest}\n` : "";
  const transcript = material.transcriptExtract ? `\nRESEARCH TRANSCRIPT (bounded extract, most recent first):\n${material.transcriptExtract}\n` : "";
  const rtm = material.rtmChecklist ? `\nREQUIREMENTS TRACEABILITY MATRIX (RTM):\n${material.rtmChecklist}\n` : "";
  const codeDiff = material.codeDiff ? `\nGIT DIFF (actual changes to verify against requirements):\n${material.codeDiff}\n`
    : (material.touchedFiles && material.touchedFiles.length > 0 ? `\nTOUCHED FILES (no VCS diff available — inspect these files directly in workspace):\n${material.touchedFiles.map((f) => `- ${f}`).join("\n")}\n` : "");
  const testReceipt = material.testReceipt ? `\nTEST VERIFICATION RECEIPT:\n${material.testReceipt}\n` : "";
  const requirements = material.requirements !== undefined ? `\nREQUIREMENTS (${material.requirements.length} recorded in the draft file's ## Requirements section):\n${material.requirements.length > 0 ? material.requirements.map((r) => r.startsWith("- ") ? r : `- ${r}`).join("\n") : "(no requirements recorded in the draft file)"}\n` : "";
  const difficultyTag = material.difficulty ? `\nQUEST DIFFICULTY: ${material.difficulty}\n` : "";
  const directives = (material.refinements && material.refinements.length > 0) ? `\nACTIVE USER DIRECTIVES / REFINEMENTS:\n${material.refinements.map((r) => `- ${r}`).join("\n")}\n` : "";
  const assumptions = (material.assumptions && material.assumptions.length > 0) ? `\nASSUMPTIONS & FALSIFICATION CRITERIA:\n${material.assumptions.map((a) => a.startsWith("- ") ? a : `- ${a}`).join("\n")}\n` : "";
  const deliverableLabel = material.kind === "analysis" ? "APPROVED ANALYSIS" : "APPROVED PLAN";

  return `--- QUEST MATERIAL ---
ORIGINAL REQUEST (primary acceptance criterion):
${material.objective || "(none)"}
${difficultyTag}${rtm}${requirements}${directives}${assumptions}
${deliverableLabel}:
${material.plan || "(none)"}
${diff}
${revision}RECORDED AMENDMENTS:
${amendments}
${history}
EVIDENCE:
${evidence}
${manifest}${codeDiff}${testReceipt}${transcript}${rebuttal}${prior}--- END MATERIAL ---`;
}
