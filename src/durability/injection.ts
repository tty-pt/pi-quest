// HIGH_LEVEL: #surviving — state re-read before every reply.
// SPEC: B1.6 (pending flag visible to the agent).
import type { Pi } from "../hooks/events";
import { getState } from "../app/store";
import type { QuestState } from "../domain/quest";
import { draftPath } from "../domain/paths";
import { getReviewCriteriaSummary } from "../review/prompts";
import { SNAPSHOT_TYPE } from "./snapshots";

function contextLine(state: QuestState): string {
  const id = state.qid ?? "none";
  const pending = state.snapshotPending ? " (snapshot pending)" : "";
  const review = state.activeReview === null
    ? ""
    : ` Review ${state.activeReview.kind} running on ${state.activeReview.target}.`;
  const draft = state.phase === "drafting" && state.qid !== null
    ? ` Draft file: ${draftPath(state.qid)}.`
    : "";
  let line = `Quest ${id} — phase ${state.phase}${pending}.${review}${draft} ${state.exactNextAction}`;

  // Anti-Amnesia: Inject active mid-quest user directives (compact, budget-bounded)
  if (state.refinements.length > 0 && (state.phase === "drafting" || state.phase === "implementing")) {
    const recent = state.refinements.slice(-4);
    const directiveLines = recent.map((r, i) => `  • [D${state.refinements.length - recent.length + i + 1}] "${r}" (Constraint: adopt via amendment; Separable: spawn via quest_subquest)`).join("\n");
    line += `\n[Active Mid-Quest Directives - Must be satisfied]:\n${directiveLines}`;
  }

  // Inject active sub-quests status if any
  const runningChildren = state.children.filter((c) => c.status === "running");
  if (runningChildren.length > 0) {
    line += `\n[Active Sub-Quests]: ${runningChildren.map((c) => `${c.qid} (${c.brief})`).join(", ")}`;
  }

  if (state.phase === "drafting" || state.phase === "implementing") {
    const criteria = getReviewCriteriaSummary(state.phase, state.kind);
    line += `\n[Compliance Criteria]\n${criteria}`;
  }
  return line;
}

export function injectQuestContext(pi: Pi): void {
  pi.on("before_agent_start", () => {
    try {
      const state = getState();
      if (state.phase === "idle") return undefined;
      return { message: { customType: SNAPSHOT_TYPE, content: contextLine(state) } };
    } catch {
      return undefined;
    }
  });
}
