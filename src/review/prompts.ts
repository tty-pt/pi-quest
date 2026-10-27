// HIGH_LEVEL: #review request — brief identifies qid, type, target, plan, evidence, criteria.
// HIGH_LEVEL: #reviewer independence — minimal info, judge and report.
// HIGH_LEVEL: #review independence — no inherited context, no prior conclusions.
// HIGH_LEVEL: #independent review contexts — fresh context, no inherited reasoning.
import type { Qid } from "../domain/qid";
import type { QuestDifficulty, QuestKind, ReviewKind, ReviewVerdict } from "../domain/quest";
import { DEFAULT_CONFIG, type DraftThresholds } from "../config";

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
  // HIGH_LEVEL: #plan revision — re-review briefs name the revision context.
  revisionNote?: string;
  // HIGH_LEVEL: #plan revision — validators see the plan's revision history.
  planRevisionHistory?: string[];
  // HIGH_LEVEL: #validation — analysis-quest validators judge the analysis
  // against the bounded research transcript; the extract is truncated, so the
  // validator sees the substance, never the full session.
  transcriptExtract?: string;
  // The plan's verifiable file:line surface. Reviewers spot-check these lines
  // instead of re-auditing the whole tree for unasserted claims.
  claimManifest?: string;
  codeDiff?: string;
  testReceipt?: string;
  rtmChecklist?: string;
  // Draft requirements (## Requirements bullets) so the reviewer can judge the maturity bar.
  requirements?: string[];
}

const READ_ONLY_RULES = `MANDATORY INVARIANTS:
1. You are strictly read-only. Do not edit files, run mutating commands, or change project state.
2. Do not trust summaries or claims. Independently inspect the repository and verify important claims with your read/search tools.
3. You judge and report. You never modify quest state, the plan, or implementation files.
4. Stray repo-root notes and forensics docs (e.g. RUN1.md, RUN*.md) are NOT quest history — they document unrelated sessions. The QUEST MATERIAL below is the only authority for this review; ignore any document the material does not reference.
5. Spot-check the CLAIM MANIFEST lines when present; do not re-derive the whole tree for claims the manifest does not make.`;

const SELF_ATTACK = `TWO-PASS SELF-ATTACK:
PASS 1: Independently evaluate the material against the request and repository evidence.
PASS 2: Attack your own conclusion — what requirement could still be missing, what assumption is most dangerous, what is least supported by evidence?
Only the post-self-critique verdict counts.`;

