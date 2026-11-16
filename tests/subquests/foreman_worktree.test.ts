import { check } from "../check.ts";
import { advanceForeman, createContractForBacklogItem } from "../../src/subquests/foreman.ts";
import { pushStackFrame } from "../../src/domain/stack.ts";
import { createQuest, IDLE_STATE, type QuestState } from "../../src/domain/quest.ts";
import { installToolInterception } from "../../src/surface/tools/handlers/interception.ts";
import { replaceState } from "../../src/app/store.ts";
import type { Pi, PiCtx, ToolCallEvent } from "../../src/hooks/events.ts";
import type { Qid } from "../../src/domain/qid.ts";

const parentQid = "1xPARN" as Qid;
const childQid = "1xCHLD" as Qid;

Deno.test("foreman: propagates worktreePath and worktreeBranch to subquest contract and stack frame", () => {
  const parent = {
    ...createQuest("Parent task", parentQid, null, "complex"),
    phase: "implementing" as const,
    worktreePath: "/home/user/project/.pi/scratch/slot-1",
    worktreeBranch: "quest/1xPARN",
  };

  const planText = `
## Sub-Quests
- [ ] SQ1: First sub-task [paths: src/] [tests: npm test] [req: R1]
  `;

  const advanced = advanceForeman(parent, childQid, planText);
  check(advanced !== null, "advanceForeman returned next item");
  check(advanced?.contract.worktreePath === "/home/user/project/.pi/scratch/slot-1", "contract inherited worktreePath");
  check(advanced?.contract.worktreeBranch === "quest/1xPARN", "contract inherited worktreeBranch");

  check(advanced?.nextMountedState.worktreePath === "/home/user/project/.pi/scratch/slot-1", "mounted child state inherited worktreePath");
  check(advanced?.nextMountedState.worktreeBranch === "quest/1xPARN", "mounted child state inherited worktreeBranch");
});

Deno.test("stack: pushStackFrame falls back to parent worktree when contract worktree is undefined", () => {
  const parent = {
    ...createQuest("Parent task", parentQid, null, "complex"),
    phase: "implementing" as const,
    worktreePath: "/tmp/scratch/slot-2",
    worktreeBranch: "quest/1xPARN",
  };

  const contract = createContractForBacklogItem(
    {
      id: "SQ1",
      goal: "Sub task",
      allowedPaths: ["src/"],
      requiredTestCommands: ["npm test"],
      assignedRequirements: ["R1"],
    },
    parentQid,
    childQid,
  );

  check(contract.worktreePath === undefined, "contract has no worktreePath explicitly set");

  const childState = pushStackFrame(parent, contract, childQid);
  check(childState.worktreePath === "/tmp/scratch/slot-2", "pushStackFrame fell back to parent worktreePath");
  check(childState.worktreeBranch === "quest/1xPARN", "pushStackFrame fell back to parent worktreeBranch");
});

Deno.test("interception: jails subagent cwd to worktreePath", () => {
  let handler: ((event: ToolCallEvent, ctx: PiCtx) => unknown) | null = null;
  const mockPi = {
    on: (evt: string, fn: (event: ToolCallEvent, ctx: PiCtx) => unknown) => {
      if (evt === "tool_call") handler = fn;
    },
  } as unknown as Pi;

  installToolInterception(mockPi);
  check(handler !== null, "handler installed");

  const primaryRoot = "/home/user/project";
  const wtPath = "/home/user/project/.pi/scratch/slot-1";

  replaceState({
    ...IDLE_STATE,
    qid: childQid,
    phase: "implementing",
    worktreePath: wtPath,
    worktreeBranch: "quest/1xPARN",
  });

  const ctx = { cwd: primaryRoot } as PiCtx;

  // Single-child subagent tool call without cwd
  const subagentCall: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call_1",
    toolName: "subagent",
    input: { agent: "worker", task: "do something" },
  };

  handler!(subagentCall, ctx);
  check(subagentCall.input["cwd"] === wtPath, "rewrote missing cwd to worktreePath");

  // Single-child subagent tool call with primaryRoot cwd
  const subagentCallWithPrimary: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call_2",
    toolName: "subagent",
    input: { agent: "worker", task: "do something", cwd: primaryRoot },
  };

  handler!(subagentCallWithPrimary, ctx);
  check(subagentCallWithPrimary.input["cwd"] === wtPath, "rewrote primaryRoot cwd to worktreePath");

  // Parallel workflow subagent tasks
  const workflowCall: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call_3",
    toolName: "subagent",
    input: {
      workflow: "parallel",
      args: {
        tasks: [
          { agent: "w1", task: "t1" },
          { agent: "w2", task: "t2", cwd: primaryRoot },
        ],
      },
    },
  };

  handler!(workflowCall, ctx);
  const tasks = (workflowCall.input["args"] as { tasks: Array<{ cwd?: string }> }).tasks;
  check(tasks[0].cwd === wtPath, "task 1 cwd rewritten to worktreePath");
  check(tasks[1].cwd === wtPath, "task 2 cwd rewritten to worktreePath");
});

