import { check } from "../check.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getState, replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE, recordReviewResult } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import { encodeSnapshot, SNAPSHOT_TYPE } from "../../src/durability/snapshots.ts";
import { killQuest, parseQuestDelArgs } from "../../src/surface/commands/quest-del.ts";
import { listQuests } from "../../src/surface/commands/quests.ts";
import { pathToFileURL } from "node:url";
import { resumeQuest, summarizeActive } from "../../src/surface/commands/quest.ts";
import { askHumanTool } from "../../src/surface/tools/ask-human.ts";
import { rebutTool } from "../../src/surface/tools/rebut.ts";
import { runQuestDoctor, createQuestDoctorComponent } from "../../src/surface/commands/doctor.ts";
import { installCommands } from "../../src/surface/commands/index.ts";
import { checkJudgeHealth } from "../../src/drafting/judge.ts";
import { readQuestConfig } from "../../src/config.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";
import { hasInFlight, trackReview, cancelReview } from "../../src/review/tracker.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-quest-cmd-"));
}

Deno.test("quest command shows card, resumes by qid or name, and adopts", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi();
  const cwd = tmp();
  const idleCard = await resumeQuest(pi, fakeCtx(cwd), "");
  check(idleCard.includes("Quest Status: 💤 idle") && idleCard.includes("/quest edit"), "idle card shown");
  const hit = encodeSnapshot(createQuest("found work", "abc123"));
  const resumed = await resumeQuest(pi, fakeCtx(cwd, [{ customType: SNAPSHOT_TYPE, data: hit }]), "abc123");
  check(resumed.includes("abc123") && getState().qid === "abc123", "snapshot resumed");
  check(summarizeActive().includes("provisional"), "summary reflects phase");
  const activeCard = await resumeQuest(pi, fakeCtx(cwd), "");
  const expectedFileUrl = pathToFileURL(join(cwd, ".pi/quest/future/abc123.md")).href;
  check(
    activeCard.includes(`\x1b]8;;${expectedFileUrl}\x1b\\.pi/quest/future/abc123.md\x1b]8;;\x1b\\`),
    "active quest card renders clickable OSC 8 file:// hyperlink for plan path",
  );
  mkdirSync(join(cwd, ".pi", "quest", "future"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "quest", "future", "dff456.md"), "# fix-seams\n\n## Original request\n\nDrafted work.\n");
  const adopted = await resumeQuest(pi, fakeCtx(cwd), "fix-seams");
  check(adopted.includes("dff456") && getState().phase === "drafting", "draft file adopted by readable heading");
  check((await resumeQuest(pi, fakeCtx(cwd), "nope")).includes("No quest matching"), "unknown reported");
  replaceState(IDLE_STATE);
});

Deno.test("quests command lists branch and drafts with rich triage info", async () => {
  replaceState(IDLE_STATE);
  const cwd = tmp();
  mkdirSync(join(cwd, ".pi", "quest", "future"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "quest", "future", "dff456.md"), "# my-draft\n\ndraft");
  const hit = encodeSnapshot(createQuest("active work", "abc123"));
  replaceState(createQuest("active work", "abc123"));
  const rows = await listQuests(fakeCtx(cwd, [{ customType: SNAPSHOT_TYPE, data: hit }]));
  const text = rows.join("\n");
  check(text.includes("abc123") && text.includes("active"), "branch quest with marker");
  check(text.includes("dff456") && text.includes("my-draft"), "draft listed with readable name and triage row");
  replaceState(IDLE_STATE);
});

