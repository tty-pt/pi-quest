// HIGH_LEVEL: #review request — brief identifies qid, type, target, plan, evidence, criteria.
// HIGH_LEVEL: #reviewer independence — minimal info, judge and report.
// HIGH_LEVEL: #review independence — no inherited context, no prior conclusions.
// HIGH_LEVEL: #independent review contexts — fresh context, no inherited reasoning.
import type { Qid } from "../domain/qid";
import type { QuestDifficulty, QuestKind, ReviewKind, ReviewVerdict } from "../domain/quest";
import { DEFAULT_CONFIG, type DraftThresholds } from "../config";
import {
  READ_ONLY_RULES,
  SELF_ATTACK,
  OUTPUT_FORMAT,
  AMENDMENT_VALIDITY_GUIDANCE,
  contextBlock,
  type ReviewMaterial,
} from "./prompt-blocks";

export {
  READ_ONLY_RULES,
  SELF_ATTACK,
  OUTPUT_FORMAT,
  AMENDMENT_VALIDITY_GUIDANCE,
  contextBlock,
  type ReviewMaterial,
};

function draftGuidance(
  maturity: DraftThresholds,
  kind: QuestKind | undefined,
  difficulty?: QuestDifficulty,
): string {
  const diffGuidance = difficulty === "trivial"
    ? `\nPOSTURE (TRIVIAL DIFFICULTY): This task is small/lightweight in scope. Verify the targeted fix and verification step; do NOT demand multi-phase sequencing, extra requirements, or excessive evidence.\n`
    : difficulty === "complex"
    ? `\nPOSTURE (COMPLEX DIFFICULTY): This task has high blast radius or system complexity. When multiple independent work streams or distinct sub-systems exist, recommend modular sub-quests (e.g. - [ ] SQ1: Goal [paths: ...] [tests: ...] [req: ...]); for unified or cohesive tasks, accept clear single-lane step sequencing without requiring artificial sub-quest decomposition. Scrutinize boundary invariants, risk mitigation, and requirement coverage.\n`
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
1. Whether the plan addresses the objective; 2. Whether requirements were omitted; 3. Whether claims are backed by cited file:line evidence; 4. Whether steps are actionable; 5. Whether assumptions remain unverified; 6. Whether it stays in scope; 7. Whether it contradicts itself; 8. Whether it credibly satisfies the request.
${AMENDMENT_VALIDITY_GUIDANCE}${diffGuidance}
MATURITY BAR: a reviewable plan has ${maturity.requirements} requirements, or 1 requirement plus ${maturity.evidence} evidence items, with an actionable ## Implementation Plan section. Below the bar, FAIL fast naming exactly what is missing.
Distinguish: user requirement (blocks) vs technical constraint (binds) vs reviewer preference (NEVER blocks).`;
}

function validationGuidance(kind: QuestKind | undefined): string {
  if (kind === "analysis") {
    return `WHAT YOU MUST EVALUATE (VALIDATION):
You are an adversarial compliance auditor. You review the ANALYSIS deliverable against the original request: is it complete, grounded, and strictly obedient to what was asked?

USER REQUEST SUPREMACY:
The ORIGINAL REQUEST is the supreme acceptance criterion. The author cannot unilaterally drop, soften, or substitute requirements.
1. Every requirement and intent in the ORIGINAL REQUEST is thoroughly addressed by the analysis;
2. Conclusions are grounded — spot-check claims against the repository and the RESEARCH TRANSCRIPT extract;
3. The analysis stays in scope; covering a different problem or substituting a simpler task is an automatic FAIL;
4. The research backing is adequate for the claim made;
5. All RECORDED AMENDMENTS are valid: each must resolve a genuine, proven contradiction backed by repository evidence.
Reviewer preference NEVER blocks; only unmet requirements, ungrounded claims, invalid amendments, or out-of-scope drift do.`;
  }
  return `WHAT YOU MUST EVALUATE (ROOT INTEGRATION VALIDATION):
You are an adversarial compliance auditor defending the codebase from incomplete, shallow, or drifted work.
You review the IMPLEMENTATION against the original request, approved plan, recorded amendments, and git diff:

USER REQUEST SUPREMACY:
The ORIGINAL REQUEST (and RTM checklist) is the supreme contract.
The APPROVED PLAN is merely the implementer's internal proposal, NOT the acceptance specification.
If the implementation follows the plan but fails to fulfill what the user asked in the ORIGINAL REQUEST, you MUST issue VERDICT: FAIL. The agent is never permitted to unilaterally redefine success or drop requested features.

AUDIT CHECKLIST:
1. Every item, clause, and intent in the ORIGINAL REQUEST and RTM checklist must be fully implemented in the code:
   - When GIT DIFF is provided: Verify that the diff directly implements the requested features across all modified repositories and submodules. If any requirement is missing or only partially addressed in the diff, you MUST issue VERDICT: FAIL.
   - When NO VCS DIFF is available (non-git workspace or external files without VCS): You are an autonomous auditor equipped with read, search, and inspection tools. You MUST directly inspect the target files in the workspace to verify that the implementation is present and satisfies the user's request.
2. The TEST VERIFICATION RECEIPT must confirm clean execution (exit code 0) of verification commands relevant to the modified files and scope. Do not fail for unrun full-repo regression suites when targeted verification for the changed code ran cleanly.
3. Scan the newly introduced changes (in the diff or newly authored code) for placeholder implementations: newly added TODO, FIXME, stub functions returning dummy values, or commented-out tests. Do not fail for pre-existing TODO comments in untouched legacy lines. If new placeholders or stubs were introduced by this work, issue VERDICT: FAIL.
4. Ensure no regression of repository boundaries (e.g. #ifdef in pure-C isomorphic UX, cross-module #include "*.c").
5. When a revision history is present, judge every plan move: a revision that corrected an impossibility while holding the objective is legitimate; a revision that weakens the acceptance bar to fit what was built must FAIL.
6. Verify all RECORDED AMENDMENTS: each must resolve a genuine, proven contradiction backed by code reality. If an amendment dropped user requirements without an actual impossibility, issue VERDICT: FAIL.
7. ANTI-HACK / ROOT-CAUSE AUDIT:
   Inspect the diff specifically for workarounds designed to appease tests:
   - Did the agent bypass the underlying architectural issue with hardcoded special cases or dummy branches?
   - Did the agent patch a symptom in the caller instead of fixing the root cause in the owning subsystem?`;
}

const FAST_FAIL = (maturity: DraftThresholds, difficulty?: QuestDifficulty): string => {
  const diffTag = difficulty ? ` (${difficulty} difficulty)` : "";
  return `FAST-FAIL MODE: this draft is below the REVIEW MATURITY BAR${diffTag} (needs ${maturity.requirements} requirements, or 1 requirement + ${maturity.evidence} evidence items, with an actionable plan). Report exactly what structure is missing for the bar plus any requirement omissions from the request, then FAIL. Do NOT audit the plan in depth — the draft must be built up to the bar first.`;
};

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
- User Request Supremacy: Full fidelity to original user request; following plan but failing request is a FAIL.
- Diff Completeness: Every request item & RTM requirement implemented in git diff or verified via direct file inspection.
- RTM Audit: You MUST verify every item in the REQUIREMENTS TRACEABILITY MATRIX (RTM) against the git diff and test logs before issuing VERDICT: PASS.
- Verification: Clean test execution (exit code 0) for the modified scope with zero regressions.
- Zero Placeholders: No TODO/FIXME/stubs or dummy returns.
- Anti-Hack & Root-Cause: Architectural root-cause fix, zero symptom patching, zero weakened tests.
- Boundary Integrity: No architectural or module boundary violations.
- Amendments: Verified against genuine contradictions.`;
}

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

export function buildPlanApprovalPrompt(
  qid: Qid,
  target: string,
  material: ReviewMaterial,
): string {
  const diffTag = material.difficulty ? ` (${material.difficulty} difficulty)` : "";
  return `# PLAN APPROVAL VALIDATION: ${qid} (target revision ${target})${diffTag}

You are an independent, adversarial plan validation auditor.
The agent is about to ask the human operator to approve the implementation plan.
Your MANDATORY job is to strictly validate the plan and verify that ALL user requests, instructions, and directives are completely and faithfully captured in the plan file BEFORE the approval question can be presented to the user.

${READ_ONLY_RULES}

WHAT YOU MUST EVALUATE (PLAN APPROVAL AUDIT):
1. USER REQUEST COMPLETENESS & FIDELITY:
   - Carefully review the ORIGINAL REQUEST and all ACTIVE USER DIRECTIVES / REFINEMENTS below.
   - Verify that EVERY requirement, constraint, and directive from the user is explicitly and completely addressed in the plan file (under ## Requirements and/or ## Implementation Plan).
   - If ANY user request is omitted, dropped, diluted, or deferred without justification, you MUST issue VERDICT: FAIL specifying the exact missing requests.
   - The agent cannot unilaterally drop, soften, or alter user requirements.
2. PLAN SOUNDNESS & ACTIONABILITY:
   - Does the plan provide concrete, actionable steps rather than vague hand-waving?
   - Are the work sequence and architecture sound?
   - Are there explicit verification steps (tests/checks) to prove the work is correct?
   - Does the plan contradict existing repository reality or invariants?

${contextBlock(material)}

${SELF_ATTACK}

${OUTPUT_FORMAT}`;
}
