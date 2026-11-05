// HIGH_LEVEL: #storage — the drafting workspace starts from a template.
import type { QuestDifficulty } from "../config.ts";

export function renderDraftTemplate(
  name: string,
  objective: string,
  context?: string,
  difficulty?: QuestDifficulty,
  invariantsBlock?: string,
): string {
  const contextSection = context && context.trim().length > 0
    ? `\n## Context / Background Discussion\n\n${context.trim()}\n`
    : "";

  const invBlockText = invariantsBlock && invariantsBlock.trim().length > 0
    ? `\n${invariantsBlock.trim()}\n`
    : "";

  const subquestsSection = difficulty === "complex"
    ? `\n## Sub-Quests\n\n<!-- COMPLEX TASK DETECTED: Decompose this task into sequential, bounded sub-quests.
     Each sub-quest executes in a focused worker lane with explicit allowedPaths,
     required test commands, and assigned requirements: -->
- [ ] SQ1: Core architecture & contracts [paths: ...] [tests: npm test] [req: R1]
- [ ] SQ2: Feature implementation & integration [paths: ...] [tests: npm test] [req: R2]
- [ ] SQ3: End-to-end verification & regression tests [paths: tests/...] [tests: npm test] [req: R3]\n`
    : "";

  return `# ${name}

> Draft proposal under adversarial review. Only this file is writable while drafting.

## Original request

${objective}
${contextSection}
## Amendments

<!-- Record any amendments resolving proven contradictions with the original request or technical invariants. Every amendment must cite repository evidence. -->

<!-- REVIEW & COMPLIANCE GUIDELINES (what the draft reviewer and validator enforce):
1. Complete Coverage: Address every requirement in the original request without arbitrary omissions.
2. Amendment Validity: Any amendment MUST resolve a proven contradiction against codebase reality or physical impossibility, citing concrete evidence.
3. Maturity Bar: Drafts require at least 2 requirements, or 1 requirement + 7 evidence items, with an actionable plan or authored analysis.
4. Validation Invariants: Zero placeholder code (TODO/FIXME/stubs), test receipt confirming clean run (exit code 0), zero boundary regressions. -->${invBlockText}

## Requirements

<!-- Author each requirement as its own bullet (e.g. - R1: description). A draft reaches the review bar at 2 requirements, or 1 requirement + 7 evidence items, with an actionable plan mapping every requirement. -->

## Evidence

<!-- Record file-backed proof per requirement (file:line citations or measured verification). -->

${subquestsSection}

## Analysis

<!-- Purely analytical quests (quest_update_state {kind: "analysis"}) deliver the written analysis here; it is their whole deliverable. Standard quests may leave this section empty or delete it. -->

## Implementation Plan
`;
}

export function renderChildDraftTemplate(
  childQid: string,
  parentQid: string,
  contract: {
    title: string;
    assignedRequirements?: string[];
    allowedPaths?: string[];
    requiredTestCommands?: string[];
    acceptanceCriteria?: string[];
  },
  goal: string,
): string {
  const reqs = contract.assignedRequirements && contract.assignedRequirements.length > 0
    ? contract.assignedRequirements.map((r) => `- [ ] ${r}`).join("\n")
    : "- (inherited from parent)";
  const paths = contract.allowedPaths && contract.allowedPaths.length > 0
    ? contract.allowedPaths.map((p) => `- ${p}`).join("\n")
    : "- (all workspace files)";
  const tests = contract.requiredTestCommands && contract.requiredTestCommands.length > 0
    ? contract.requiredTestCommands.map((t) => `- ${t}`).join("\n")
    : "- npm test";

  return `# Quest ${childQid}: ${contract.title}

> Sub-quest of parent ${parentQid}. Active in implementation mode.

## Original request

${goal}

## Parent Quest Link
- Parent: ${parentQid} (.pi/quest/future/${parentQid}.md)

## Assigned Requirements
${reqs}

## Primary Focus Paths
${paths}

## Verification Commands
${tests}

## Implementation Plan
Proceed autonomously with the sub-quest contract to implement assigned requirements.
`;
}
