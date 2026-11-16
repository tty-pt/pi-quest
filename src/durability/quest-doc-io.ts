// HIGH_LEVEL: #validation — the quest doc's ## Status section tracks the
// phase; claim and demote paths keep it honest. The validator boots from
// the claim tool call, never from the file.
// Shared file I/O for the quest document (domain namespaces the pure string
// parsing); best-effort by design — a failed status write never breaks the
// agent or blocks a transition already taken in state.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { updateState } from "../app/store";
import { hashContent } from "../drafting/plan-text";
import { draftPath } from "../domain/paths";
import { draftFilePath } from "../files";
import { dedupeDocBullets } from "../domain/dedupe";
import { reconcileDocContent, upsertDocStatus } from "../domain/quest-doc";
import type { HandbackReceipt } from "../domain/contract";
import type { Qid } from "../domain/qid";
import type { PiCtx } from "../hooks/events";

export async function readQuestDoc(ctx: PiCtx, qid: Qid): Promise<string | null> {
  try {
    return await readFile(draftFilePath(ctx.cwd, qid), "utf8");
  } catch {
    return null;
  }
}

export async function readDraftHeading(cwd: string, qid: string): Promise<string | null> {
  try {
    const text = await readFile(draftFilePath(cwd, qid as Qid), "utf8");
    const h1 = text.match(/^#\s+(?:Quest\s+\S+:\s*)?(.+?)\s*$/m)?.[1]?.trim();
    if (h1 && h1 !== qid) return h1;
    return null;
  } catch {
    return null;
  }
}

export async function readDraftObjective(cwd: string, qid: string): Promise<string | null> {
  try {
    const text = await readFile(draftFilePath(cwd, qid as Qid), "utf8");
    return text.match(/^##\s+Original request\s*\n+(.+?)(?:\n##\s|\n*$)/ims)?.[1]?.trim() ||
      text.split("\n")[0] ||
      qid;
  } catch {
    return null;
  }
}

// Write (or refresh) the quest doc's ## Status section and rebaseline the
// content binding to the new disk hash, so the implementation fingerprint
// and the file stay in sync. Never throws; missing docs are left alone.
export async function setDocStatus(
  ctx: PiCtx,
  qid: Qid,
  phase: string,
  complete: boolean,
): Promise<void> {
  const content = await readQuestDoc(ctx, qid);
  if (content === null) return;
  const updated = dedupeDocBullets(upsertDocStatus(content, phase, complete)).text;
  if (updated === content) return;
  try {
    await writeFile(draftFilePath(ctx.cwd, qid), updated, "utf8");
  } catch {
    return;
  }
  const hash = hashContent(updated);
  updateState((s) =>
    s.draft === null
      ? s
      : { ...s, draft: { ...s.draft, contentHash: hash }, snapshotPending: true }
  );
}

// Reconcile parent document on sub-quest return: check off completed RTM requirements
// and append sub-quest receipt findings. Best-effort: file errors never break execution.
export async function reconcileParentDocOnReturn(
  cwd: string,
  parentQid: Qid,
  receipt: HandbackReceipt,
): Promise<void> {
  const filePath = draftFilePath(cwd, parentQid);
  try {
    const content = await readFile(filePath, "utf8");
    const updated = dedupeDocBullets(reconcileDocContent(content, receipt)).text;
    if (updated !== content) {
      await writeFile(filePath, updated, "utf8");
      const hash = hashContent(updated);
      updateState((s) =>
        s.qid === parentQid && s.draft !== null
          ? { ...s, draft: { ...s.draft, contentHash: hash }, snapshotPending: true }
          : s
      );
    }
  } catch {
    // Best-effort: missing or unwritable doc never throws
  }
}
