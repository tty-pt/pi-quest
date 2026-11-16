// HIGH_LEVEL: #storage — the drafting workspace starts from a template.
import type { QuestDifficulty } from "../config.ts";

export function extractInitialRequirements(objective: string): string[] {
  const clean = objective.trim();
  if (!clean) return [];

  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bulletItems: string[] = [];

  for (const line of lines) {
    if (/^#+\s+/.test(line)) continue;
    const match = line.match(/^(?:\d+[.)]|[-*+])\s+(.+)$/);
    if (match) {
      bulletItems.push(match[1].trim());
    }
  }

  if (bulletItems.length > 0) {
    return bulletItems.map((b, i) => `- R${i + 1}: ${b}`);
  }

  const contentLines = lines.filter((l) => !/^#+\s+/.test(l) && l.length > 15);
  if (contentLines.length > 1) {
    return contentLines.slice(0, 8).map((l, i) => `- R${i + 1}: ${l}`);
  }

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  if (sentences.length > 1) {
    return sentences.slice(0, 8).map((s, i) => `- R${i + 1}: ${s}`);
  }

  return [];
}

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

  const initialReqs = extractInitialRequirements(objective);
  const reqsBlock = initialReqs.length > 0
    ? `\n\n${initialReqs.join("\n")}`
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

<!-- Author each requirement as its own bullet (e.g. - R1: description). A draft reaches the review bar at 2 requirements, or 1 requirement + 7 evidence items, with an actionable plan mapping every requirement. -->${reqsBlock}

## Evidence

<!-- Record file-backed proof per requirement (file:line citations or measured verification). -->

## Assumptions & Falsification Criteria

<!-- Explicitly record key technical assumptions and what evidence/failure would falsify them.
     When a falsification condition is hit during implementation, pause and pivot rather than hacking around it. -->

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
    worktreePath?: string;
    worktreeBranch?: string;
  },
  goal: string,
): string {
  const reqs = contract.assignedRequirements && contract.assignedRequirements.length > 0
    ? contract.assignedRequirements.map((r, i) => {
      const trimmed = r.trim();
      if (trimmed.startsWith("-")) return trimmed;
      if (/^R\d+:/i.test(trimmed)) return `- ${trimmed}`;
      return `- R${i + 1}: ${trimmed}`;
    }).join("\n")
    : `- R1: Fulfill sub-quest contract: ${contract.title}`;
  const paths = contract.allowedPaths && contract.allowedPaths.length > 0
    ? contract.allowedPaths.map((p) => `- Target scope: ${p}`).join("\n")
    : "- Target scope: all workspace files";
  const tests = contract.requiredTestCommands && contract.requiredTestCommands.length > 0
    ? contract.requiredTestCommands.map((t) => `- Verification: ${t}`).join("\n")
    : "- Verification: make test";

  const wtBlock = contract.worktreePath
    ? `\n## Isolated Worktree\n- Path: ${contract.worktreePath}${contract.worktreeBranch ? ` (branch: ${contract.worktreeBranch})` : ""}\n`
    : "";

  return `# Quest ${childQid}: ${contract.title}

> Sub-quest of parent ${parentQid}. Active in drafting mode.

## Original request

${goal}

## Context / Background Discussion
- Parent Quest: ${parentQid} (.pi/quest/future/${parentQid}.md)
${wtBlock}
## Requirements
${reqs}

## Evidence
${paths}
${tests}

## Sub-Quests
<!-- Sub-quests can be spawned recursively via quest_subquest if this task discovers mid-quest complexity: -->

## Implementation Plan
<!-- Author discrete step-by-step implementation plan below: -->
`;
}
