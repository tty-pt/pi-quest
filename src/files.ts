// HIGH_LEVEL: #storage — qid in all paths; known ids seed monotonic assignment.
// HIGH_LEVEL: #storage — the drafting workspace starts from a template.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PiCtx } from "./hooks/events.ts";
import { ARCHIVE_DIR, draftPath, FUTURE_DIR } from "./domain/paths.ts";
import { isQid, type Qid } from "./domain/qid.ts";
import type { QuestDifficulty } from "./config.ts";
import {
  renderChildDraftTemplate,
  renderDraftTemplate,
} from "./views/draft-template.ts";
import type { SubQuestContract } from "./domain/contract.ts";

async function listQidsInDir(cwd: string, dir: string, ext: string): Promise<string[]> {
  try {
    const files = await readdir(join(cwd, dir));
    return files
      .filter((f) => f.endsWith(ext))
      .map((f) => f.slice(0, -ext.length))
      .filter((id) => id.length > 0);
  } catch {
    return [];
  }
}

export async function listDraftQids(cwd: string): Promise<string[]> {
  return await listQidsInDir(cwd, FUTURE_DIR, ".md");
}

export async function listArchivedQids(cwd: string): Promise<string[]> {
  return await listQidsInDir(cwd, ARCHIVE_DIR, ".zip");
}

export async function listKnownQids(cwd: string): Promise<string[]> {
  const [drafts, archives] = await Promise.all([
    listDraftQids(cwd),
    listArchivedQids(cwd),
  ]);
  return [...new Set([...drafts, ...archives])];
}

async function writeDraftFileIfNotExists(
  cwd: string,
  qid: Qid,
  content: string,
): Promise<void> {
  await mkdir(join(cwd, FUTURE_DIR), { recursive: true });
  try {
    await writeFile(join(cwd, draftPath(qid)), content, { flag: "wx" });
  } catch (err) {
    if ((err as { code?: string }).code !== "EEXIST") throw err;
  }
}

// Write the draft scaffold for a quest unless one already exists —
// never clobbers agent-authored content. Called at every provisioning
// site so future/<qid>.md exists from the moment the quest starts.
export async function ensureDraftFile(
  ctx: PiCtx,
  rawQid: string,
  name: string,
  objective: string,
  context?: string,
  difficulty?: QuestDifficulty,
  invariantsBlock?: string,
): Promise<void> {
  if (!isQid(rawQid)) throw new Error(`invalid qid: ${rawQid}`);
  const qid: Qid = rawQid;
  await writeDraftFileIfNotExists(
    ctx.cwd,
    qid,
    renderDraftTemplate(name, objective, context, difficulty, invariantsBlock),
  );
}

export async function ensureChildDraftFile(
  cwd: string,
  childQid: Qid,
  parentQid: Qid,
  contract: SubQuestContract,
  goal: string,
): Promise<void> {
  await writeDraftFileIfNotExists(
    cwd,
    childQid,
    renderChildDraftTemplate(childQid, parentQid, contract, goal),
  );
}