Deno.test("quest-del deletes the active quest or named draft without zip creation", async () => {
  const drafting = createDraft(createQuest("doomed", "abc123"), "doomed");
  replaceState({ ...drafting, phase: "implementing" as const });
  const pi = fakePi();
  const out = await killQuest(pi, fakeCtx(tmp()), "");
  check(out.includes("abandoned") && getState().phase === "idle", "killed and cleared");
  replaceState(IDLE_STATE);
  const none = await killQuest(fakePi(), fakeCtx(tmp()), "");
  check(none.includes("No active quest"), "nothing to kill");

  // Direct draft deletion by qid when idle
  const cwd2 = tmp();
  mkdirSync(join(cwd2, ".pi", "quest", "future"), { recursive: true });
  writeFileSync(join(cwd2, ".pi", "quest", "future", "1xDRFT.md"), "# draft-idea\n\n## Original request\n\nIdea.\n");
  const delDraft = await killQuest(fakePi(), fakeCtx(cwd2), "1xDRFT");
  check(delDraft.includes("Deleted 1/1") && delDraft.includes("1xDRFT"), delDraft);

  // Flags parsing
  check(parseQuestDelArgs("").action === undefined, "no action by default");
  check(parseQuestDelArgs("--integrate").action === "integrate", "parses --integrate");
  check(parseQuestDelArgs("-i").action === "integrate", "parses -i");
  check(parseQuestDelArgs("--merge").action === "integrate", "parses --merge");
  check(parseQuestDelArgs("--keep").action === "keep", "parses --keep");
  check(parseQuestDelArgs("-k").action === "keep", "parses -k");
  check(parseQuestDelArgs("--keep-slot").action === "keep-slot", "parses --keep-slot");
  check(parseQuestDelArgs("--slot").action === "keep-slot", "parses --slot");
  check(parseQuestDelArgs("-s").action === "keep-slot", "parses -s");
  check(parseQuestDelArgs("--discard").action === "discard", "parses --discard");
  const targetParsed = parseQuestDelArgs("xyz789 --integrate");
  check(targetParsed.targetQid === "xyz789" && targetParsed.action === "integrate", "parses targetQid and action");
});

Deno.test("rebut and ask-human tools answer honestly", async () => {
  const pi = fakePi();
  const ctx = fakeCtx(tmp());
  const short = await rebutTool(pi).execute("1", { rebuttal: "no" }, undefined, undefined, ctx);
  check((short.details as { error: string }).error === "rebuttal_too_short", "thin rebuttal refused");
  replaceState(IDLE_STATE);
  const idle = await rebutTool(pi).execute("1", { rebuttal: "substantive evidence here" }, undefined, undefined, ctx);
  check((idle.details as { error: string }).error === "nothing_to_rebut", "idle rebut refused");
  const drafting = createDraft(createQuest("work", "abc123"), "work");
  const reviewed = recordReviewResult(
    { ...drafting, draft: { ...drafting.draft!, contentHash: "h1" } },
    "FAIL",
    "h1",
    "missing auth",
  );
  replaceState(reviewed);
  const round = await rebutTool(pi).execute("1", { rebuttal: "auth is covered in section 3" }, undefined, undefined, ctx);
  check((round.details as { round: number }).round === 1, "round recorded without a draft file on disk");
  replaceState(createQuest("work", "abc123"));
  const asked = await askHumanTool(pi).execute("2", { question: "Which?", default: "this" }, undefined, undefined, ctx);
  check((asked.details as { source: string }).source === "default", "no-UI defaults");
  check((asked.content[0].text ?? "").includes("this"), "default surfaced");
  replaceState(IDLE_STATE);
});

Deno.test("quest doctor and checkJudgeHealth report online status and offline fallback", async () => {
  // 1. Online mock server
  const server = Deno.serve({ port: 0 }, () => {
    return new Response(JSON.stringify({
      object: "list",
      data: [{ id: "qwen" }, { id: "bge-small" }],
    }), { headers: { "Content-Type": "application/json" } });
  });

  const onlinePort = server.addr.port;
  const onlineCwd = tmp();
  mkdirSync(join(onlineCwd, ".pi"), { recursive: true });
  writeFileSync(join(onlineCwd, ".pi", "settings.json"), JSON.stringify({
    "pi-quest": {
      judgeUrl: `http://127.0.0.1:${onlinePort}`,
    },
  }));

  try {
    const cfgOnline = await readQuestConfig(onlineCwd);
    const healthOnline = await checkJudgeHealth(cfgOnline);
    check(healthOnline.ok, "judge is reported ok");
    check(Boolean(healthOnline.models?.includes("qwen") && healthOnline.models?.includes("bge-small")), "models listed");

    const outOnline = await runQuestDoctor(fakePi(), fakeCtx(onlineCwd));
    check(outOnline.includes("[✓] Judge Service"), "doctor reports healthy judge");
    check(outOnline.includes("qwen, bge-small"), "doctor reports models");
    check(outOnline.includes("quest:"), "doctor reports trigger prefixes");

    // 2. Offline unreachable port
    const offlineCwd = tmp();
    mkdirSync(join(offlineCwd, ".pi"), { recursive: true });
    writeFileSync(join(offlineCwd, ".pi", "settings.json"), JSON.stringify({
      "pi-quest": {
        judgeUrl: "http://127.0.0.1:59998",
      },
    }));

    const cfgOffline = await readQuestConfig(offlineCwd);
    const healthOffline = await checkJudgeHealth(cfgOffline);
    check(!healthOffline.ok, "judge is reported offline");
    check(Boolean(healthOffline.error), "error is populated");

    const outOffline = await runQuestDoctor(fakePi(), fakeCtx(offlineCwd));
    check(outOffline.includes("[✗] Judge Service"), "doctor reports offline judge");
    check(outOffline.includes("Offline fail-closed active"), "doctor reports fail-closed safety");
  } finally {
    await server.shutdown();
  }
});

