// HIGH_LEVEL: #surviving — state re-read before every reply.
// SPEC: B1.6 (pending flag visible to the agent).
import type { Pi } from "../hooks/events";
import { getState } from "../app/store";
import type { QuestState } from "../domain/quest";
import { draftPath } from "../domain/paths";
import { getReviewCriteriaSummary } from "../review/prompts";
import { SNAPSHOT_TYPE } from "./snapshots";
import {
  renderCompactionPointer,
  renderSubquestResumption,
  takeCompactionPointer,
  takeSubquestResumption,
} from "./compaction-handoff";
import type { ActionRule } from "../config/schema";
import { getLastLoadedConfig } from "../config/loader";
import { hasInFlight } from "../review/tracker";
import { syncHarnessCwd } from "../utils/git";

function applyCaptures(command: string, match: RegExpMatchArray | null): string {
  if (!match) return command;
  let out = command;
  for (let i = 1; i < match.length; i++) {
    out = out.replaceAll(`$${i}`, match[i] ?? "");
  }
  return out;
}

export function formatTargetedActionGuidance(
  touchedFiles: readonly string[],
  rules: readonly ActionRule[],
): string | null {
  if (!touchedFiles || touchedFiles.length === 0 || !rules || rules.length === 0) return null;
  const lines: string[] = [];

  for (const rule of rules) {
    try {
      const re = new RegExp(rule.pattern);
      const matched = touchedFiles.filter((f) => re.test(f));
      if (matched.length === 0) continue;
      const m = matched[0].match(re);
      const scope = rule.scope ?? rule.name ?? "modified scope";
      const builds = (rule.buildCommands ?? []).map((cmd) => applyCaptures(cmd, m));
      const tests = (rule.testCommands ?? []).map((cmd) => applyCaptures(cmd, m));
      const warning = rule.warning ?? "Do NOT run full repository test suite (make test); execute only the targeted actions above.";

      lines.push(`  • Scope: ${scope} (${matched.length} file(s), e.g. ${matched[0]})`);
      if (builds.length > 0) lines.push(`    Rebuild: ${builds.join(" && ")}`);
      if (tests.length > 0) lines.push(`    Verify: ${tests.join(" && ")}`);
      lines.push(`    Directive: ${warning}`);
    } catch {
      continue;
    }
  }

  if (lines.length === 0) return null;
  return `[Targeted Actions for Modified Files]:\n${lines.join("\n")}`;
}

