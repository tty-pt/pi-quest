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
import { ensureDraftFile, listKnownQids } from "../../files";
import { textResult } from "./reply";

export interface ChildQuestContractParams {
  assignedRequirements?: string[];
  allowedPaths?: string[];
  requiredTestCommands?: string[];
  acceptanceCriteria?: string[];
  maxTurns?: number;
}

export async function createChildQuest(
  pi: Pi,
  ctx: PiCtx,
  goal: string,
  brief: string,
  switchNow: boolean,
  contractParams?: ChildQuestContractParams,
): Promise<{ childQid: Qid; switched: boolean }> {
  const parent = getState();
  if (parent.qid === null) throw new Error("no active quest to parent the sub-quest");
  const config = await readQuestConfig(ctx.cwd);
  const depth = parent.depth + 1;
  if (depth > config.depthCap) {
    throw new Error(`depth cap ${config.depthCap} reached — fold this work into the parent quest`);
  }
  const childQid = nextQid(Date.now() / 1000, await listKnownQids(ctx.cwd));
  const contract: SubQuestContract = {
    qid: childQid,
    parentQid: parent.qid,
    title: goal.trim(),
    assignedRequirements: contractParams?.assignedRequirements ?? [],
    allowedPaths: contractParams?.allowedPaths ?? [],
    requiredTestCommands: contractParams?.requiredTestCommands ?? ["make test"],
    acceptanceCriteria: contractParams?.acceptanceCriteria ?? [goal.trim()],
    maxTurns: contractParams?.maxTurns ?? 15,
  };

  if (switchNow) {
    const child = pushStackFrame(parent, contract, childQid);
    pi.appendEntry(SNAPSHOT_TYPE, encodeSnapshot(child));
    await ensureDraftFile(ctx, childQid, childQid, goal);
    replaceState(child);
    sendSteer(pi, `Switched to sub-quest ${childQid}: ${goal} Parent ${parent.qid} waits and resumes on return.`);
    return { childQid, switched: true };
  }

  updateState((s) => addChild(s, { qid: childQid, brief, status: "running", findings: null, acknowledged: false }));
  emitNow(pi);
  const child = { ...createQuest(goal, childQid, parent.qid), depth, contract };
  pi.appendEntry(SNAPSHOT_TYPE, encodeSnapshot(child));
  await ensureDraftFile(ctx, childQid, childQid, goal);
  sendSteer(pi, `Sub-quest ${childQid} created under ${parent.qid}. Parent stays active.`);
  return { childQid, switched: false };
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