const OUTPUT_FORMAT = `OUTPUT FORMAT — your response MUST end with exactly this structure:

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

function contextBlock(material: ReviewMaterial): string {
  const evidence = material.evidence.length > 0
    ? material.evidence.join("\n")
    : "(no evidence items recorded in the draft file)";
  const amendments = material.amendments.length > 0
    ? material.amendments.join("\n")
    : "(no amendments recorded)";
  const rebuttal = material.rebuttal
    ? `\n--- IMPLEMENTER REBUTTAL ---\n${material.rebuttal}\n`
    : "";
  const diff = material.planDiff
    ? `\nCHANGES SINCE LAST REVIEW:\n${material.planDiff}\n`
    : "";
  const prior = material.previousVerdict
    ? `\nPRIOR VERDICT: ${material.previousVerdict}\nPRIOR FINDINGS:\n${material.previousFindings ?? "(none)"}\nRe-verify prior findings yourself against the full material above; a prior FAIL presumes nothing about this revision.\n`
    : "";
  const revision = material.revisionNote
    ? `\nPLAN REVISION UNDER REVIEW:\n${material.revisionNote}\nThe objective above is unchanged — a revision that introduces a new goal or acceptance criterion is out of scope and must FAIL.\n`
    : "";
  const history = (material.planRevisionHistory ?? []).length > 0
    ? `\nPLAN REVISION HISTORY (the approved plan moved during implementation):\n${(material.planRevisionHistory ?? []).join("\n")}\n`
    : "";
  const manifest = material.claimManifest
    ? `\nCLAIM MANIFEST (spot-check these in the tree; do not re-derive the whole tree):\n${material.claimManifest}\n`
    : "";
  const transcript = material.transcriptExtract
    ? `\nRESEARCH TRANSCRIPT (bounded extract, most recent first):\n${material.transcriptExtract}\n`
    : "";
  const rtm = material.rtmChecklist
    ? `\nREQUIREMENTS TRACEABILITY MATRIX (RTM):\n${material.rtmChecklist}\n`
    : "";
  const codeDiff = material.codeDiff
    ? `\nGIT DIFF (actual changes to verify against requirements):\n${material.codeDiff}\n`
    : "";
  const testReceipt = material.testReceipt
    ? `\nTEST VERIFICATION RECEIPT:\n${material.testReceipt}\n`
    : "";
  const requirements = material.requirements !== undefined
    ? `\nREQUIREMENTS (${material.requirements.length} recorded in the draft file's ## Requirements section):\n${material.requirements.length > 0 ? material.requirements.map((r) => r.startsWith("- ") ? r : `- ${r}`).join("\n") : "(no requirements recorded in the draft file)"}\n`
    : "";
  const difficultyTag = material.difficulty
    ? `\nQUEST DIFFICULTY: ${material.difficulty}\n`
    : "";
  const deliverableLabel = material.kind === "analysis" ? "APPROVED ANALYSIS" : "APPROVED PLAN";
  return `--- QUEST MATERIAL ---
ORIGINAL REQUEST (primary acceptance criterion):
${material.objective || "(none)"}
${difficultyTag}${rtm}${requirements}
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

const AMENDMENT_VALIDITY_GUIDANCE = `AMENDMENT VALIDITY EVALUATION:
When RECORDED AMENDMENTS are present, you MUST explicitly evaluate whether each amendment is VALID:
- An amendment is valid ONLY if it resolves a genuine, proven contradiction between the original request and existing codebase reality, architectural invariants, physical/technical impossibility, or mutually conflicting instructions. The reason must cite concrete repository facts or evidence.
- An amendment is INVALID if it weakens acceptance criteria for convenience, drops requirements without demonstrating a real contradiction, or misrepresents repository state.
- If ANY recorded amendment is invalid, ungrounded, or unnecessary, you MUST issue VERDICT: FAIL specifying why the amendment fails.`;

function draftGuidance(
  maturity: DraftThresholds,
  kind: QuestKind | undefined,
  difficulty?: QuestDifficulty,
): string {
  const diffGuidance = difficulty === "trivial"
    ? `\nPOSTURE (TRIVIAL DIFFICULTY): This task is small/lightweight in scope. Verify the targeted fix and verification step; do NOT demand multi-phase sequencing, extra requirements, or excessive evidence.\n`
    : difficulty === "complex"
    ? `\nPOSTURE (COMPLEX DIFFICULTY): This task has high blast radius or system complexity. Verify that separable work is decomposed into modular sub-quests (e.g. - [ ] SQ1: Goal [paths: ...] [tests: ...] [req: ...]) with bounded allowedPaths and verification commands, and rigorously scrutinize boundary invariants, risk mitigation, and requirement coverage.\n`
    : "";

  if (kind === "analysis") {
    return `WHAT YOU MUST EVALUATE (DRAFT REVIEW):
You review the ANALYSIS deliverable, not implementation. Compare it against the exact recorded request:
1. Whether the analysis addresses every requirement in the objective;
2. Whether important requirements were omitted;
3. Whether conclusions are grounded in repository evidence;
4. Whether research is sufficient to support the claims;
5. Whether assumptions remain unverified;
6. Whether it stays in scope or substitutes a different problem;
7. Whether it contradicts itself;
8. Whether it credibly satisfies the request.
${AMENDMENT_VALIDITY_GUIDANCE}${diffGuidance}
MATURITY BAR: a reviewable analysis has ${maturity.requirements} requirements, or 1 requirement plus ${maturity.evidence} evidence items, with an authored ## Analysis section. Below the bar, FAIL fast naming exactly what is missing.
Distinguish: user requirement (blocks) vs technical constraint (binds) vs reviewer preference (NEVER blocks).`;
  }
  return `WHAT YOU MUST EVALUATE (DRAFT REVIEW):
You review the PLAN, not implementation. Compare the draft plan against the exact recorded request:
1. Whether the plan addresses the objective; 2. Whether requirements were omitted;
3. Whether it substituted a different problem; 4. Whether research is sufficient;
5. Whether assumptions remain unverified; 6. Whether the work sequence fits;
7. Whether complexity is unnecessary; 8. Whether an alternative was dismissed without evidence;
9. Whether it commits prematurely; 10. Whether it contradicts itself;
11. Whether it credibly satisfies the request.
${AMENDMENT_VALIDITY_GUIDANCE}${diffGuidance}
MATURITY BAR: a reviewable draft has ${maturity.requirements} requirements, or 1 requirement plus ${maturity.evidence} evidence items, with an actionable plan. Below the bar, FAIL fast naming exactly what is missing.
Distinguish: user requirement (blocks) vs technical constraint (binds) vs reviewer preference (NEVER blocks).`;
}

function validationGuidance(kind: QuestKind | undefined): string {
  if (kind === "analysis") {
    return `WHAT YOU MUST EVALUATE (VALIDATION):
You review the ANALYSIS deliverable against the original request: is it complete, grounded, and on scope?
1. Every requirement in the request is addressed by the analysis;
2. Conclusions are grounded — spot-check claims against the repository and the RESEARCH TRANSCRIPT extract;
3. The analysis stays in scope; covering a different problem is a failure;
4. The research backing is adequate for the claim made;
5. All RECORDED AMENDMENTS are valid: each must resolve a genuine, proven contradiction backed by repository evidence.
Reviewer preference NEVER blocks; only unmet requirements, ungrounded claims, invalid amendments, or out-of-scope drift do.`;
  }
  return `WHAT YOU MUST EVALUATE (ROOT INTEGRATION VALIDATION):
You are an adversarial auditor defending the codebase from incomplete or shallow work.
You review the IMPLEMENTATION against the original request, approved plan, and recorded amendments:
1. Every item in the request and RTM checklist must correspond to concrete changes in the GIT DIFF. If any requirement is missing from the diff, you MUST issue VERDICT: FAIL.
2. The TEST VERIFICATION RECEIPT must confirm clean execution (exit code 0). If tests failed or were not run, you MUST issue VERDICT: FAIL.
3. Scan the GIT DIFF for placeholder implementations: TODO, FIXME, stub functions returning dummy values, or commented-out tests. If found, issue VERDICT: FAIL.
4. Ensure no regression of repository boundaries (e.g. #ifdef in pure-C isomorphic UX, cross-module #include "*.c").
5. When a revision history is present, judge every plan move: a revision that corrected an impossibility while holding the objective is legitimate; a revision that weakens the acceptance bar to fit what was built must FAIL.
6. Verify all RECORDED AMENDMENTS: each must resolve a genuine contradiction backed by code reality. If an amendment dropped user requirements without an actual impossibility, issue VERDICT: FAIL.
Reviewer preference NEVER blocks; only unmet requirements, unverified code, invalid amendments, or out-of-scope drift do.`;
}

export function getReviewCriteriaSummary(phase: "drafting" | "implementing", kind: QuestKind = "standard"): string {
  if (phase === "drafting") {
    if (kind === "analysis") {
      return `Draft Review Criteria (Analysis):
- Complete Coverage: Addresses all requirements in objective.
- Evidence Grounding: Claims grounded in repository evidence.
- Amendment Validity: Amendments must resolve proven contradictions and cite repo facts; invalid amendments FAIL.
- Maturity Bar: 2 requirements or 1 req + 7 evidence items with authored ## Analysis.`;
    }
    return `Draft Review Criteria (Plan):
- Complete Coverage: Plan addresses all requirements in request without omissions.
- Actionable Sequence: Concrete phases with verification steps and testing.
- Amendment Validity: Amendments must resolve proven contradictions and cite repo facts; invalid amendments FAIL.
- Maturity Bar: 2 requirements or 1 req + 7 evidence items with actionable ## Implementation Plan.`;
  }
  if (kind === "analysis") {
    return `Validation Criteria (Analysis):
- Scope & Fidelity: Delivers on original request without drift.
- Grounded Claims: Verified against repository and transcript extract.
- Amendments: Verified against genuine contradictions.`;
  }
  return `Validation Criteria (Implementation):
- Diff Completeness: Every request item & RTM requirement implemented in git diff.
- Verification: Clean test execution (exit code 0) with zero regressions.
- Zero Placeholders: No TODO/FIXME/stubs or dummy returns.
- Boundary Integrity: No architectural or module boundary violations.
- Amendments: Verified against genuine contradictions.`;
}

