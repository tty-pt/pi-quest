import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { detectTaskHeuristic, evaluateQuestIntent } from "../../src/drafting/judge.ts";
import { detectSubstantiveRequest } from "../../src/drafting/detect.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";
import { replaceState } from "../../src/app/store.ts";
import { IDLE_STATE } from "../../src/domain/quest.ts";

Deno.test("detectTaskHeuristic: recognizes imperative programming directives with code files", () => {
  check(
    detectTaskHeuristic("Please update the parser in song.c to handle UTF-8 characters properly.") === true,
    "imperative verb + .c file recognized",
  );
  check(
    detectTaskHeuristic("We need to implement error handling in src/domain/transitions.ts.") === true,
    "implement + .ts file recognized",
  );
  check(
    detectTaskHeuristic("Can you fix the segfault occurring in the Makefile test target?") === true,
    "fix + segfault + Makefile recognized",
  );
  check(
    detectTaskHeuristic("Refactor the `checkRtmCoverage` function to enforce plan requirements.") === true,
    "refactor + backtick symbol recognized",
  );
});

Deno.test("detectTaskHeuristic: rejects casual conversation and short questions", () => {
  check(
    detectTaskHeuristic("What do you think of this approach?") === false,
    "conversational question rejected",
  );
  check(
    detectTaskHeuristic("Hello there, how are you doing today?") === false,
    "greeting rejected",
  );
  check(
    detectTaskHeuristic("fix bug") === false,
    "short string under 30 chars rejected",
  );
});

Deno.test("detectSubstantiveRequest: opens quest via heuristic fallback when embeddings are offline", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi();
  const ctx = fakeCtx("/tmp");

  const offlineCfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    embedMode: "off",
  };

  const opened = await detectSubstantiveRequest(
    pi,
    ctx,
    "Please update the parser in song.c to handle UTF-8 characters properly.",
    offlineCfg,
  );

  check(opened === true, "quest opened via task heuristic fallback");
});
