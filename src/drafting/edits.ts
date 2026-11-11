// HIGH_LEVEL: #drafting — content-changing save supersedes review, boots fresh.
// SPEC: B1.3.
import { readFile } from "node:fs/promises";
import { dispatch, getState, replaceState } from "../app/store";
import { createDraft } from "../domain/transitions";
import { draftPath } from "../domain/paths";
import { draftFilePath } from "../files";
import type { Pi, PiCtx, ToolResultEvent } from "../hooks/events";
import { isCurrentReview } from "../review/tracker";
import { hashContent, parseDraftSections, deliverableBody, hasAuthoredText } from "./plan-text";
import { noteDraftUpdated } from "../durability/status";

function ensureDraftCreatedOnEdit(content: string): boolean {
  const state = getState();
  if (state.phase !== "provisional" || state.qid === null) return false;
  const sections = parseDraftSections(content);
  const hasPlan = hasAuthoredText(deliverableBody(sections, state.kind));
  const hasReqsOrEv = sections.requirements.length > 0 || sections.evidence.length > 0;
  if (!hasPlan && !hasReqsOrEv) return false;
  const name = state.name || state.qid;
  replaceState(createDraft(state, name, state.kind));
  return true;
}

export function handleDraftEdit(path: string, contentHash: string, planAuthored?: boolean): boolean {
  try {
    const state = getState();
    if (state.qid === null || state.draft === null) return false;
    if (!path.endsWith(draftPath(state.qid))) return false;
    if (state.draft.contentHash === contentHash && isCurrentReview(state.qid, contentHash)) return false;
    if (state.draft.contentHash === contentHash) return false;
    dispatch({ type: "DraftContentChanged", contentHash, ...(planAuthored !== undefined ? { planAuthored } : {}) });
    return true;
  } catch {
    return false;
  }
}

export async function onWriteResult(
  pi: Pi,
  ctx: PiCtx,
  event: ToolResultEvent,
  bootFn: (pi: Pi, ctx: PiCtx) => Promise<void>,
): Promise<void> {
  if (event.isError) return;
  if (event.toolName !== "edit" && event.toolName !== "write") return;
  const rawPath = event.input["path"];
  if (typeof rawPath !== "string") return;
  const state = getState();
  if ((state.phase !== "drafting" && state.phase !== "provisional") || state.qid === null) return;
  const expected = draftPath(state.qid);
  if (!rawPath.endsWith(expected)) return;
  const diskPath = rawPath.startsWith("/") ? rawPath : draftFilePath(ctx.cwd, state.qid);
  let content: string;
  try {
    content = await readFile(diskPath, "utf8");
  } catch {
    return;
  }
  if (state.phase === "provisional" && !ensureDraftCreatedOnEdit(content)) {
    return;
  }
  const hash = hashContent(content);
  if (isCurrentReview(state.qid, hash)) return;
  const sections = parseDraftSections(content);
  const authored = hasAuthoredText(deliverableBody(sections, getState().kind));
  if (!handleDraftEdit(expected, hash, authored ? true : undefined)) return;
  noteDraftUpdated(ctx);
  void bootFn(pi, ctx);
}

export async function onTurnEndCatchAll(
  pi: Pi,
  ctx: PiCtx,
  bootFn: (pi: Pi, ctx: PiCtx) => Promise<void>,
): Promise<void> {
  try {
    let state = getState();
    if ((state.phase !== "drafting" && state.phase !== "provisional") || state.qid === null) return;
    const expected = draftPath(state.qid);
    let content: string;
    try {
      content = await readFile(draftFilePath(ctx.cwd, state.qid), "utf8");
    } catch {
      return;
    }
    if (state.phase === "provisional") {
      if (!ensureDraftCreatedOnEdit(content)) return;
      state = getState();
    }
    if (state.qid === null || state.draft === null) return;
    const hash = hashContent(content);
    if (isCurrentReview(state.qid, hash)) return;
    if (hash === state.draft.contentHash) {
      if (state.draft.planAuthored && state.draft.approvedBy === null && state.lastReview?.target !== hash) {
        noteDraftUpdated(ctx);
        void bootFn(pi, ctx);
      }
      return;
    }
    if (state.draft.contentHash === null) {
      const sections = parseDraftSections(content);
      const deliverable = deliverableBody(sections, state.kind).trim();
      if (deliverable.length === 0) {
        dispatch({ type: "DraftContentChanged", contentHash: hash });
        return;
      }
      dispatch({ type: "DraftContentChanged", contentHash: hash, planAuthored: true });
      noteDraftUpdated(ctx);
      void bootFn(pi, ctx);
      return;
    }
    const sections = parseDraftSections(content);
    const authored = hasAuthoredText(deliverableBody(sections, state.kind));
    if (!handleDraftEdit(expected, hash, authored ? true : undefined)) return;
    noteDraftUpdated(ctx);
    void bootFn(pi, ctx);
  } catch { /* ignore */ }
}