Deno.test("installCommands registers only /quest and dispatches doctor subcommand", async () => {
  const pi = fakePi();
  installCommands(pi);

  check(pi.commands.length === 1 && pi.commands[0].name === "quest", "registers only /quest top-level command");

  // 1. Verify EntryRenderer registration
  check(pi.entryRenderers.has("quest-doctor"), "must register 'quest-doctor' entry renderer");
  // deno-lint-ignore no-explicit-any
  const rendererFn = pi.entryRenderers.get("quest-doctor") as any;
  check(typeof rendererFn === "function", "renderer function must be registered");

  // 2. Mock online server for command execution
  const server = Deno.serve({ port: 0 }, () => {
    return new Response(JSON.stringify({
      object: "list",
      data: [{ id: "qwen" }, { id: "bge-small" }],
    }), { headers: { "Content-Type": "application/json" } });
  });

  const onlinePort = server.addr.port;
  const onlineCwd = tmp();
  mkdirSync(join(onlineCwd, ".pi"), { recursive: true });
  writeFileSync(join(onlineCwd, ".pi", "settings.json"), JSON.stringify({
    "pi-quest": {
      judgeUrl: `http://127.0.0.1:${onlinePort}`,
    },
  }));

  try {
    const ctx = fakeCtx(onlineCwd);
    const questCmd = pi.commands.find((c) => c.name === "quest");
    check(Boolean(questCmd), "must register 'quest' command");

    // Execute /quest doctor
    await questCmd!.options.handler("doctor", ctx);

    check(pi.appended.length === 1, "must append exactly one entry for /quest doctor");
    check(pi.appended[0].customType === "quest-doctor", "appended entry type must be 'quest-doctor'");
    // deno-lint-ignore no-explicit-any
    const appendedData = pi.appended[0].data as any;
    check(Array.isArray(appendedData.lines), "appended data must have lines array");
    check(appendedData.lines.some((l: string) => l.includes("[✓] Judge Service")), "must report healthy judge in lines");

    // 3. Test createQuestDoctorComponent formatting
    const comp = rendererFn({ data: appendedData }, {}, {
      fg: (_color: string, text: string) => `[STYLE]${text}[/STYLE]`,
      bold: (text: string) => `[BOLD]${text}[/BOLD]`,
    });
    const renderedLines = comp.render(80);
    check(renderedLines.length > 5, "component must render lines");
    check(renderedLines[0].includes("─"), "must include top border");
    check(renderedLines[1].includes("Quest System & Judge Doctor"), "must render title");
    check(renderedLines[renderedLines.length - 1].includes("─"), "must include bottom border");
  } finally {
    await server.shutdown();
  }
});

Deno.test("/quest cancel and /quest cancel-review cancel in-flight review", async () => {
  const pi = fakePi();
  installCommands(pi);
  const cwd = tmp();
  const ctx = fakeCtx(cwd);
  replaceState({ ...createQuest("req", "rev123"), phase: "implementing" });

  const questCmd = pi.commands.find((c) => c.name === "quest");
  check(Boolean(questCmd), "must register 'quest' command");

  // No review in-flight
  await questCmd!.options.handler("cancel", ctx);
  check(ctx.notifications.calls.some((n) => n.message.includes("No review currently in-flight")), "reports no review");

  // Track an in-flight review
  trackReview("rev123", "target1", () => {});
  check(hasInFlight("rev123") === true, "review is in-flight");

  // Cancel via /quest cancel
  await questCmd!.options.handler("cancel", ctx);
  check(hasInFlight("rev123") === false, "review cancelled");
  check(ctx.notifications.calls.some((n) => n.message.includes("Cancelled in-flight review")), "reports cancelled");

  // Test /quest cancel-review alias
  trackReview("rev123", "target2", () => {});
  check(hasInFlight("rev123") === true, "review is in-flight again");
  await questCmd!.options.handler("cancel-review", ctx);
  check(hasInFlight("rev123") === false, "review cancelled via alias");

  cancelReview("rev123");
  replaceState(IDLE_STATE);
});

