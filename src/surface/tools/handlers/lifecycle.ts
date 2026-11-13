import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { readQuestConfig } from "../../../config.ts";
import { getState, updateState } from "../../../app/store.ts";
import { emitNow, sendSteer } from "../../../app/interpreter.ts";
import type { QuestState } from "../../../domain/quest.ts";
import { claimComplete, demoteToDrafting, demoteToImplementing } from "../../../domain/transitions.ts";
import { unfinishedChildren } from "../../../domain/children.ts";
import type { Pi, PiCtx } from "../../../hooks/events.ts";
import { ensureValidationFlow } from "../../../validation/flow.ts";
import { assertCompletionEligibility, getLatestTestExecution } from "../../../validation/evidence-gate.ts";
import { setDocStatus } from "../../../durability/quest-doc-io.ts";

function filterWorkspaceTouched(cwd: string, files: string[]): string[] {
  const relTouched: string[] = [];
  for (const f of files) {
    const full = isAbsolute(f) ? f : resolve(cwd, f);
    if (full.startsWith(cwd + "/")) {
      const r = full.slice(cwd.length + 1);
      if (!r.startsWith(".pi/quest/")) relTouched.push(r);
    }
  }
  return relTouched;
}

function buildDiffResolvers(
  ctx: PiCtx,
  state: QuestState,
  pi: Pi,
): { getDiffStat: () => Promise<string>; getDiffPatch: () => Promise<string> } {
  const targetCwd = state.worktreePath ?? ctx.cwd;
  const hasGit = existsSync(join(targetCwd, ".git"));
  const touched = state.touchedFiles ?? [];
  if (!hasGit) {
    return {
      getDiffStat: async () => touched.length > 0 ? `${touched.length} file(s) modified in session` : "",
      getDiffPatch: async () => "",
    };
  }

  const relTouched = filterWorkspaceTouched(targetCwd, touched);
  const pathArgs = relTouched.length > 0 ? ["--", ...relTouched] : [];

  const runGitDiff = async (...args: string[]) => {
    if (state.baseCommit) {
      try {
        const verify = (await pi.exec("git", ["rev-parse", "--verify", `${state.baseCommit}^{commit}`], { cwd: targetCwd })) as
          | { code?: number; exitCode?: number } | undefined;
        if ((verify?.code ?? verify?.exitCode) === 0) {
          const res = (await pi.exec("git", ["diff", ...args, state.baseCommit, ...pathArgs], { cwd: targetCwd })) as
            | { code?: number; exitCode?: number; stdout?: string; output?: string } | undefined;
          const out = res?.stdout ?? res?.output ?? "";
          if ((res?.code ?? res?.exitCode) === 0) return out;
        }
      } catch { /* continue */ }
    }
    for (const ref of ["HEAD", "HEAD~1"]) {
      try {
        const res = (await pi.exec("git", ["diff", ...args, ref, ...pathArgs], { cwd: targetCwd })) as
          | { code?: number; exitCode?: number; stdout?: string; output?: string } | undefined;
        const out = res?.stdout ?? res?.output ?? "";
        if ((res?.code ?? res?.exitCode) === 0 && out.trim().length > 0) return out;
      } catch { /* continue */ }
    }
    return "";
  };

  return {
    getDiffStat: async () => {
      const stat = await runGitDiff("--stat");
      if (stat.trim().length > 0) return stat;
      return touched.length > 0 ? `${touched.length} file(s) modified in session` : "";
    },
    getDiffPatch: () => runGitDiff(),
  };
}

export async function claimForValidation(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
): Promise<QuestState> {
  if (state.phase !== "implementing") throw new Error(`cannot claim completion from phase ${state.phase}`);
  const qid = state.qid;
  if (qid === null) throw new Error("cannot claim completion without an active quest");

  const unfinished = unfinishedChildren(state);
  if (unfinished.length > 0) {
    throw new Error(`complete blocked: unfinished children ${unfinished.map((c) => c.qid).join(", ")}`);
  }

  const lintRules = (await readQuestConfig(ctx.cwd)).lintRules;
  const { getDiffStat, getDiffPatch } = buildDiffResolvers(ctx, state, pi);

  await assertCompletionEligibility(state, {
    lintRules,
    getDiffStat,
    getDiffPatch,
    getLatestTest: () => state.lastTestReceipt ?? getLatestTestExecution(),
  });

  const claimed = updateState((s) => claimComplete(s));
  await setDocStatus(ctx, qid, "validating", false);
  emitNow(pi);
  sendSteer(pi, `Quest ${claimed.qid} claimed complete. Validator booting against the approved plan.`);
  void ensureValidationFlow(pi, ctx);
  return getState();
}

export async function applyContinueWorkParam(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  params: Record<string, unknown>,
  applied: string[],
): Promise<{ state: QuestState }> {
  if (params["continueWork"] === true && state.phase === "validating" && state.qid !== null) {
    const isAnalysis = state.kind === "analysis";
    const demoted = updateState((s) => (isAnalysis ? demoteToDrafting(s) : demoteToImplementing(s)));
    await setDocStatus(ctx, state.qid, isAnalysis ? "drafting" : "implementing", false);
    emitNow(pi);
    applied.push(
      isAnalysis
        ? "returned to drafting to revise the delivered analysis"
        : "returned to implementing to continue the work",
    );
    sendSteer(
      pi,
      `Quest ${demoted.qid} returned to ${isAnalysis ? "drafting" : "implementing"} (continueWork: true).`,
    );
    return { state: demoted };
  }
  return { state };
}
