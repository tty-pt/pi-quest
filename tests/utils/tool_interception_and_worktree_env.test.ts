import { check } from "../check.ts";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, symlinkSync, lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isExemptFromWorktreeJail,
  rewritePathToWorktree,
  rewriteBashCommandToWorktree,
  installToolInterception,
} from "../../src/surface/tools/handlers/interception.ts";
import { replaceState } from "../../src/app/store.ts";
import { IDLE_STATE, createQuest } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import { setupWorktreeEnvironment } from "../../src/utils/git/worktree.ts";
import { delegateSubQuestToSubagent } from "../../src/surface/tools/subquest.ts";
import type { Qid } from "../../src/domain/qid.ts";

Deno.test("proof 1: tool interception path rewriting and exemptions", () => {
  const primaryRoot = "/home/user/project";
  const worktreePath = "/home/user/project/.pi/worktrees/1xTEST";

  // 1. Relative code paths should be jailed to worktree
  const jailedRel = rewritePathToWorktree("src/index.ts", primaryRoot, worktreePath);
  check(jailedRel === join(worktreePath, "src/index.ts"), "relative path jailed to worktree");

  // 2. Absolute primary repo paths should be jailed to worktree
  const jailedAbs = rewritePathToWorktree("/home/user/project/mods/foo.c", primaryRoot, worktreePath);
  check(jailedAbs === join(worktreePath, "mods/foo.c"), "primary absolute path jailed to worktree");

  // 2b. Absolute path ALREADY inside worktreePath must NOT be doubled
  const alreadyInWt = join(worktreePath, "mods/foo.c");
  const notDoubled = rewritePathToWorktree(alreadyInWt, primaryRoot, worktreePath);
  check(notDoubled === alreadyInWt, "already-jailed worktree path is not doubled");
  check(!notDoubled.includes(".pi/worktrees/1xTEST/.pi/worktrees"), "no worktree path nesting");

  // 3. Quest journals MUST remain in primary repo
  check(isExemptFromWorktreeJail(".pi/quest/future/1xTEST.md") === true, "quest future doc is exempt");
  const exemptQuest = rewritePathToWorktree(".pi/quest/future/1xTEST.md", primaryRoot, worktreePath);
  check(exemptQuest === ".pi/quest/future/1xTEST.md", "quest doc path unchanged");

  // 4. Settings and git files are exempt
  check(isExemptFromWorktreeJail(".pi/settings.json") === true, "settings.json is exempt");
  check(isExemptFromWorktreeJail(".git/config") === true, "git config is exempt");
  check(isExemptFromWorktreeJail("/home/user/project/.pi/settings.json") === true, "abs settings is exempt");

  // 5. Tracked git files (.gitignore, .gitmodules, .githooks) MUST be jailed to worktree, not exempt
  check(isExemptFromWorktreeJail(".gitignore") === false, ".gitignore is NOT exempt (jailed to worktree)");
  check(isExemptFromWorktreeJail(".gitmodules") === false, ".gitmodules is NOT exempt (jailed to worktree)");
  check(isExemptFromWorktreeJail(".githooks/pre-commit") === false, ".githooks is NOT exempt (jailed to worktree)");
  check(rewritePathToWorktree(".gitignore", primaryRoot, worktreePath) === join(worktreePath, ".gitignore"), ".gitignore rewrites to worktree");
  check(rewritePathToWorktree(".gitmodules", primaryRoot, worktreePath) === join(worktreePath, ".gitmodules"), ".gitmodules rewrites to worktree");
});

