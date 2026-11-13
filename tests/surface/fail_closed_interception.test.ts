import { assertEquals } from "jsr:@std/assert";
import { installToolInterception } from "../../src/surface/tools/handlers/interception.ts";
import { updateState, getState, replaceState } from "../../src/app/store.ts";
import { IDLE_STATE } from "../../src/domain/quest.ts";
import type { Qid } from "../../src/domain/qid.ts";
import type { Pi, ToolCallEvent } from "../../src/hooks/events.ts";

Deno.test("interception blocks primary repo writes when implementing without worktree", () => {
  replaceState({
    ...IDLE_STATE,
    qid: "test-qid" as Qid,
    phase: "implementing",
    worktreePath: undefined,
  });

  let handler: ((event: ToolCallEvent, ctx: any) => any) | undefined;
  const mockPi: Pi = {
    on: (name: string, fn: any) => {
      if (name === "tool_call") handler = fn;
    },
  } as unknown as Pi;

  installToolInterception(mockPi);
  assertEquals(typeof handler, "function");

  // Call write tool targeting primary repo file
  const event: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call-1",
    toolName: "write",
    input: { path: "mods/nd/ux/nd_seven.c", content: "test" },
  };
  const ctx = { cwd: "/home/quirinpa/site" };

  const verdict = handler!(event, ctx);
  assertEquals(verdict?.block, true);
  assertEquals(verdict?.reason?.includes("CRITICAL SAFETY VIOLATION"), true);

  // Exempt paths like .pi/quest should NOT be blocked
  const exemptEvent: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call-2",
    toolName: "write",
    input: { path: ".pi/quest/future/test.md", content: "test" },
  };
  const exemptVerdict = handler!(exemptEvent, ctx);
  assertEquals(exemptVerdict, undefined);
});