const FAST_FAIL = (maturity: DraftThresholds, difficulty?: QuestDifficulty): string => {
  const diffTag = difficulty ? ` (${difficulty} difficulty)` : "";
  return `FAST-FAIL MODE: this draft is below the REVIEW MATURITY BAR${diffTag} (needs ${maturity.requirements} requirements, or 1 requirement + ${maturity.evidence} evidence items, with an actionable plan). Report exactly what structure is missing for the bar plus any requirement omissions from the request, then FAIL. Do NOT audit the plan in depth — the draft must be built up to the bar first.`;
};

export function buildReviewPrompt(
  kind: ReviewKind,
  qid: Qid,
  target: string,
  material: ReviewMaterial,
  maturity: DraftThresholds = DEFAULT_CONFIG.draftThresholds,
  belowBar = false,
): string {
  const header = kind === "draft"
    ? `ADVERSARIAL DRAFT REVIEW: ${qid} (target revision ${target})`
    : `VALIDATION REVIEW: ${qid} (target implementation snapshot ${target})`;
  const guidance = kind === "draft"
    ? draftGuidance(maturity, material.kind, material.difficulty)
    : validationGuidance(material.kind);
  const impl = material.implementationSummary
    ? `\nIMPLEMENTATION SUMMARY UNDER REVIEW:\n${material.implementationSummary}\n`
    : "";
  const fastFail = belowBar ? `\n${FAST_FAIL(maturity, material.difficulty)}\n` : "";
  return `# ${header}

You are an independent reviewer. You run in a fresh context: evaluate only the material below, never continue anyone's reasoning.
${READ_ONLY_RULES}
${guidance}
${contextBlock(material)}
${impl}
${SELF_ATTACK}
${fastFail}${OUTPUT_FORMAT}`;
}

export function buildContractReviewPrompt(
  qid: Qid,
  contractJson: string,
  diffStat: string,
  testLog: string,
): string {
  return `# TIER-2 CONTRACT AUDIT: ${qid}

You are a Contract Auditor. Verify that Sub-Quest ${qid} fulfilled its contract:
CONTRACT:
${contractJson}

GIT DIFF:
${diffStat}

TEST EXECUTION LOG:
${testLog}

Verify ONLY:
1. Did diff stay strictly within allowedPaths?
2. Did requiredTestCommands execute with exit code 0?
3. Does the diff implement the assigned acceptance criteria?
Do NOT debate architecture or system-wide preferences.

${OUTPUT_FORMAT}`;
}