Deno.test("/quest ratings formats model distributions and autonomy levels", async () => {
  const pi = fakePi();
  installCommands(pi);
  const cwd = tmp();
  const ctx = fakeCtx(cwd);

  const questCmd = pi.commands.find((c) => c.name === "quest");
  check(Boolean(questCmd), "must register 'quest' command");

  await questCmd!.options.handler("ratings", ctx);
  check(ctx.notifications.calls.some((n) => n.message.includes("Model Reliability & Autonomy Ratings")), "reports header");
  check(ctx.notifications.calls.some((n) => n.message.includes("Autonomy Ladder Thresholds")), "reports thresholds");
});

Deno.test("/quest pause and /quest on pause active quest and bypass auto-detection, gate, and worktree jailing", async () => {
  const { detectSubstantiveRequest } = await import("../../src/drafting/detect.ts");
  const { installDraftGate } = await import("../../src/drafting/gate.ts");
  const { installToolInterception } = await import("../../src/surface/tools/handlers/interception.ts");
  const { questStatus } = await import("../../src/durability/status.ts");

  const pi = fakePi();
  installCommands(pi);
  installDraftGate(pi);
  installToolInterception(pi);
  const cwd = tmp();
  const ctx = fakeCtx(cwd);

  // 1. Start with an active drafting quest
  const drafting = createDraft(createQuest("active objective", "1xPAUSED"), "fix-seams");
  replaceState(drafting);
  check(getState().disabled !== true, "initially enabled");

  // 2. Pause via /quest pause
  const questCmd = pi.commands.find((c) => c.name === "quest");
  await questCmd!.options.handler("pause", ctx);
  check(getState().disabled === true, "disabled flag is true after /quest pause");
  check(getState().qid === "1xPAUSED", "active quest qid preserved while paused");
  check(questStatus(getState(), "icon") === "⏸️ fix-seams₁\x1b[32m₃\x1b[39m", "status bar shows paused quest with ⏸️ icon, readable name, and subscripts");

  // 3. Verify tool calls are NOT blocked by draft gate while disabled
  const toolHandlers = pi.eventHandlers["tool_call"] ?? [];
  for (const h of toolHandlers) {
    const verdict = h({ toolName: "write", input: { path: "src/foo.ts", content: "hi" } }, ctx);
    check(verdict === undefined, "write tool not blocked by draft gate while disabled");
  }

  // 4. Verify auto-detection is bypassed when idle + disabled
  replaceState({ ...IDLE_STATE, disabled: true });
  check(questStatus(getState(), "icon") === "⏸️ off", "status bar shows ⏸️ off when idle and disabled");
  const detected = await detectSubstantiveRequest(pi, ctx, "quest: build a new feature");
  check(detected === false, "detectSubstantiveRequest bypassed even with explicit trigger prefix when disabled");

  // 5. Re-enable via /quest on
  replaceState({ ...drafting, disabled: true });
  await questCmd!.options.handler("on", ctx);
  check(getState().disabled === false, "disabled flag is false after /quest on");
  check(getState().qid === "1xPAUSED", "paused quest restored");

  // 6. Toggle via /quest toggle subcommand
  await questCmd!.options.handler("toggle", ctx);
  check(getState().disabled === true, "disabled flag is true after /quest toggle from enabled");
  await questCmd!.options.handler("toggle", ctx);
  check(getState().disabled === false, "disabled flag is false after /quest toggle from disabled");

  // 7. Toggle via alt+j shortcut
  const shortcut = pi.shortcuts.find((s) => s.shortcut === "alt+j");
  check(Boolean(shortcut), "must register 'alt+j' shortcut");
  await shortcut!.options.handler(ctx);
  check(getState().disabled === true, "disabled flag is true after alt+j shortcut from enabled");
  await shortcut!.options.handler(ctx);
  check(getState().disabled === false, "disabled flag is false after alt+j shortcut from disabled");

  replaceState(IDLE_STATE);
});

