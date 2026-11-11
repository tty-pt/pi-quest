// HIGH_LEVEL: #tools (main agent) — quest_subquest.
// HIGH_LEVEL: #sub-quests — full-lifecycle units with their own quest id.
import { getState, replaceState, updateState } from "../../app/store";
import { emitNow, sendSteer } from "../../app/interpreter";
import { readQuestConfig } from "../../config";
import { createQuest } from "../../domain/quest";
import { addChild } from "../../domain/children";
import { pushStackFrame } from "../../domain/stack";
import type { SubQuestContract } from "../../domain/contract";
import { nextQid, type Qid } from "../../domain/qid";
import { encodeSnapshot, SNAPSHOT_TYPE } from "../../durability/snapshots";
import type { Pi, PiCtx, PiToolSpec } from "../../hooks/events";
import {
  createWorktree,
  findPrimaryRepoRoot,
  commitMilestone,
  acquireWarmSlot,
  syncHarnessCwd,
  type PoolProgressNotifier,
} from "../../utils/git";
import { ensureChildDraftFile, listKnownQids } from "../../files";
import { textResult } from "./reply";
import { join } from "node:path";

export interface ChildQuestContractParams {
  assignedRequirements?: string[];
  allowedPaths?: string[];
  requiredTestCommands?: string[];
  acceptanceCriteria?: string[];
  maxTurns?: number;
  worktree?: boolean;
  worktreePath?: string;
  worktreeBranch?: string;
}

