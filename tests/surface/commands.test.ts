import { check } from "../check.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getState, replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE, recordReviewResult } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import { encodeSnapshot, SNAPSHOT_TYPE } from "../../src/durability/snapshots.ts";
import { killQuest } from "../../src/surface/commands/quest-del.ts";
import { listQuests } from "../../src/surface/commands/quests.ts";
import { resumeQuest, summarizeActive } from "../../src/surface/commands/quest.ts";
import { askHumanTool } from "../../src/surface/tools/ask-human.ts";
import { rebutTool } from "../../src/surface/tools/rebut.ts";
import { runQuestDoctor, createQuestDoctorComponent } from "../../src/surface/commands/doctor.ts";
import { installCommands } from "../../src/surface/commands/index.ts";
import { checkJudgeHealth } from "../../src/drafting/judge.ts";
import { readQuestConfig } from "../../src/config.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-quest-cmd-"));
}

Deno.test("quest command shows, resumes, and adopts", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi();
  const cwd = tmp();
  check((await resumeQuest(pi, fakeCtx(cwd), "")).includes("No active quest"), "idle shown");
  const hit = encodeSnapshot(createQuest("found work", "abc123"));
  const resumed = await resumeQuest(pi, fakeCtx(cwd, [{ customType: SNAPSHOT_TYPE, data: hit }]), "abc123");
  check(resumed.includes("abc123") && getState().qid === "abc123", "snapshot resumed");
  check(summarizeActive().includes("provisional"), "summary reflects phase");
  mkdirSync(join(cwd, ".pi", "quest", "future"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "quest", "future", "dff456.md"), "## Original request\n\nDrafted work.\n");
  const adopted = await resumeQuest(pi, fakeCtx(cwd), "dff456");
  check(adopted.includes("dff456") && getState().phase === "drafting", "draft file adopted");
  check((await resumeQuest(pi, fakeCtx(cwd), "nope")).includes("No quest matching"), "unknown reported");
  replaceState(IDLE_STATE);
});

Deno.test("quests command lists branch, drafts, and archives", async () => {
  replaceState(IDLE_STATE);
  const cwd = tmp();
  mkdirSync(join(cwd, ".pi", "quest", "future"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "quest", "future", "dff456.md"), "draft");
  mkdirSync(join(cwd, ".pi", "quest", "archive"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "quest", "archive", "old001.zip"), "zip");
  const hit = encodeSnapshot(createQuest("active work", "abc123"));
  replaceState(createQuest("active work", "abc123"));
  const rows = await listQuests(fakeCtx(cwd, [{ customType: SNAPSHOT_TYPE, data: hit }]));
  const text = rows.join("\n");
  check(text.includes("abc123") && text.includes("active"), "branch quest with marker");
  check(text.includes("dff456"), "draft listed");
  check(text.includes("old001"), "archive listed");
  replaceState(IDLE_STATE);
});

Deno.test("quest-del archives the active quest abandoned", async () => {
  const drafting = createDraft(createQuest("doomed", "abc123"), "doomed");
  replaceState({ ...drafting, phase: "implementing" as const });
  const pi = fakePi();
  const out = await killQuest(pi, fakeCtx(tmp()), "");
  check(out.includes("abandoned") && getState().phase === "idle", "killed and cleared");
  replaceState(IDLE_STATE);
  const none = await killQuest(fakePi(), fakeCtx(tmp()), "");
  check(none.includes("No active quest"), "nothing to kill");
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

Deno.test("installCommands registers quest-doctor EntryRenderer and dispatches via /quest doctor", async () => {
  const pi = fakePi();
  installCommands(pi);

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

    // Execute /quest-doctor alias
    const questDoctorCmd = pi.commands.find((c) => c.name === "quest-doctor");
    check(Boolean(questDoctorCmd), "must register 'quest-doctor' command alias");
    await questDoctorCmd!.options.handler("", ctx);

    check(pi.appended.length === 2, "must append second entry for /quest-doctor alias");
    check(pi.appended[1].customType === "quest-doctor", "second entry must also be 'quest-doctor'");

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