Deno.test("proof 2: bash command wrapping to worktree", () => {
  const primaryRoot = "/home/user/project";
  const worktreePath = "/home/user/project/.pi/worktrees/1xTEST";

  const cmd = "make test-fast";
  const wrapped = rewriteBashCommandToWorktree(cmd, worktreePath);
  check(wrapped.includes(`cd "${worktreePath}"`), "bash command cd's to worktree");
  check(wrapped.includes("make test-fast"), "original command preserved inside wrapper");

  // Avoid double wrapping
  const doubleWrapped = rewriteBashCommandToWorktree(wrapped, worktreePath);
  check(doubleWrapped === wrapped, "double-wrapping prevented");

  // Prevent shell cd escape to primaryRoot
  const escapeCmd = "cd /home/user/project/mods/nd && make";
  const jailedEscape = rewriteBashCommandToWorktree(escapeCmd, worktreePath, "/home/user/project");
  check(!jailedEscape.includes("cd /home/user/project/mods/nd"), "primaryRoot cd path was rewritten");
  check(jailedEscape.includes(`cd ${worktreePath}/mods/nd`), "primaryRoot cd redirected to worktreePath");

  // Absolute path arguments pointing to primaryRoot are redirected to worktreePath
  const argCmd = "gcc -o /home/user/project/bin/out /home/user/project/src/main.c";
  const sanitizedArgs = rewriteBashCommandToWorktree(argCmd, worktreePath, primaryRoot);
  check(sanitizedArgs.includes(`${worktreePath}/bin/out`), "primaryRoot output path rewritten to worktree");
  check(sanitizedArgs.includes(`${worktreePath}/src/main.c`), "primaryRoot input path rewritten to worktree");

  // Exempt paths in command arguments are preserved
  const exemptCmd = "cat /home/user/project/.pi/quest/future/1xTEST.md";
  const preservedExempt = rewriteBashCommandToWorktree(exemptCmd, worktreePath, primaryRoot);
  check(preservedExempt.includes("/home/user/project/.pi/quest/future/1xTEST.md"), "exempt quest doc path preserved in shell command");
});

