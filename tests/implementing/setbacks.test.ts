import { check } from "../check.ts";
import type { ToolResultEvent } from "../../src/hooks/events.ts";
import { detectSetback } from "../../src/implementing/setbacks.ts";

function bash(command: string, text: string, isError: boolean, details?: unknown): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "1",
    toolName: "bash",
    input: { command },
    content: [{ type: "text", text }],
    isError,
    details,
  };
}

Deno.test("setbacks key on exit status, not on words in the output", () => {
  const hit = detectSetback(bash("deno test", "FAILED foo_test", true));
  check(hit !== null && hit.reason.includes("Test/build"), "test failure recorded");
  check(hit !== null && hit.evidence[0].includes("FAILED"), "evidence kept");
  const nonZero = detectSetback(bash("make -j4", "boom", false, { exitCode: 2 }));
  check(nonZero !== null && nonZero.reason.includes("Test/build"), "non-zero exit code recorded");
  const err = detectSetback(bash("rm -rf dist", "", true));
  check(err !== null && err.reason.includes("Command failed"), "error exit recorded");
});

Deno.test("setbacks never read a passing run as failed (the '0 failed' false positive)", () => {
  check(detectSetback(bash("npm test", "519 passed, 0 failed", false, { exitCode: 0 })) === null, "0 failed is a pass");
  check(detectSetback(bash("npm test | grep failed", "test names containing failed ... ok", false)) === null, "words in output ignored");
  check(detectSetback(bash("make -j4", "4 errors generated.", false)) === null, "output text alone is not a failure");
});

Deno.test("setbacks ignore no-match exit status of search commands", () => {
  check(detectSetback(bash("grep -r foo .", "", true, { exitCode: 1 })) === null, "grep exit 1 ignored");
  check(detectSetback(bash("cat file", "hello", false)) === null, "clean probe ignored");
  check(detectSetback(bash("cat missing", "cat: missing: No such file", true, { exitCode: 1 })) !== null, "cat exit 1 is a real error");
  check(detectSetback(bash("grep foo x", "grep: x: error", true, { exitCode: 2 })) !== null, "grep exit 2 is a real error");
});

Deno.test("setbacks catch failed file writes and ignore the rest", () => {
  const write: ToolResultEvent = {
    type: "tool_result",
    toolCallId: "2",
    toolName: "write",
    input: { path: "x" },
    content: [{ type: "text", text: "denied" }],
    isError: true,
  };
  check(detectSetback(write) !== null, "write error recorded");
  const read: ToolResultEvent = { ...write, toolName: "read", isError: true };
  check(detectSetback(read) === null, "read errors ignored");
  const quest: ToolResultEvent = { ...write, toolName: "quest_update_state" };
  check(detectSetback(quest) === null, "quest tools ignored");
});
