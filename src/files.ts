// HIGH_LEVEL: #storage — qid in all paths; known ids seed monotonic assignment.
// HIGH_LEVEL: #storage — the drafting workspace starts from a template.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PiCtx } from "./hooks/events.ts";
import { findPrimaryRepoRoot } from "./utils/git.ts";
import { ARCHIVE_DIR, archivePath, draftPath, FUTURE_DIR, stageDir } from "./domain/paths.ts";
import { isQid, type Qid } from "./domain/qid.ts";
import type { QuestDifficulty } from "./config.ts";
import {
  renderChildDraftTemplate,
  renderDraftTemplate,
} from "./views/draft-template.ts";
import type { SubQuestContract } from "./domain/contract.ts";

export function canonicalWorkspaceRoot(cwd: string): string {
  return findPrimaryRepoRoot(cwd);
}

export function draftFilePath(cwd: string, qid: Qid): string {
  return join(canonicalWorkspaceRoot(cwd), draftPath(qid));
}

export function stageDirPath(cwd: string, qid: Qid): string {
  return join(canonicalWorkspaceRoot(cwd), stageDir(qid));
}

export function archiveFilePath(cwd: string, qid: Qid): string {
  return join(canonicalWorkspaceRoot(cwd), archivePath(qid));
}

async function listQidsInDir(cwd: string, dir: string, ext: string): Promise<string[]> {
  const root = canonicalWorkspaceRoot(cwd);
  try {
    const files = await readdir(join(root, dir));
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

export async function listArchivedQids(_cwd: string): Promise<string[]> {
  return [];
}

export async function listKnownQids(cwd: string): Promise<string[]> {
  return await listDraftQids(cwd);
}

async function writeDraftFileIfNotExists(
  cwd: string,
  qid: Qid,
  content: string,
): Promise<void> {
  const root = canonicalWorkspaceRoot(cwd);
  await mkdir(join(root, FUTURE_DIR), { recursive: true });
  try {
    await writeFile(draftFilePath(cwd, qid), content, { flag: "wx" });
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
