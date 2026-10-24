// HIGH_LEVEL: #sub-quests — autonomous foreman backlog sequencing.
import type { Qid } from "../domain/qid";
import type { HandbackReceipt, SubQuestContract } from "../domain/contract";
import type { QuestState } from "../domain/quest";
import { pushStackFrame } from "../domain/stack";

export interface BacklogItem {
  id: string;
  goal: string;
  allowedPaths: string[];
  requiredTestCommands: string[];
  assignedRequirements: string[];
  isCompleted?: boolean;
}

function parseBracketList(text: string, tag: string): string[] {
  const pattern = new RegExp(`\\[(?:${tag}):\\s*([^\\]]+)\\]`, "i");
  const match = text.match(pattern);
  if (!match) return [];
  return match[1].split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

export function parseSubQuestBacklog(planText: string): BacklogItem[] {
  const items: BacklogItem[] = [];
  const lines = planText.split("\n");

  for (const line of lines) {
    const match = line.match(/^\s*-\s*\[([ xX!])\]\s*(?:\*\*)?([A-Za-z0-9_-]+)(?:\*\*)?:\s*([^\[]+)(.*)$/);
    if (!match) continue;

    const mark = match[1].toLowerCase();
    const id = match[2].trim();
    if (!/^sq/i.test(id) && !/^sub/i.test(id)) continue;

    const goal = match[3].trim();
    const tags = match[4];

    const allowedPaths = parseBracketList(tags, "paths?|path");
    const requiredTestCommands = parseBracketList(tags, "tests?|test");
    const assignedRequirements = parseBracketList(tags, "reqs?|req");

    items.push({
      id,
      goal,
      allowedPaths,
      requiredTestCommands,
      assignedRequirements,
      isCompleted: mark === "x",
    });
  }

  return items;
}

export function nextPendingSubQuest(
  items: BacklogItem[],
  receipts: HandbackReceipt[],
): BacklogItem | null {
  const completedReqs = new Set<string>();
  const completedIds = new Set<string>();

  for (const r of receipts) {
    if (r.status === "COMPLETED") {
      for (const req of r.assignedRequirements) {
        completedReqs.add(req.toLowerCase());
      }
      if (r.findings) {
        const idMatch = r.findings.match(/\b(SQ\d+)\b/i);
        if (idMatch) completedIds.add(idMatch[1].toUpperCase());
      }
    }
  }

  for (const item of items) {
    if (item.isCompleted) continue;
    if (completedIds.has(item.id.toUpperCase())) continue;
    const reqsSatisfied = item.assignedRequirements.length > 0 &&
      item.assignedRequirements.every((req) => completedReqs.has(req.toLowerCase()));
    if (reqsSatisfied) continue;

    return item;
  }

  return null;
}

export function createContractForBacklogItem(
  item: BacklogItem,
  parentQid: Qid,
  childQid: Qid,
): SubQuestContract {
  return {
    qid: childQid,
    parentQid,
    title: item.goal,
    assignedRequirements: item.assignedRequirements,
    allowedPaths: item.allowedPaths,
    requiredTestCommands: item.requiredTestCommands,
    acceptanceCriteria: [`Complete ${item.id}: ${item.goal}`],
  };
}

export function advanceForeman(
  parentState: QuestState,
  nextChildQid: Qid,
): { nextMountedState: QuestState; nextItem: BacklogItem } | null {
  const plan = parentState.draft?.lastReviewedPlan ?? parentState.objective;
  if (!plan) return null;

  const items = parseSubQuestBacklog(plan);
  if (items.length === 0) return null;

  const nextItem = nextPendingSubQuest(items, parentState.handbackReceipts ?? []);
  if (!nextItem) return null;

  const contract = createContractForBacklogItem(nextItem, parentState.qid as Qid, nextChildQid);
  const nextMountedState = pushStackFrame(parentState, contract, nextChildQid);

  return { nextMountedState, nextItem };
}
