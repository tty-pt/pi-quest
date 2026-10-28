import { check } from "../check.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getState, replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft, promote } from "../../src/domain/transitions.ts";
import { draftPath } from "../../src/domain/paths.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { triageInQuestRequest } from "../../src/subquests/scope.ts";
import { installSubQuests } from "../../src/subquests/index.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";
import { JUDGE_OFF, JUDGE_ON, stubJudgeFetch, writeQuestSettings } from "../judge-stub.ts";

Deno.test("triage records refinements with routing guidance", () => {
  const triaged = triageInQuestRequest("abc123", "refinement");
  check(triaged !== null && triaged.record, "refinement recorded");
  check(triaged!.steer.includes("quest_update_state"), "amendment route named");
  check(triaged!.steer.includes("quest_subquest"), "sub-quest route named");
  check(triaged!.steer.includes("finish or archive"), "separate-quest instruction present");
  check(triaged!.steer.includes("abc123"), "qid carried");
});

Deno.test("triage leaves non-refinements to the agent", () => {
  check(triageInQuestRequest("abc123", "question") === null, "questions pass through");
  check(triageInQuestRequest("abc123", "ack") === null, "acks pass through");
  check(triageInQuestRequest("abc123", "advance") === null, "approvals pass through");
  check(triageInQuestRequest("abc123", "chat") === null, "chat_bypass passes through");
});

Deno.test("triage handles directives and subquest actions", () => {
  const preempt = triageInQuestRequest("abc123", "subquest_now", "fix memory leak");
  check(preempt !== null && preempt.record, "preempt recorded");
  check(preempt!.action === "preempt_subquest", "action preempt_subquest");
  check(preempt!.steer.includes("Spawning immediate sub-quest"), "preempt steer text");

  const queue = triageInQuestRequest("abc123", "subquest_later", "export csv");
  check(queue !== null && queue.record, "queue recorded");
  check(queue!.action === "queue_subquest", "action queue_subquest");
  check(queue!.steer.includes("Queued sub-quest"), "queue steer text");

  const rule = triageInQuestRequest("abc123", "constraint", "port 8080");
  check(rule !== null && rule.record, "rule recorded");
  check(rule!.action === "amend_requirement", "action amend_requirement");
  check(rule!.steer.includes("Recorded user constraint"), "rule steer text");
});

Deno.test("triage respects midQuest mode off", () => {
  const off = triageInQuestRequest("abc123", "constraint", "port 8080", {
    mode: "off",
    subquestAction: "queue_backlog",
    autoAmendRequirements: false,
    turnInjection: false,
    promptTimeoutMs: 1000,
  });
  check(off === null, "mode off disables triage interception");
});

Deno.test("steering with amendment demotes implementing quest back to draft mode", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-steer-test-"));
  try {
    const pi = fakePi();
    installSubQuests(pi);

    const qid = "1xTest" as Qid;
    const base = createDraft(createQuest("Test quest", qid), "test-draft");
    const authored = {
      ...base,
      draft: { ...base.draft!, planAuthored: true, contentHash: "h1" },
    };
    const implementing = promote(authored, "user");
    replaceState(implementing);

    const filePath = join(cwd, draftPath(qid));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "# Test\n\n## Requirements\n- R1: test\n\n## Implementation Plan\n1. Do thing\n", "utf8");

    const ctx = fakeCtx(cwd);
    const handler = pi.eventHandlers["input"]?.[0];
    check(typeof handler === "function", "input handler registered");

    await handler({ text: "!rule Must use UTF-8 encoding" }, ctx);

    const after = getState();
    check(after.phase === "drafting", "demoted to drafting");
    check(after.draft?.approvedBy === null, "approvedBy cleared");
    check(after.draft?.outstandingFindings === true, "outstandingFindings set");
    check(after.amendments.length === 1, "amendment recorded");
    check(after.amendments[0].change === "Must use UTF-8 encoding", "amendment change text");
    check(pi.sent.some((s) => JSON.stringify(s).includes("Quest returned to draft mode")), "steer message sent to agent");
  } finally {
    replaceState(IDLE_STATE);
    rmSync(cwd, { recursive: true, force: true });
  }
});

Deno.test("steering when already in drafting remains in drafting without throwing", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-steer-draft-"));
  try {
    const pi = fakePi();
    installSubQuests(pi);

    const qid = "1xDrft" as Qid;
    const base = createDraft(createQuest("Test quest", qid), "test-draft");
    replaceState(base);

    const filePath = join(cwd, draftPath(qid));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "# Test\n\n## Requirements\n\n## Implementation Plan\n", "utf8");

    const ctx = fakeCtx(cwd);
    const handler = pi.eventHandlers["input"]?.[0];

    await handler({ text: "!rule Must use strict typing" }, ctx);

    const after = getState();
    check(after.phase === "drafting", "still in drafting");
    check(after.amendments.length === 1, "amendment recorded");
  } finally {
    replaceState(IDLE_STATE);
    rmSync(cwd, { recursive: true, force: true });
  }
});

