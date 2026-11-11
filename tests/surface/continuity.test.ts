import { check, assertEquals } from "../check.ts";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { encodeSnapshot, SNAPSHOT_TYPE } from "../../src/durability/snapshots.ts";
import { handoffTool } from "../../src/surface/tools/handoff.ts";
import { dedupeAll, runHandoffCommand } from "../../src/surface/commands/continuity.ts";
import { killQuest, parseQuestDelArgs } from "../../src/surface/commands/quest-del.ts";
import { listQuests } from "../../src/surface/commands/quests.ts";
import { installCommands } from "../../src/surface/commands/index.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

function workspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-cont-"));
  mkdirSync(join(cwd, ".pi", "quest", "future"), { recursive: true });
  return cwd;
}

function doc(cwd: string, qid: string, text: string, ageDays = 0): string {
  const p = join(cwd, ".pi", "quest", "future", `${qid}.md`);
  writeFileSync(p, text);
  const t = new Date(Date.now() - ageDays * 86_400_000);
  utimesSync(p, t, t);
  return p;
}

const ASK = "give me a handoff prompt";

Deno.test("quest_handoff writes .pi/quest/handoffs/<qid>-<stamp>.md and returns it", async () => {
  const cwd = workspace();
  doc(cwd, "1xHHHH", "# 1xHHHH\n\n## Original request\n\nMake water continuous.\n\n## Requirements\n- R1: continuous water\n");
  replaceState({ ...createQuest("Make water continuous.", "1xHHHH"), phase: "implementing" });
  const pi = fakePi();
  const res = await handoffTool(pi).execute("t", { notes: "Root cause: tile flags." }, undefined, undefined, fakeCtx(cwd));
  const text = (res.content[0] as { text: string }).text;
  const files = readdirSync(join(cwd, ".pi", "quest", "handoffs"));
  assertEquals(files.length, 1);
  check(/^1xHHHH-\d{8}-\d{6}\.md$/.test(files[0]), files[0]);
  const body = readFileSync(join(cwd, ".pi", "quest", "handoffs", files[0]), "utf8");
  check(body.includes("Make water continuous.") && body.includes("Root cause: tile flags.") && body.includes("**UNVERIFIED**"), "content");
  check(text.includes(body), "tool returns the full document");
  replaceState(IDLE_STATE);
});

Deno.test("/quest handoff works for a non-active quest via snapshot or doc-only", async () => {
  replaceState(IDLE_STATE);
  const cwd = workspace();
  doc(cwd, "1xDDDD", "# 1xDDDD\n\n## Original request\n\nDoc only quest.\n\n## Status\n- Phase: validating\n");
  const docOnly = await runHandoffCommand(fakePi(), fakeCtx(cwd), "1xDDDD");
  check(docOnly.includes("Doc only quest.") && docOnly.includes("phase: validating"), docOnly.slice(0, 300));
  const snap = encodeSnapshot({ ...createQuest("from snapshot", "1xSSSS"), refinements: [ASK, "use tabs"] });
  const fromSnap = await runHandoffCommand(fakePi(), fakeCtx(cwd, [{ customType: SNAPSHOT_TYPE, data: snap }]), "1xSSSS");
  check(fromSnap.includes("from snapshot") && fromSnap.includes("use tabs"), "snapshot used");
  check((await runHandoffCommand(fakePi(), fakeCtx(cwd), "")).includes("none active"), "idle reported");
});

Deno.test("quest del args parse prune filters, days, dry-run, and qids", () => {
  const a = parseQuestDelArgs("--stale --days 3 --dry-run 1xAAAA");
  assertEquals([a.staleDays, a.stale, a.dryRun, a.targets], [3, true, true, ["1xAAAA"]]);
});

Deno.test("/quest list and /quest del triage, auto-dedupe, and prune without touching the active quest or creating zip files", async () => {
  const cwd = workspace();
  const dupe = `# 1xPPPP\n\n## Amendments\n- ${ASK} (User mid-quest directive)\n- ${ASK} (User mid-quest directive)\n\n## Requirements\n- R7: [User Directive] ${ASK}\n- R8: [User Directive] ${ASK}\n`;
  const pPath = doc(cwd, "1xPPPP", dupe, 20);
  const aPath = doc(cwd, "1xAAAA", "# 1xAAAA\n\n## Requirements\n- R1: x\n", 40);
  const ePath = doc(cwd, "1xEEEE", "# 1xEEEE\n\n## Original request\n\nshell\n", 10);
  replaceState({ ...createQuest("active", "1xAAAA"), phase: "implementing" });
  const pi = fakePi();
  installCommands(pi);
  const questCmd = pi.commands.find((c) => c.name === "quest");
  check(questCmd !== undefined, "quest command registered");

  const list = (await listQuests(fakeCtx(cwd))).join("\n");
  check(list.includes("1 active") && list.includes("1 stale") && list.includes("1 empty-shell"), list);

  const repaired = readFileSync(pPath, "utf8");
  check(!repaired.includes("R8:") && repaired.split("(User mid-quest directive)").length === 2, "listQuests auto-deduped bullets");
  assertEquals((await dedupeAll(cwd)).join("\n"), "No duplicate bullets found.");

  const dry = await killQuest(pi, fakeCtx(cwd), "--stale --empty --dry-run");
  check(dry.includes("Would delete 2 quest(s):") && existsSync(pPath) && existsSync(ePath), dry);

  const pruned = await killQuest(pi, fakeCtx(cwd), "--stale --empty 1xAAAA");
  check(pruned.includes("Deleted 2/2"), pruned);
  check(!existsSync(pPath) && !existsSync(ePath), "stale + empty deleted (doc removed)");
  check(existsSync(aPath), "active quest never pruned");

  const fPath = doc(cwd, "1xFFFF", "# 1xFFFF\n\n## Requirements\n- R1: fresh\n", 0);
  const notes: string[] = [];
  const ctxUi = { ...fakeCtx(cwd), ui: { ...fakeCtx(cwd).ui, notify: (m: string) => notes.push(m) } };
  await questCmd!.options.handler("del --all", ctxUi);
  check(notes.at(-1)?.includes("Deleted 1/1") === true, `del --all output: ${notes.at(-1)}`);
  check(!existsSync(fPath) && existsSync(aPath), "del --all deletes fresh draft while preserving active quest");

  check(pi.execCalls.filter((c) => c.command === "zip").length === 0, "no zip files created");
  replaceState(IDLE_STATE);
});
