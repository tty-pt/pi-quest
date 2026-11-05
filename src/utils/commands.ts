// HIGH_LEVEL: #validation — recognizing test/build runner invocations by their
// tokens (program name + subcommand), never by a word appearing anywhere in the
// command line ("git commit -m 'make it work'" is not a build).
import type { SubQuestContract } from "../domain/contract";

const RUNNERS_ANY = new Set(["make", "pytest", "jest", "vitest", "tsc", "ctest"]);
const RUNNERS_WITH_SUBCOMMAND: Record<string, string> = {
  npm: "test",
  pnpm: "test",
  yarn: "test",
  bun: "test",
  cargo: "test",
  deno: "test",
  go: "test",
  node: "--test",
};
const TEST_SCRIPT_BASENAMES = new Set(["test", "test.sh", "run-tests.sh", "run-test.sh", "verify.sh", "test.py", "test.js", "test.mjs"]);
const WRAPPERS = new Set(["sudo", "time", "env", "nice", "npx", "exec", "command"]);

function basename(token: string): string {
  const i = token.lastIndexOf("/");
  return i >= 0 ? token.slice(i + 1) : token;
}

function segmentTokens(segment: string): string[] {
  const tokens = segment.replace(/^[\s(]+/, "").split(/\s+/).filter((t) => t !== "");
  while (tokens.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]) || WRAPPERS.has(tokens[0]))) tokens.shift();
  return tokens;
}

function isRunnerSegment(segment: string, extra: readonly string[]): boolean {
  const tokens = segmentTokens(segment);
  if (tokens.length === 0) return false;
  const joined = tokens.join(" ");
  if (extra.some((e) => e.trim() !== "" && joined.startsWith(e.trim()))) return true;
  const program = basename(tokens[0]);
  if (RUNNERS_ANY.has(program)) return true;
  const sub = RUNNERS_WITH_SUBCOMMAND[program];
  if (sub !== undefined && tokens.slice(1).includes(sub)) return true;
  if ((program === "python" || program === "python3") && tokens.includes("-m") && (tokens.includes("unittest") || tokens.includes("pytest"))) return true;
  // "./test", "bash test.sh", "sh ./test.sh", "./run-tests.sh", etc.
  return tokens.some((t, i) => (i === 0 || program === "bash" || program === "sh" || program === "python" || program === "node") && TEST_SCRIPT_BASENAMES.has(basename(t)));
}

export function isTestCommand(
  command: string,
  contract?: SubQuestContract,
  extraRunners: readonly string[] = [],
): boolean {
  if (contract?.requiredTestCommands && contract.requiredTestCommands.length > 0) {
    for (const req of contract.requiredTestCommands) {
      if (req.trim() && command.trim().includes(req.trim())) return true;
    }
  }
  return command.split(/&&|\|\||;|\|/).some((seg) => isRunnerSegment(seg, extraRunners));
}