Deno.test("proof 3: worktree environment plumbing (node_modules & external symlinks)", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-env-proof-"));
  const primary = join(root, "primary");
  const worktree = join(root, "worktree");
  const outsideTarget = join(root, "outside-lib");

  mkdirSync(primary, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  mkdirSync(outsideTarget, { recursive: true });

  try {
    // 1. Setup primary node_modules (with both 3rd-party and @tty-pt relative link) and external relative symlink
    mkdirSync(join(primary, "node_modules", "@tty-pt"), { recursive: true });
    writeFileSync(join(primary, "node_modules", "package.json"), "{}");
    mkdirSync(join(primary, "external", "libstele", "npm"), { recursive: true });
    symlinkSync("../../external/libstele/npm", join(primary, "node_modules", "@tty-pt", "stele"), "dir");
    writeFileSync(join(outsideTarget, "lib.h"), "// external header");

    mkdirSync(join(primary, "external"), { recursive: true });
    // In primary, ../../outside-lib points to outsideTarget
    symlinkSync(outsideTarget, join(primary, "external", "liboutside"), "dir");

    // In worktree, simulate local external/libstele/npm and a broken relative link that escaped
    mkdirSync(join(worktree, "external", "libstele", "npm"), { recursive: true });
    symlinkSync("../../outside-lib", join(worktree, "external", "liboutside"), "dir");

    // 2. Run setupWorktreeEnvironment
    const envRes = setupWorktreeEnvironment(primary, worktree);
    check(envRes.ok === true, "setupWorktreeEnvironment succeeded");

    // 3. Verify node_modules isolates @tty-pt to worktree while symlinking other entries from primary
    check(existsSync(join(worktree, "node_modules")), "node_modules created in worktree");
    check(!lstatSync(join(worktree, "node_modules")).isSymbolicLink(), "node_modules is a real directory");
    check(lstatSync(join(worktree, "node_modules", "package.json")).isSymbolicLink(), "3rd-party entry is a symlink");
    check(
      realpathSync(join(worktree, "node_modules", "@tty-pt", "stele")) ===
        realpathSync(join(worktree, "external", "libstele", "npm")),
      "@tty-pt/stele resolves to worktree external/libstele/npm instead of primaryRoot",
    );

    // 4. Verify external symlink was rebased and resolves correctly
    check(existsSync(join(worktree, "external", "liboutside")), "external symlink exists");
    const resolvedTarget = realpathSync(join(worktree, "external", "liboutside"));
    check(resolvedTarget === realpathSync(outsideTarget), "external symlink points to resolved target");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

Deno.test("proof 4: subquest subagent delegation emits request with worktree cwd", () => {
  let emittedEvent: string | null = null;
  let emittedPayload: Record<string, unknown> | null = null;

  const mockPi = {
    events: {
      on: () => () => {},
      emit: (event: string, payload: unknown) => {
        emittedEvent = event;
        emittedPayload = payload as Record<string, unknown>;
      },
    },
  } as unknown as Parameters<typeof delegateSubQuestToSubagent>[0]["pi"];

  delegateSubQuestToSubagent({
    pi: mockPi,
    qid: "1xCHILD" as unknown as Qid,
    parentQid: "1xPARENT" as unknown as Qid,
    goal: "Implement sub-feature",
    worktreePath: "/home/user/project/.pi/worktrees/1xCHILD",
    allowedPaths: ["mods/nd/ux/*"],
    requiredTestCommands: ["make test-fast"],
  });

  check(emittedEvent === "prompt-template:subagent:request", "delegation event emitted");
  check(emittedPayload !== null, "payload recorded");
  check(emittedPayload?.["cwd"] === "/home/user/project/.pi/worktrees/1xCHILD", "subagent cwd set to worktreePath");
  check(emittedPayload?.["ownerRunId"] === "1xPARENT", "ownerRunId is parent qid");
  check(emittedPayload?.["nodeId"] === "1xCHILD", "nodeId is child qid");
  const taskStr = typeof emittedPayload?.["task"] === "string" ? (emittedPayload["task"] as string) : "";
  check(taskStr.includes("1xCHILD"), "prompt includes child qid and goal");
});

Deno.test("proof 5: bg_run tool call interception jails command to worktreePath", () => {
  let toolHandler: ((event: unknown, ctx: unknown) => unknown) | null = null;
  const mockPi = {
    on: (eventName: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      if (eventName === "tool_call") {
        toolHandler = handler;
      }
    },
  } as unknown as Parameters<typeof installToolInterception>[0];

  installToolInterception(mockPi);
  check(typeof toolHandler === "function", "tool_call interception installed");

  const wtPath = "/home/user/project/.pi/worktrees/1xBGTEST";
  const draft = createDraft(createQuest("test task", "1xBGTEST"), "thing");
  replaceState({
    ...draft,
    qid: "1xBGTEST" as Qid,
    phase: "implementing",
    worktreePath: wtPath,
    worktreeBranch: "quest/1xBGTEST",
  });

  try {
    const event = {
      toolName: "bg_run",
      input: {
        name: "test daemon",
        command: "deno test --watch",
        isAgent: false,
      },
    };
    const ctx = { cwd: "/home/user/project" };
    toolHandler!(event, ctx);

    check(typeof event.input.command === "string", "command is string");
    check(event.input.command.includes(`cd "${wtPath}"`), "bg_run command was jailed to worktreePath");
    check(event.input.command.includes("deno test --watch"), "preserved inner command");
  } finally {
    replaceState(IDLE_STATE);
  }
});

Deno.test("proof 7: syncHarnessCwd and dynamic scratchesTool description", async () => {
  const { syncHarnessCwd, getPrimaryRoot, resetPrimaryRootCache } = await import("../../src/utils/git/harness-cwd.ts");
  const { scratchesTool } = await import("../../src/surface/tools/scratches.ts");

  const origCwd = process.cwd();
  resetPrimaryRootCache();

  const tracker = { refreshed: false };
  const mockPi = {
    refreshTools: () => {
      tracker.refreshed = true;
    },
  } as unknown as Parameters<typeof scratchesTool>[0];

  const tool = scratchesTool(mockPi);

  // In idle state, no active worktree in description
  replaceState(IDLE_STATE);
  check(!tool.description.includes("[Active worktree:"), "idle description has no active worktree");

  // Create temporary directory to act as scratch slot
  const tempSlot = mkdtempSync(join(tmpdir(), "pi-quest-slot-test-"));

  try {
    // Mount quest with worktree
    replaceState({
      ...IDLE_STATE,
      qid: "1xSLOT" as Qid,
      phase: "implementing",
      worktreePath: tempSlot,
      worktreeBranch: "quest/1xSLOT",
    });

    check(tool.description.includes(`[Active worktree: ${tempSlot}]`), "description reflects active worktree");

    // Sync harness CWD to slot
    syncHarnessCwd(tempSlot, mockPi);
    check(process.cwd() === tempSlot, "process.cwd() synced to tempSlot");
    check(process.env.PI_WORKTREE_PATH === tempSlot, "PI_WORKTREE_PATH set to tempSlot");
    check(Boolean(tracker.refreshed), "refreshTools was invoked on pi");

    // Revert to null (idle)
    tracker.refreshed = false;
    replaceState(IDLE_STATE);
    check(!tool.description.includes("[Active worktree:"), "idle description reverted");

    syncHarnessCwd(null, mockPi);
    check(process.cwd() === getPrimaryRoot(), "process.cwd() restored to primary root");
    check(process.env.PI_WORKTREE_PATH === undefined, "PI_WORKTREE_PATH unset");
    check(Boolean(tracker.refreshed), "refreshTools invoked on restore");
  } finally {
    replaceState(IDLE_STATE);
    syncHarnessCwd(null, mockPi);
    try { process.chdir(origCwd); } catch { /* ignore */ }
    try { rmSync(tempSlot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
