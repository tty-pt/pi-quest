// HIGH_LEVEL: #commands — /quest edit and /quest plan open the active quest plan in $EDITOR.
// HIGH_LEVEL: #surface — on-demand inspection, zero inference.
// SPEC: B1.3 (draft stays inspectable), B1.8 (amendments stay inspectable).
import { readFile } from "node:fs/promises";
import { getState } from "../../app/store";
import type { Qid } from "../../domain/qid";
import { draftPath } from "../../domain/paths";
import { draftFilePath } from "../../files";
import type { Pi, PiCtx } from "../../hooks/events";
import { readQuestConfig } from "../../config";

const TOAST_BODY_MAX = 800;

function notify(ctx: PiCtx, text: string): void {
  try {
    ctx.ui.notify(text, "info");
  } catch {
    // Notification is best-effort.
  }
}

export async function resolveActivePlanFile(
  ctx: PiCtx,
): Promise<{ qid: string; relPath: string; fullPath: string; content: string } | { error: string }> {
  const state = getState();
  if (state.qid === null) {
    return { error: "No active quest." };
  }
  const qid = state.qid;
  const relPath = draftPath(qid);
  const fullPath = draftFilePath(ctx.cwd, qid as Qid);
  try {
    const content = await readFile(fullPath, "utf8");
    return { qid, relPath, fullPath, content };
  } catch {
    if (state.parentQid) {
      const parentRel = draftPath(state.parentQid);
      const parentFull = draftFilePath(ctx.cwd, state.parentQid as Qid);
      try {
        const content = await readFile(parentFull, "utf8");
        return { qid: state.parentQid, relPath: parentRel, fullPath: parentFull, content };
      } catch {
        return { error: `Quest ${qid} has no draft file yet (${relPath}).` };
      }
    }
    return { error: `Quest ${qid} has no draft file yet (${relPath}).` };
  }
}

export async function viewActivePlan(ctx: PiCtx): Promise<void> {
  const resolved = await resolveActivePlanFile(ctx);
  if ("error" in resolved) {
    notify(ctx, resolved.error);
    return;
  }
  const title = `Quest ${resolved.qid} — plan (${resolved.relPath})`;
  const excerpt = resolved.content.slice(0, TOAST_BODY_MAX);
  notify(ctx, `${title}\n${excerpt}`);
}

export async function editActivePlan(pi: Pi, ctx: PiCtx): Promise<void> {
  const resolved = await resolveActivePlanFile(ctx);
  if ("error" in resolved) {
    notify(ctx, resolved.error);
    return;
  }
  const config = await readQuestConfig(ctx.cwd);
  const envEditor = typeof Deno !== "undefined" ? Deno.env.get("EDITOR") : process.env.EDITOR;
  const editor = (config.planEditor && config.planEditor.trim() !== "")
    ? config.planEditor.trim()
    : (envEditor && envEditor.trim() !== "" ? envEditor.trim() : "vi");
  const res = await pi.exec(editor, [resolved.fullPath], { cwd: ctx.cwd });
  if (res.code !== 0) {
    notify(ctx, `Editor exited with code ${res.code} (${resolved.relPath}).`);
  } else {
    notify(ctx, `Edited ${resolved.relPath}`);
  }
}