Deno.test("interception: enforces contract allowedPaths on write and edit", () => {
  let handler: ((event: ToolCallEvent, ctx: PiCtx) => unknown) | null = null;
  const mockPi = {
    on: (evt: string, fn: (event: ToolCallEvent, ctx: PiCtx) => unknown) => {
      if (evt === "tool_call") handler = fn;
    },
  } as unknown as Pi;

  installToolInterception(mockPi);
  const primaryRoot = "/home/user/project";
  const wtPath = "/home/user/project/.pi/scratch/slot-1";

  replaceState({
    ...IDLE_STATE,
    qid: childQid,
    phase: "implementing",
    worktreePath: wtPath,
    worktreeBranch: "quest/1xPARN",
    contract: {
      qid: childQid,
      parentQid: parentQid,
      title: "Sub task",
      allowedPaths: ["external/libchunk/"],
      assignedRequirements: ["R1"],
      requiredTestCommands: ["make test-fast"],
      acceptanceCriteria: ["done"],
    },
  });

  const ctx = { cwd: primaryRoot } as PiCtx;

  // Attempt write outside allowedPaths
  const outsideCall: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call_out",
    toolName: "write",
    input: { path: "mods/nd/ux/nd_seven.c", content: "// hacked" },
  };

  const blockRes = handler!(outsideCall, ctx) as { block?: boolean; reason?: string } | undefined;
  check(blockRes?.block === true, "blocked file write outside allowedPaths");
  check(Boolean(blockRes?.reason?.includes("outside the declared allowedPaths")), "blocking reason mentions allowedPaths");

  // Attempt write inside allowedPaths
  const insideCall: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call_in",
    toolName: "write",
    input: { path: "external/libchunk/src/chunk.c", content: "// ok" },
  };

  const allowRes = handler!(insideCall, ctx) as { block?: boolean } | undefined;
  check(allowRes?.block !== true, "allowed file write inside allowedPaths");
  check(insideCall.input["path"] === `${wtPath}/external/libchunk/src/chunk.c`, "path rewritten to worktree");

  // Attempt edit outside allowedPaths
  const outsideEditCall: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call_edit_out",
    toolName: "edit",
    input: { path: "mods/nd/ux/nd_seven.c", edits: [] },
  };

  const blockEditRes = handler!(outsideEditCall, ctx) as { block?: boolean; reason?: string } | undefined;
  check(blockEditRes?.block === true, "blocked file edit outside allowedPaths");

  // Attempt write to exempt path (quest future draft)
  const exemptCall: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call_exempt",
    toolName: "write",
    input: { path: ".pi/quest/future/1xCHLD.md", content: "# child quest" },
  };

  const allowExemptRes = handler!(exemptCall, ctx) as { block?: boolean } | undefined;
  check(allowExemptRes?.block !== true, "allowed write to exempt quest path");
  check(exemptCall.input["path"] === ".pi/quest/future/1xCHLD.md", "exempt path not rewritten to worktree");
});
