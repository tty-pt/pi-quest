import { check } from "../check.ts";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuest } from "../../src/domain/quest.ts";
import { draftPath, stageDir } from "../../src/domain/paths.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { fakePi } from "../fake-pi.ts";
import { archiveQuestFiles, renderManifest, renderQuestView } from "../../src/views/quest-view.ts";

Deno.test("quest view renders state with a read-only header", () => {
  const view = renderQuestView({ ...createQuest("do it", "abc123"), exactNextAction: "go" });
  check(view.includes("abc123"), "qid rendered");
  check(view.includes("do it"), "objective rendered");
  check(view.includes("transcript is the truth"), "read-only header present");
  const manifest = JSON.parse(renderManifest(createQuest("do it", "abc123"), "COMPLETED", "done well"));
  check(manifest.outcome === "COMPLETED", "outcome recorded");
  check(manifest.summary === "done well", "summary recorded");
  check(typeof manifest.archivedAt === "string", "timestamp recorded");
});

Deno.test("archiveQuestFiles removes the future doc and staging dir without spawning zip", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-views-"));
  const pi = fakePi();
  const state = createQuest("do it", "abc123");
  await mkdir(join(cwd, ".pi/quest/future"), { recursive: true });
  await mkdir(join(cwd, stageDir("abc123" as Qid)), { recursive: true });
  await writeFile(join(cwd, draftPath("abc123" as Qid)), "draft stays until archive", "utf8");
  const res = await archiveQuestFiles(pi, cwd, state, "COMPLETED", "done");
  check(res === "", "empty zip path returned");
  check(pi.execCalls.length === 0, "zip never invoked");
  check(!existsSync(join(cwd, draftPath("abc123" as Qid))), "future doc removed");
  check(!existsSync(join(cwd, stageDir("abc123" as Qid))), "staging dir removed");
});
