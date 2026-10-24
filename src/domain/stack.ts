// HIGH_LEVEL: #sub-quests — stack management for hierarchical sub-quest execution.
import type { Qid } from "./qid";
import { createQuest, markChanged, type Phase, type QuestState, type Setback, type StackFrame } from "./quest";
import { addChild, settleChild } from "./children";
import type { HandbackReceipt, SubQuestContract } from "./contract";
import { updateRtmFromReceipt } from "./contract";

export type { StackFrame };

export function pushStackFrame(
  parentState: QuestState,
  contract: SubQuestContract,
  childQid: Qid,
): QuestState {
  if (parentState.qid === null) throw new Error("cannot push stack frame without parent qid");
  const linkedParent = parentState.children.some((c) => c.qid === childQid)
    ? parentState
    : addChild(parentState, {
      qid: childQid,
      brief: contract.title,
      status: "running",
      findings: null,
      acknowledged: false,
    });

  const parentFrame: StackFrame = {
    qid: linkedParent.qid!,
    role: linkedParent.depth === 0 ? "coordinator" : "worker",
    contract: linkedParent.contract,
    savedPhase: linkedParent.phase,
    savedState: { ...linkedParent },
  };

  const existingStack = linkedParent.questStack ?? [];
  const baseChild = createQuest(contract.title, childQid, linkedParent.qid);
  return markChanged(baseChild, {
    phase: "implementing",
    depth: linkedParent.depth + 1,
    contract,
    questStack: [...existingStack, parentFrame],
    exactNextAction: "Implement contract requirements against declared allowedPaths.",
  });
}

export function popStackFrame(
  childState: QuestState,
  receipt: HandbackReceipt,
): QuestState {
  const stack = childState.questStack ?? [];
  if (stack.length === 0) {
    throw new Error(`cannot pop stack frame: questStack is empty for child ${childState.qid}`);
  }
  const topFrame = stack[stack.length - 1];
  const remainingStack = stack.slice(0, -1);
  const parentBase = topFrame.savedState;

  // Settle child status in parent
  const childStatus = receipt.status === "COMPLETED" ? "returned" : "failed";
  const parentWithChildSettled = settleChild(
    parentBase,
    childState.qid as Qid,
    childStatus,
    receipt.findings,
  );

  // Update RTM if present
  const updatedRtm = updateRtmFromReceipt(parentWithChildSettled.rtm, receipt);
  const existingReceipts = parentWithChildSettled.handbackReceipts ?? [];

  let setbacks = parentWithChildSettled.setbacks ?? [];
  let exactNextAction = parentWithChildSettled.exactNextAction;

  if (receipt.status === "FAILED") {
    const failureSetback: Setback = {
      reason: `Sub-quest ${childState.qid} failed: ${receipt.findings}`,
      evidence: [
        `Command: ${receipt.testCommand} (passed: false)`,
        `Diff summary: ${receipt.diffSummary}`,
        `Assigned requirements: ${receipt.assignedRequirements.join(", ")}`,
      ],
    };
    setbacks = [...setbacks, failureSetback];
    exactNextAction = `Address failure in sub-quest ${childState.qid} (${receipt.findings}). Amend contract or plan before re-attempting.`;
  }

  return markChanged(parentWithChildSettled, {
    phase: topFrame.savedPhase,
    questStack: remainingStack,
    rtm: updatedRtm,
    handbackReceipts: [...existingReceipts, receipt],
    setbacks,
    exactNextAction,
  });
}