export async function createChildQuest(
  pi: Pi,
  ctx: PiCtx,
  goal: string,
  brief: string,
  switchNow: boolean,
  contractParams?: ChildQuestContractParams,
): Promise<{ childQid: Qid; switched: boolean; worktreePath?: string; worktreeBranch?: string }> {
  const parent = getState();
  if (parent.qid === null) throw new Error("no active quest to parent the sub-quest");
  const config = await readQuestConfig(ctx.cwd);
  const depth = parent.depth + 1;
  if (depth > config.depthCap) {
    throw new Error(`depth cap ${config.depthCap} reached — fold this work into the parent quest`);
  }
  const childQid = nextQid(Date.now() / 1000, await listKnownQids(ctx.cwd));

  const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
  let worktreePath = contractParams?.worktreePath;
  let worktreeBranch = contractParams?.worktreeBranch;

  const autoWt = config.gitWorkflow?.worktreeMode === "auto" || config.gitWorkflow?.worktreeMode === "pool";
  const parentWorktreePath = parent.worktreePath ?? parent.contract?.worktreePath;
  const parentWorktreeBranch = parent.worktreeBranch ?? parent.contract?.worktreeBranch;
  const rootOwnerQid = (parent.questStack && parent.questStack.length > 0 ? parent.questStack[0].qid : undefined) ?? parent.parentQid ?? parent.qid;
  const inheritParentWorktree = Boolean(parentWorktreePath && !worktreePath);

  if (inheritParentWorktree) {
    worktreePath = parentWorktreePath;
    worktreeBranch = parentWorktreeBranch;
  } else if (contractParams?.worktree === true || (autoWt && !parentWorktreePath) || worktreePath !== undefined) {
    const notifier: PoolProgressNotifier = {
      notify: (msg, lvl) => ctx.ui?.notify?.(msg, lvl),
      setStatus: (k, txt) => ctx.ui?.setStatus?.(k, txt),
    };
    const leaseOwnerQid = !parentWorktreePath && contractParams?.worktree !== true ? rootOwnerQid : childQid;
    const poolRes = await acquireWarmSlot(
      primaryRoot,
      leaseOwnerQid,
      parent.baseCommit ?? null,
      config.gitWorkflow,
      pi,
      notifier,
    );
    if (poolRes.ok && poolRes.slotPath && poolRes.slotBranch) {
      worktreePath = poolRes.slotPath;
      worktreeBranch = poolRes.slotBranch;
      if (leaseOwnerQid === rootOwnerQid) {
        updateState((s) => ({
          ...s,
          worktreePath: poolRes.slotPath,
          worktreeBranch: poolRes.slotBranch,
          snapshotPending: true,
        }));
      }
      if (config.gitWorkflow?.milestoneCommits) {
        await commitMilestone(worktreePath, {
          qid: childQid,
          type: "start",
          label: goal.trim(),
        }, pi, worktreeBranch);
      }
    } else {
      if (contractParams?.worktree === true) {
        throw new Error(`failed to acquire scratch workspace for ${childQid}: ${poolRes.error}`);
      }
      worktreePath = undefined;
      worktreeBranch = undefined;
    }
  }

  const contract: SubQuestContract = {
    qid: childQid,
    parentQid: parent.qid,
    title: goal.trim(),
    assignedRequirements: contractParams?.assignedRequirements ?? [],
    allowedPaths: contractParams?.allowedPaths ?? [],
    requiredTestCommands: contractParams?.requiredTestCommands ?? (config.testCommands.length > 0 ? config.testCommands : []),
    acceptanceCriteria: contractParams?.acceptanceCriteria ?? [goal.trim()],
    maxTurns: contractParams?.maxTurns ?? 15,
    worktreePath,
    worktreeBranch,
  };

  if (switchNow) {
    if (parent.difficulty !== "complex") {
      updateState((s) => ({ ...s, difficulty: "complex", snapshotPending: true }));
    }
    const currentParent = getState();
    const child = pushStackFrame(currentParent, contract, childQid);
    pi.appendEntry(SNAPSHOT_TYPE, encodeSnapshot(child));
    await ensureChildDraftFile(ctx.cwd, childQid, parent.qid, contract, goal);
    replaceState(child);
    if (worktreePath) {
      syncHarnessCwd(worktreePath, pi);
    }

    const wtMsg = worktreePath ? ` in worktree ${worktreePath} (branch ${worktreeBranch})` : "";
    sendSteer(pi, `Switched to sub-quest ${childQid}: ${goal}${wtMsg} Parent ${parent.qid} waits and resumes on return.`);
    return { childQid, switched: true, worktreePath, worktreeBranch };
  }

  updateState((s) => {
    const withChild = addChild(s, { qid: childQid, brief, status: "running", findings: null, acknowledged: false });
    return { ...withChild, difficulty: "complex", snapshotPending: true };
  });
  emitNow(pi);
  const child = { ...createQuest(goal, childQid, parent.qid), depth, contract, worktreePath, worktreeBranch };
  pi.appendEntry(SNAPSHOT_TYPE, encodeSnapshot(child));
  await ensureChildDraftFile(ctx.cwd, childQid, parent.qid, contract, goal);

  if (worktreePath) {
    delegateSubQuestToSubagent({
      pi,
      qid: childQid,
      parentQid: parent.qid,
      goal,
      worktreePath,
      allowedPaths: contract.allowedPaths,
      requiredTestCommands: contract.requiredTestCommands,
    });
  }

  const wtMsg = worktreePath ? ` (worktree: ${worktreePath})` : "";
  sendSteer(pi, `Sub-quest ${childQid} created under ${parent.qid}${wtMsg}. Parent stays active.`);
  return { childQid, switched: false, worktreePath, worktreeBranch };
}

/**
 * Delegates sub-quest execution to a subagent with cwd bound to the isolated worktree.
 */
