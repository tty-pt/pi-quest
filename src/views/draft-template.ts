// HIGH_LEVEL: #storage — the drafting workspace starts from a template.
export function renderDraftTemplate(name: string, objective: string): string {
  return `# ${name}

> Draft proposal under adversarial review. Only this file is writable while drafting.

## Original request

${objective}

## Amendments

<!-- Record any amendments resolving proven contradictions with the original request or technical invariants. Every amendment must cite repository evidence. -->

<!-- REVIEW & COMPLIANCE GUIDELINES (what the draft reviewer and validator enforce):
1. Complete Coverage: Address every requirement in the original request without arbitrary omissions.
2. Amendment Validity: Any amendment MUST resolve a proven contradiction against codebase reality or physical impossibility, citing concrete evidence.
3. Maturity Bar: Drafts require at least 2 requirements, or 1 requirement + 7 evidence items, with an actionable plan or authored analysis.
4. Validation Invariants: Zero placeholder code (TODO/FIXME/stubs), test receipt confirming clean run (exit code 0), zero boundary regressions. -->

## Requirements

<!-- Author each requirement as its own bullet (e.g. - R1: description). A draft reaches the review bar at 2 requirements, or 1 requirement + 7 evidence items, with an actionable plan mapping every requirement. -->

## Evidence

<!-- Record file-backed proof per requirement (file:line citations or measured verification). -->

## Sub-Quests

<!-- For complex tasks, define bounded sub-quests with assigned requirements, allowed paths, and verification commands. -->

## Analysis

<!-- Purely analytical quests (quest_update_state {kind: "analysis"}) deliver the written analysis here; it is their whole deliverable. Standard quests may leave this section empty or delete it. -->

## Implementation Plan
`;
}
