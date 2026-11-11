// HIGH_LEVEL: #drafting — content-changing save supersedes review, boots fresh.
// SPEC: B1.3.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatch, getState } from "../app/store";
import { draftPath } from "../domain/paths";
import type { Pi, PiCtx, ToolResultEvent } from "../hooks/events";
import { hashContent, parseDraftSections, deliverableBody } from "./plan-text";
import { noteDraftUpdated } from "../durability/status";

export function handleDraftEdit(path: string, contentHash: string): boolean {
  try {
    const state = getState();
    if (state.qid === null || state.draft === null) return false;
    if (!path.endsWith(draftPath(state.qid))) return false;
    if (state.draft.contentHash === contentHash) return false;
    dispatch({ type: "DraftContentChanged", contentHash });
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
  if (state.phase !== "drafting" || state.qid === null) return;
  const expected = draftPath(state.qid);
  if (!rawPath.endsWith(expected)) return;
  const diskPath = rawPath.startsWith("/") ? rawPath : join(ctx.cwd, rawPath);
  let content: string;
  try {
    content = await readFile(diskPath, "utf8");
  } catch {
    return;
  }
  if (!handleDraftEdit(expected, hashContent(content))) return;
  noteDraftUpdated(ctx);
  void bootFn(pi, ctx);
}

export async function onTurnEndCatchAll(
  pi: Pi,
  ctx: PiCtx,
  bootFn: (pi: Pi, ctx: PiCtx) => Promise<void>,
): Promise<void> {
  try {
    const state = getState();
    if (state.phase !== "drafting" || state.qid === null || state.draft === null) return;
    const expected = draftPath(state.qid);
    let content: string;
    try {
      content = await readFile(join(ctx.cwd, expected), "utf8");
    } catch {
      return;
    }
    const hash = hashContent(content);
    if (hash === state.draft.contentHash) return;
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
    if (!handleDraftEdit(expected, hash)) return;
    noteDraftUpdated(ctx);
    void bootFn(pi, ctx);
  } catch { /* ignore */ }
}