export function delegateSubQuestToSubagent(params: {
  pi: Pi;
  qid: Qid;
  parentQid: Qid;
  goal: string;
  worktreePath: string;
  allowedPaths?: string[];
  requiredTestCommands?: string[];
}): void {
  if (!params.pi.events || typeof params.pi.events.emit !== "function") return;
  const requestId = `subquest_${params.qid}_${Date.now().toString(36)}`;
  const prompt = [
    `# Sub-Quest ${params.qid}: ${params.goal}`,
    `You are executing sub-quest ${params.qid} under parent quest ${params.parentQid}.`,
    `Working directory: ${params.worktreePath}`,
    params.allowedPaths && params.allowedPaths.length > 0
      ? `Allowed paths: ${params.allowedPaths.join(", ")}`
      : "",
    params.requiredTestCommands && params.requiredTestCommands.length > 0
      ? `Verification commands: ${params.requiredTestCommands.join(", ")}`
      : "",
    `Implement requirements directly in this worktree and verify all tests before completing.`,
  ].filter(Boolean).join("\n\n");

  params.pi.events.emit("prompt-template:subagent:request", {
    requestId,
    ownerRunId: params.parentQid,
    nodeId: params.qid,
    agent: "worker",
    task: prompt,
    context: "fresh",
    cwd: params.worktreePath,
    result: { kind: "text" },
  });
}

export function subquestTool(pi: Pi): PiToolSpec {
  return {
    name: "quest_subquest",
    label: "Create Sub-Quest",
    description: "Spawn a linked sub-quest for a complex sub-task. The parent waits while the child runs and resumes on its return with findings. Depth is capped.",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Goal of the sub-quest." },
        brief: { type: "string", description: "Short brief recorded on the parent link." },
        switchNow: { type: "boolean", description: "Switch to the child now (default true)." },
        assignedRequirements: { type: "array", items: { type: "string" }, description: "Requirements assigned to this sub-quest." },
        allowedPaths: { type: "array", items: { type: "string" }, description: "File path patterns writable by this sub-quest." },
        requiredTestCommands: { type: "array", items: { type: "string" }, description: "Test commands required before completion." },
        acceptanceCriteria: { type: "array", items: { type: "string" }, description: "Observable conditions for completion." },
        maxTurns: { type: "number", description: "Maximum turns before warning." },
        worktree: { type: "boolean", description: "Whether to provision an isolated git worktree for this sub-quest (default: false)." },
        worktreePath: { type: "string", description: "Optional isolated worktree path for this sub-quest." },
        worktreeBranch: { type: "string", description: "Optional git branch for the isolated worktree." },
      },
      required: ["goal"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const goal = params["goal"];
      if (typeof goal !== "string" || goal.trim() === "") {
        return textResult("quest_subquest needs a goal.", { error: "missing_goal" });
      }
      const brief = typeof params["brief"] === "string" && params["brief"].trim() !== ""
        ? (params["brief"] as string).trim()
        : goal.trim();
      const switchNow = params["switchNow"] !== false;
      const contractParams: ChildQuestContractParams = {
        assignedRequirements: Array.isArray(params["assignedRequirements"]) ? params["assignedRequirements"] as string[] : undefined,
        allowedPaths: Array.isArray(params["allowedPaths"]) ? params["allowedPaths"] as string[] : undefined,
        requiredTestCommands: Array.isArray(params["requiredTestCommands"]) ? params["requiredTestCommands"] as string[] : undefined,
        acceptanceCriteria: Array.isArray(params["acceptanceCriteria"]) ? params["acceptanceCriteria"] as string[] : undefined,
        maxTurns: typeof params["maxTurns"] === "number" ? params["maxTurns"] as number : undefined,
        worktree: params["worktree"] === true,
        worktreePath: typeof params["worktreePath"] === "string" ? params["worktreePath"] as string : undefined,
        worktreeBranch: typeof params["worktreeBranch"] === "string" ? params["worktreeBranch"] as string : undefined,
      };
      try {
        const done = await createChildQuest(pi, ctx, goal.trim(), brief, switchNow, contractParams);
        return textResult(
          `Sub-quest ${done.childQid} created.${done.switched ? " Switched to it." : " Parent stays active."}`,
          { child: done.childQid, switched: done.switched },
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return textResult(`Sub-quest failed: ${detail}`, { error: detail });
      }
    },
  };
}
