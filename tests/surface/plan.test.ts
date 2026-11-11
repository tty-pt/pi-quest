import { check } from "../check.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { draftPath } from "../../src/domain/paths.ts";
import { installCommands } from "../../src/surface/commands/index.ts";
import { editActivePlan, viewActivePlan } from "../../src/surface/commands/plan.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

const QID = "abc123" as Qid;
const DRAFT = "## Requirements\n- first\n\n## Evidence\n- found it\n\n## Implementation Plan\nDo step one.\nThen step two.\n";

function draftingCwd(): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-plan-"));
  mkdirSync(join(cwd, ".pi", "quest", "future"), { recursive: true });
  writeFileSync(join(cwd, draftPath(QID)), DRAFT);
  replaceState(createDraft(createQuest("work", QID), "work"));
  return cwd;
}

Deno.test("plan viewer reports when no quest is active", async () => {
  replaceState(IDLE_STATE);
  const notes: string[] = [];
  await viewActivePlan(fakeCtx("/tmp", [], { notify: (m: string) => notes.push(m) }));
  check(notes.length === 1 && notes[0].includes("No active quest"), "oriented");
});

Deno.test("plan viewer reports a missing draft file", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-plan-"));
  replaceState(createDraft(createQuest("work", QID), "work"));
  const notes: string[] = [];
  await viewActivePlan(fakeCtx(cwd, [], { notify: (m: string) => notes.push(m) }));
  check(notes.length === 1 && notes[0].includes(QID), "qid named");
  replaceState(IDLE_STATE);
});

Deno.test("viewActivePlan shows a capped toast excerpt", async () => {
  const cwd = draftingCwd();
  const notes: string[] = [];
  const pi = fakePi();
  await viewActivePlan(fakeCtx(cwd, [], { notify: (m: string) => notes.push(m) }));
  check(notes.length === 1, "one toast");
  check(notes[0].includes("Do step one."), "plan excerpt shown");
  check(notes[0].includes(draftPath(QID)), "file pointed at");
  check(pi.sent.length === 0, "zero inference: no model message");
  replaceState(IDLE_STATE);
});

Deno.test("/quest edit opens the active plan in $EDITOR", async () => {
  const cwd = draftingCwd();
  const pi = fakePi();
  installCommands(pi);
  const questCmd = pi.commands.find((c) => c.name === "quest");
  check(questCmd !== undefined, "quest command registered");

  const prevEditor = Deno.env.get("EDITOR");
  Deno.env.set("EDITOR", "true");
  try {
    const notes: string[] = [];
    const ctx = fakeCtx(cwd, [], { notify: (m: string) => notes.push(m) });
    await questCmd!.options.handler("edit", ctx);
    check(notes.some((n) => n.includes(draftPath(QID))), "notifies after editing plan file");
    check(pi.execCalls.some((c) => c.command === "true"), "invokes $EDITOR via pi.exec");
  } finally {
    if (prevEditor === undefined) Deno.env.delete("EDITOR");
    else Deno.env.set("EDITOR", prevEditor);
    replaceState(IDLE_STATE);
  }
});