Deno.test("autoAmendRequirements: false leaves action as refinement and does not demote", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-steer-noamend-"));
  try {
    const pi = fakePi();
    installSubQuests(pi);

    const qid = "1xNoAm" as Qid;
    const base = createDraft(createQuest("Test quest", qid), "test-draft");
    const authored = {
      ...base,
      draft: { ...base.draft!, planAuthored: true, contentHash: "h1" },
    };
    const implementing = promote(authored, "user");
    replaceState(implementing);

    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ "pi-quest": { ...JUDGE_OFF, midQuest: { autoAmendRequirements: false } } }), "utf8");

    const filePath = join(cwd, draftPath(qid));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "# Test\n\n## Requirements\n\n## Implementation Plan\n", "utf8");

    const ctx = fakeCtx(cwd);
    const handler = pi.eventHandlers["input"]?.[0];

    await handler({ text: "Please also check edge case for empty strings" }, ctx);

    const after = getState();
    check(after.phase === "implementing", "remains in implementing");
    check(after.amendments.length === 0, "no amendment recorded");
    check(after.refinements.length === 1, "refinement recorded");
  } finally {
    replaceState(IDLE_STATE);
    rmSync(cwd, { recursive: true, force: true });
  }
});

async function implementingHarness(qidText: string, settings: Record<string, unknown> = JUDGE_OFF) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-steer-go-"));
  writeQuestSettings(cwd, settings);
  const pi = fakePi();
  installSubQuests(pi);
  const qid = qidText as Qid;
  const base = createDraft(createQuest("Test quest", qid), "test-draft");
  const authored = { ...base, draft: { ...base.draft!, planAuthored: true, contentHash: "h1" } };
  replaceState(promote(authored, "user"));
  const filePath = join(cwd, draftPath(qid));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "# Test\n\n## Requirements\n- R1: test\n\n## Implementation Plan\n1. Do thing\n", "utf8");
  return { cwd, pi, ctx: fakeCtx(cwd), handler: pi.eventHandlers["input"]![0] };
}

Deno.test("judge-classified steering in implementing never records an amendment or demotes (any language)", async () => {
  const phrases = ["Go on", "ship it", "Carry on", "continua", "vai em frente", "cancel", "ok bora lá"];
  const restore = stubJudgeFetch((_id, state) => (state.includes("cancel") ? "abort" : "advance"));
  try {
    for (const phrase of phrases) {
      const h = await implementingHarness("1xGoOn", JUDGE_ON);
      try {
        await h.handler({ text: phrase }, h.ctx);
        const after = getState();
        check(after.phase === "implementing", `"${phrase}" keeps implementing`);
        check(after.amendments.length === 0, `"${phrase}" records no amendment`);
        check(after.refinements.length === 0, `"${phrase}" records no refinement`);
        check(after.draft?.approvedBy === "user", `"${phrase}" keeps approval`);
      } finally {
        replaceState(IDLE_STATE);
        rmSync(h.cwd, { recursive: true, force: true });
      }
    }
  } finally {
    restore();
  }
});

Deno.test("judge off: only the single fallback word steers; other phrasing is a harmless refinement", async () => {
  const h = await implementingHarness("1xGoFb");
  try {
    await h.handler({ text: "go" }, h.ctx);
    check(getState().refinements.length === 0, "bare go is steering, not a refinement");
    await h.handler({ text: "Go on" }, h.ctx);
    const after = getState();
    check(after.phase === "implementing", "unrecognized phrase never demotes");
    check(after.draft?.approvedBy === "user", "approval kept");
    check(after.refinements.length === 1, "recorded as a plain refinement");
  } finally {
    replaceState(IDLE_STATE);
    rmSync(h.cwd, { recursive: true, force: true });
  }
});

Deno.test("operator steeringPhrases extend the judge-less fallback (locale words live in settings, not code)", async () => {
  const h = await implementingHarness("1xGoPh", { ...JUDGE_OFF, steeringPhrases: ["vai em frente"] });
  try {
    await h.handler({ text: "Vai em frente!" }, h.ctx);
    check(getState().refinements.length === 0, "operator phrase is steering");
  } finally {
    replaceState(IDLE_STATE);
    rmSync(h.cwd, { recursive: true, force: true });
  }
});

Deno.test("a plain refinement in implementing is recorded but does not demote", async () => {
  const h = await implementingHarness("1xRefn");
  try {
    await h.handler({ text: "Please also make the error messages friendlier for the user" }, h.ctx);
    const after = getState();
    check(after.phase === "implementing", "stays implementing");
    check(after.draft?.approvedBy === "user", "approval kept");
    check(after.amendments.length === 1, "amendment recorded");
    check(!h.pi.sent.some((s) => JSON.stringify(s).includes("returned to draft mode")), "no draft-mode steer");
  } finally {
    replaceState(IDLE_STATE);
    rmSync(h.cwd, { recursive: true, force: true });
  }
});

Deno.test("a message that merely contains a steering word is still a directive", async () => {
  const h = await implementingHarness("1xCnclB");
  try {
    await h.handler({ text: "Add a cancel button to the settings dialog and keep going on the tests" }, h.ctx);
    const after = getState();
    check(after.amendments.length === 1, "directive recorded despite containing steering words");
    check(after.phase === "implementing", "still implementing (refinement, not constraint)");
  } finally {
    replaceState(IDLE_STATE);
    rmSync(h.cwd, { recursive: true, force: true });
  }
});