function renderWorktreeIsolation(state: QuestState): string {
  const activeWt = state.worktreePath ?? state.contract?.worktreePath;
  if ((state.phase === "implementing" || state.phase === "validating") && activeWt) {
    return `\n[SCRATCH WORKTREE ISOLATION ACTIVE]:\nAn isolated scratch worktree is leased at: ${activeWt}${state.worktreeBranch ? ` (branch: ${state.worktreeBranch})` : ""}.\n• ALL file modifications and terminal commands MUST target this worktree.\n• NEVER edit or run commands in the primary repository root.\n• If using native ACP tools, ensure all paths are within ${activeWt} and commands cd into it.`;
  }
  return "";
}

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

  // Grounding: Inject original user objective and instructions on every turn
  if (state.objective && state.objective.trim().length > 0) {
    const boundedObjective = state.objective.trim().length > 300
      ? `${state.objective.trim().slice(0, 300)}…`
      : state.objective.trim();
    line += `\n[User Objective & Instructions]: "${boundedObjective}"`;
  }

  // Anti-Amnesia: Inject active requirements checklist during implementing and validating phases
  if ((state.phase === "implementing" || state.phase === "validating") && state.rtm && state.rtm.length > 0) {
    const rtmLines = state.rtm.map((r) => `  • [${r.status === "satisfied" ? "x" : " "}] ${r.id}: ${r.description} (status: ${r.status})`).join("\n");
    line += `\n[Active Requirements Checklist]:\n${rtmLines}`;
  }

  // Anti-Amnesia: Inject active test verification receipt during implementing and validating phases
  if ((state.phase === "implementing" || state.phase === "validating") && (state.lastPassingTestReceipt || state.lastTestReceipt)) {
    const r = state.lastPassingTestReceipt ?? state.lastTestReceipt;
    if (r) {
      line += `\n[Last Verification Test Receipt]: \`${r.command}\` (${r.exitCode === 0 ? "PASS" : `FAIL exit ${r.exitCode}`})`;
    }
  }

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

  // Pre-Question Checklist: Remind the agent to verify all user requests, present analysis in chat, and keep question concise
  line += `\n[Pre-Question Checklist]: Before asking the user any questions (via quest_ask_human or otherwise), verify that all user requests, constraints, and directives are completely and faithfully captured in the plan file. In addition: (1) write your quest analysis in your chat message so the operator can review it in the session; (2) keep quest_ask_human {question: ...} concise (e.g. "Do you approve the implementation plan?"); (3) NEVER put the plan or markdown sections inside the question parameter; (4) for plan approval, default must NOT confirm (use default: "hold") — pressing Escape cancels without approving, and the timeout gives 5 minutes for review.`;

  if (state.qid !== null && hasInFlight(state.qid)) {
    line += `\n[IN-FLIGHT REVIEW RUNNING]: An adversarial review is currently running in the background for quest ${state.qid}. Do NOT execute tool calls, edits, or commands. Yield immediately and wait for the review verdict.`;
  }

  if (state.phase === "implementing" && state.circuitBreakerActive) {
    line += `\n[CIRCUIT BREAKER ACTIVE - RE-EVALUATE ASSUMPTIONS]: Repeated test/build failures detected. Mutating file tools are paused. Stop tinkering. Run a diagnostic audit: identify which assumption from your plan was violated by reality, formulate a new hypothesis, and update state via quest_update_state {refinement: '...'} or {planRevision: '...'}.`;
  }

  if (state.phase === "implementing") {
    line += `\n[Implementation Depth Directive]: Implement and verify the full substantive scope across all requirements in your plan before claiming completion. Try implementing across your planned files and components before attempting to conclude the quest. Do not prematurely claim complete after isolated partial edits.`;
  }

  if (state.phase === "implementing" && state.touchedFiles && state.touchedFiles.length > 0) {
    const config = getLastLoadedConfig();
    const guidance = formatTargetedActionGuidance(state.touchedFiles, config.actionMatrix);
    if (guidance) line += `\n${guidance}`;
  }

  line += renderWorktreeIsolation(state);

  if (state.phase === "drafting") {
    const criteria = getReviewCriteriaSummary(state.phase, state.kind);
    line += `\n[Analysis-First Workflow]: (1) Investigate root cause & architecture deeply. (2) Author ## Implementation Plan (or ## Analysis for analysis quests) via quest_update_state. Verify all user requests are in the plan file before asking any questions. (3) Automated review validates the draft before implementation begins.`;
    line += `\n[Compliance Criteria]\n${criteria}`;
  }
  line += `\n[Conversational Priority]: If the user's current message is a direct question or conversational remark, answer the user directly first before continuing quest work.`;
  return line;
}

export function injectQuestContext(pi: Pi): void {
  pi.on("before_agent_start", (eventUnknown: unknown) => {
    try {
      const state = getState();
      if (state.disabled === true || state.phase === "idle") {
        syncHarnessCwd(null, pi);
        return undefined;
      }
      const activeWt = (state.phase === "implementing" || state.phase === "validating")
        ? (state.worktreePath ?? state.contract?.worktreePath)
        : null;
      syncHarnessCwd(activeWt, pi);

      const pointer = takeCompactionPointer(state.qid);
      const resumption = takeSubquestResumption(state.qid);
      const compactionBlock = pointer === null ? "" : renderCompactionPointer(pointer);
      const resumptionBlock = resumption === null ? "" : renderSubquestResumption(resumption);
      const content = contextLine(state) + compactionBlock + resumptionBlock;
      const event = eventUnknown as { systemPromptOptions?: { sections?: Record<string, string> } } | undefined;
      if (event?.systemPromptOptions && typeof event.systemPromptOptions === "object") {
        if (!event.systemPromptOptions.sections) {
          event.systemPromptOptions.sections = {};
        }
        event.systemPromptOptions.sections["quest_context"] = content;
        return undefined;
      }
      return { message: { customType: SNAPSHOT_TYPE, content } };
    } catch {
      return undefined;
    }
  });
}
