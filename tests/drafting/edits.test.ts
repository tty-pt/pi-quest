import { check } from "../check.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getState, replaceState, updateState } from "../../src/app/store.ts";
import { handleDraftEdit, onTurnEndCatchAll, onWriteResult } from "../../src/drafting/edits.ts";
import { hashContent } from "../../src/drafting/plan-text.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import { draftPath } from "../../src/domain/paths.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { stopBlink } from "../../src/durability/index.ts";
import { cancelReview, trackReview } from "../../src/review/tracker.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

const QID = "abc123" as Qid;

function drafting() {
  return createDraft(createQuest("req", QID), "thing");
}

Deno.test("draft edit records the hash and flags pending", () => {
  replaceState(drafting());
  check(handleDraftEdit(draftPath(QID), "hash-1"), "changed");
  check(getState().draft?.contentHash === "hash-1", "hash recorded");
  check(getState().snapshotPending, "edit flags pending");
  replaceState(IDLE_STATE);
});

Deno.test("draft edit ignores identical saves and other paths", () => {
  replaceState(drafting());
  check(handleDraftEdit(draftPath(QID), "hash-1"), "first change");
  check(!handleDraftEdit(draftPath(QID), "hash-1"), "identical save ignored");
  check(!handleDraftEdit(".pi/quest/future/other.md", "hash-2"), "other path ignored");
  check(getState().draft?.contentHash === "hash-1", "hash kept");
  replaceState(IDLE_STATE);
});

Deno.test("draft edit without a quest is inert", () => {
  replaceState(IDLE_STATE);
  check(!handleDraftEdit(draftPath(QID), "hash-1"), "idle ignored");
  check(getState().phase === "idle", "idle untouched");
});

Deno.test("onWriteResult and onTurnEndCatchAll do not re-boot when target is already in-flight", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-edits-race-"));
  replaceState(drafting());
  const rel = draftPath(QID);
  const abs = join(cwd, rel);
  await mkdir(dirname(abs), { recursive: true });
  const doc = "## Requirements\n- R1\n- R2\n\n## Implementation Plan\n1. Step one\n";
  await writeFile(abs, doc, "utf8");
  const hash = hashContent(doc);
  updateState((s) => s.draft === null ? s : { ...s, draft: { ...s.draft, planAuthored: true, contentHash: hash } });
  let booted = 0;
  trackReview(QID, hash, () => {});
  try {
    await onWriteResult(
      fakePi(),
      fakeCtx(cwd),
      { type: "tool_result", toolCallId: "1", toolName: "write", input: { path: rel }, content: [], isError: false },
      async () => { booted += 1; },
    );
    await onTurnEndCatchAll(fakePi(), fakeCtx(cwd), async () => { booted += 1; });
    check(booted === 0, "neither onWriteResult nor onTurnEndCatchAll re-boots an already current review");
  } finally {
    cancelReview(QID);
    stopBlink();
    replaceState(IDLE_STATE);
    rmSync(cwd, { recursive: true, force: true });
  }
});

Deno.test("editing the draft file while provisional auto-transitions to drafting and marks planAuthored", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-provisional-edit-"));
  replaceState(createQuest("req", QID));
  const rel = draftPath(QID);
  const abs = join(cwd, rel);
  await mkdir(dirname(abs), { recursive: true });
  const doc = "## Requirements\n- R1: First\n- R2: Second\n\n## Implementation Plan\n1. Step one\n";
  await writeFile(abs, doc, "utf8");
  let booted = 0;
  try {
    await onWriteResult(
      fakePi(),
      fakeCtx(cwd),
      { type: "tool_result", toolCallId: "1", toolName: "edit", input: { path: rel }, content: [], isError: false },
      async () => { booted += 1; },
    );
    check(getState().phase === "drafting", "auto-transitioned from provisional to drafting");
    check(getState().draft?.planAuthored === true, "marked planAuthored true");
    check(booted === 1, "bootFn called once");
  } finally {
    stopBlink();
    replaceState(IDLE_STATE);
    rmSync(cwd, { recursive: true, force: true });
  }
});

Deno.test("onTurnEndCatchAll does not re-boot an unedited draft when outstandingFindings is true", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-fastfail-catchall-"));
  replaceState(drafting());
  const rel = draftPath(QID);
  const abs = join(cwd, rel);
  await mkdir(dirname(abs), { recursive: true });
  const doc = "## Requirements\n- R1\n- R2\n\n## Implementation Plan\n1. Step one\n";
  await writeFile(abs, doc, "utf8");
  const hash = hashContent(doc);
  updateState((s) =>
    s.draft === null
      ? s
      : { ...s, draft: { ...s.draft, planAuthored: true, contentHash: hash, outstandingFindings: true } }
  );
  let booted = 0;
  try {
    await onTurnEndCatchAll(fakePi(), fakeCtx(cwd), async () => { booted += 1; });
    check(booted === 0, "onTurnEndCatchAll does not re-boot when outstandingFindings is true on unchanged hash");
  } finally {
    stopBlink();
    replaceState(IDLE_STATE);
    rmSync(cwd, { recursive: true, force: true });
  }
});