Deno.test("/quest del --keep-slot and /quest new preserve worktree slot and chain a new quest onto the same slot", async () => {
  const { readSlotLease, writeSlotLease } = await import("../../src/utils/git/pool.ts");
  const pi = fakePi();
  installCommands(pi);
  const cwd = tmp();
  const slot7 = join(cwd, ".pi", "scratch", "slot-7");
  mkdirSync(join(slot7, ".git"), { recursive: true });
  writeSlotLease(slot7, {
    slotId: "slot-7",
    status: "leased",
    leasedToQid: "1xR98r",
    leasedAt: Date.now(),
    pid: process.pid,
    branch: "quest/1xR98r",
    baseCommit: "abc000",
  });

  const ctx = fakeCtx(cwd);
  const questCmd = pi.commands.find((c) => c.name === "quest");
  check(Boolean(questCmd), "must register 'quest' command");

  // 1. Delete active quest with --keep-slot
  const active = createDraft(createQuest("horizon-deterministic-scenery", "1xR98r"), "horizon-deterministic-scenery");
  replaceState({ ...active, phase: "implementing", worktreePath: slot7, worktreeBranch: "quest/1xR98r" });
  await questCmd!.options.handler("del --keep-slot", ctx);

  check(getState().phase === "idle", "state is idle after /quest del --keep-slot");
  check(getState().worktreePath === slot7, "worktreePath retained on idle state");
  check(getState().worktreeBranch === "quest/1xR98r", "worktreeBranch retained on idle state");
  const leaseAfterDel = readSlotLease(slot7);
  check(leaseAfterDel?.status === "leased" && leaseAfterDel?.leasedToQid === null, "slot lease stays leased with leasedToQid=null");

  // 2. Chain a new quest directly onto the retained slot via /quest new <objective> (even if paused via /quest off)
  replaceState({ ...active, phase: "implementing", worktreePath: slot7, worktreeBranch: "quest/1xR98r", disabled: true });
  await questCmd!.options.handler("new Add atmospheric scattering on top of horizon work", ctx);

  const chained = getState();
  check(chained.disabled === false, "re-enables pi-quest when starting /quest new");
  check(chained.qid !== null && chained.qid !== "1xR98r", "allocates a new qid for the chained quest");
  check(chained.worktreePath === slot7, "chained quest inherits retained worktreePath (slot-7)");
  check(chained.worktreeBranch === "quest/1xR98r", "chained quest inherits worktreeBranch");
  const leaseAfterNew = readSlotLease(slot7);
  check(leaseAfterNew?.leasedToQid === chained.qid, "slot-7 lease rebound to the new quest qid");

  replaceState(IDLE_STATE);
});

Deno.test("/quest on [goal] starts a quest seeded from prior Argon conversation and /quest finish --keep-slot retains slot on COMPLETED", async () => {
  const { readSlotLease, writeSlotLease } = await import("../../src/utils/git/pool.ts");
  const { implementationFingerprint } = await import("../../src/review/flow.ts");
  const pi = fakePi();
  installCommands(pi);
  const cwd = tmp();
  const entries = [
    { data: { role: "user", content: "Let's add keep-slot support for completed quests so we can manually test in the scratch slot." } },
    { data: { role: "assistant", content: "We can update confirmAndSquashWorktree and archiveActiveQuest." } },
  ];
  const ctx = fakeCtx(cwd, entries);
  const questCmd = pi.commands.find((c) => c.name === "quest")!;

  // 1. Start disabled (Argon chat mode), then run `/quest on go for it`
  replaceState({ ...IDLE_STATE, disabled: true });
  await questCmd.options.handler("on go for it", ctx);
  const started = getState();
  check(started.disabled === false, "pi-quest enabled");
  check(started.qid !== null, "new quest opened by /quest on <goal>");
  check(started.objective.includes("add keep-slot support"), "objective extracted from prior Argon conversation");

  // 2. Complete the quest in a scratch slot with `/quest finish --keep-slot`
  const slot3 = join(cwd, ".pi", "scratch", "slot-3");
  mkdirSync(join(slot3, ".git"), { recursive: true });
  writeSlotLease(slot3, {
    slotId: "slot-3",
    status: "leased",
    leasedToQid: started.qid,
    leasedAt: Date.now(),
    pid: process.pid,
    branch: `quest/${started.qid}`,
    baseCommit: "abc000",
  });

  const drafted = createDraft(started, "keep-slot-support");
  const validatingState = {
    ...drafted,
    phase: "validating" as const,
    draft: { ...drafted.draft!, planAuthored: true },
    worktreePath: slot3,
    worktreeBranch: `quest/${started.qid}`,
  };
  const fp = implementationFingerprint(validatingState);
  replaceState({
    ...validatingState,
    lastReview: { verdict: "PASS", target: fp, findings: "all good" },
  });

  await questCmd.options.handler("finish --keep-slot", ctx);
  const afterFinish = getState();
  check(afterFinish.phase === "idle", "quest archived and returned to idle");
  check(afterFinish.worktreePath === slot3, "slot-3 retained on idle state for manual testing");
  check(afterFinish.worktreeBranch === `quest/${started.qid}`, "branch retained on idle state");
  const leaseAfterFinish = readSlotLease(slot3);
  check(leaseAfterFinish?.status === "leased" && leaseAfterFinish?.leasedToQid === null, "slot-3 lease retained with leasedToQid=null");

  replaceState(IDLE_STATE);
});



