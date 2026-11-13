// HIGH_LEVEL: #storage — the generated quest view and slim archives.
// The transcript is the truth; these files are views only.
import { rm } from "node:fs/promises";
import type { ArchivedOutcome, QuestState } from "../domain/quest";
import { draftFilePath, stageDirPath } from "../files";
import type { Qid } from "../domain/qid";
import type { Pi } from "../hooks/events";

export function renderQuestView(state: QuestState): string {
  const lines: string[] = [
    "<!-- GENERATED VIEW — the session transcript is the truth. Do not hand-edit; edits are not read back. -->",
    `# Quest ${state.qid ?? "(none)"}${state.name ? ` — ${state.name}` : ""}`,
    "",
    `- Phase: ${state.phase}`,
    `- Objective: ${state.objective || "(none)"}`,
    `- Exact next action: ${state.exactNextAction || "(none)"}`,
  ];
  if (state.pendingRootRequest) lines.push("", "## Original request", "", state.pendingRootRequest);
  if (state.refinements.length > 0) {
    lines.push("", "## Refinements", "", ...state.refinements.map((r) => `- ${r}`));
  }
  if (state.setbacks.length > 0) {
    lines.push("", "## Setbacks (advisory)", "", ...state.setbacks.map((s) => `- ${s.reason} — ${s.evidence.join("; ")}`));
  }
  if (state.amendments.length > 0) {
    lines.push("", "## Amendments", "", ...state.amendments.map((a) => `- ${a.change} (${a.reasons})`));
  }
  if (state.children.length > 0) {
    lines.push("", "## Sub-quests", "", ...state.children.map((c) => `- ${c.qid} (${c.status}): ${c.brief}${c.findings ? ` — ${c.findings}` : ""}`));
  }
  if (state.reviewDialogue.length > 0) {
    lines.push("", "## Review dialogue", "");
    for (const round of state.reviewDialogue) {
      lines.push(`### Round ${round.round} (${round.verdictBefore}${round.verdictAfter ? `→${round.verdictAfter}` : ""})`);
      lines.push(`Reviewer: ${round.reviewerFindings}`);
      lines.push(`Implementer: ${round.implementerRebuttal}`, "");
    }
  }
  if (state.humanAnswers.length > 0) {
    lines.push("", "## Human answers", "", ...state.humanAnswers.map((h) => `- Q: ${h.question} A: ${h.answer}${h.late ? " (late)" : ""}`));
  }
  if (state.lastReview) {
    lines.push("", "## Last review", "", `${state.lastReview.verdict} on ${state.lastReview.target}: ${state.lastReview.findings}`);
  }
  if (state.archivedOutcome) lines.push("", `Archived: ${state.archivedOutcome}`);
  return lines.join("\n") + "\n";
}

export interface RunManifest {
  qid: string | null;
  name: string;
  outcome: ArchivedOutcome;
  archivedAt: string;
  summary: string | null;
  parentQid: string | null;
}

export function renderManifest(state: QuestState, outcome: ArchivedOutcome, summary: string | null): string {
  const manifest: RunManifest = {
    qid: state.qid,
    name: state.name,
    outcome,
    archivedAt: new Date().toISOString(),
    summary,
    parentQid: state.parentQid,
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

export async function archiveQuestFiles(
  _pi: Pi,
  cwd: string,
  state: QuestState,
  _outcome: ArchivedOutcome,
  _summary: string | null,
): Promise<string> {
  if (state.qid === null) throw new Error("cannot archive without a qid");
  const qid: Qid = state.qid;
  await rm(stageDirPath(cwd, qid), { recursive: true, force: true });
  await rm(draftFilePath(cwd, qid), { force: true });
  return "";
}
