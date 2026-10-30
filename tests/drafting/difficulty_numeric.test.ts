import { check } from "../check.ts";
import {
  difficultyLevel,
  difficultyName,
  isDifficultyAtLeast,
} from "../../src/domain/quest.ts";
import {
  evaluateModelRisk,
  calculateReviewNeed,
} from "../../src/policy/effective.ts";
import { bypassesDraftReview } from "../../src/drafting/bypass.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import { fakeCtx } from "../fake-pi.ts";

Deno.test("difficultyLevel and difficultyName map 5 numeric tiers bidirectionally", () => {
  check(difficultyLevel("trivial") === 1, "trivial => 1");
  check(difficultyLevel("minor") === 2, "minor => 2");
  check(difficultyLevel("standard") === 3, "standard => 3");
  check(difficultyLevel("major") === 4, "major => 4");
  check(difficultyLevel("complex") === 5, "complex => 5");

  check(difficultyName(1) === "trivial", "1 => trivial");
  check(difficultyName(2) === "minor", "2 => minor");
  check(difficultyName(3) === "standard", "3 => standard");
  check(difficultyName(4) === "major", "4 => major");
  check(difficultyName(5) === "complex", "5 => complex");

  // Clamping and numeric string tolerance
  check(difficultyLevel(0) === 1, "clamp low to 1");
  check(difficultyLevel(10) === 5, "clamp high to 5");
  check(difficultyLevel("4") === 4, "string '4' => 4");

  // Comparison helpers
  check(isDifficultyAtLeast("major", 4) === true, "major is at least 4");
  check(isDifficultyAtLeast("standard", 4) === false, "standard is not at least 4");
  check(isDifficultyAtLeast("complex", 5) === true, "complex is at least 5");
});

Deno.test("evaluateModelRisk rates model capabilities into risk tiers", () => {
  check(evaluateModelRisk("anthropic/claude-3-5-sonnet") === 1.0, "frontier Claude => 1.0 risk");
  check(evaluateModelRisk("antigravity/gemini-2.5-pro") === 1.0, "frontier Gemini Pro => 1.0 risk");
  check(evaluateModelRisk("antigravity/gemini-3.8-flash") === 1.5, "fast Flash => 1.5 risk");
  check(evaluateModelRisk("openai/gpt-4o-mini") === 1.5, "fast mini => 1.5 risk");
  check(evaluateModelRisk("auren/qwen2.5-0.5b-instruct") === 2.5, "small local model => 2.5 risk");
  check(evaluateModelRisk("auren/llama-3.2-1b") === 2.5, "1B model => 2.5 risk");
  check(evaluateModelRisk(undefined) === 1.5, "unspecified => 1.5 default");
});

Deno.test("calculateReviewNeed scales with difficulty, model risk, and setbacks", () => {
  // Frontier model (risk 1.0):
  // standard task (D = 3) without setbacks => 3.0 (safe for balanced bypass)
  check(calculateReviewNeed("standard", "anthropic/claude-3-5-sonnet", 0) === 3.0, "frontier standard need 3.0");

  // Small 0.5B model (risk 2.5):
  // standard task (D = 3) without setbacks => 7.5 (> 4.5, review required!)
  check(calculateReviewNeed("standard", "auren/qwen2.5-0.5b-instruct", 0) === 7.5, "small model standard need 7.5");

  // Frontier model with 2 setbacks: need jumps from 3.0 to 6.0 (> 4.5, tightens review!)
  check(calculateReviewNeed("standard", "anthropic/claude-3-5-sonnet", 2) === 6.0, "frontier with setbacks need 6.0");
});

Deno.test("bypassesDraftReview dynamically adapts to model risk under balanced policy", () => {
  const balancedCfg = { ...DEFAULT_CONFIG, reviewPolicy: "balanced" as const };
  const baseQuest = createDraft(createQuest("test task", "dyn001"), "dyn001");

  // 1. Frontier model on standard task (D = 3) => bypasses review
  const frontierCtx = Object.assign(fakeCtx("/tmp"), { model: "anthropic/claude-3-5-sonnet" });
  check(bypassesDraftReview(balancedCfg, { ...baseQuest, difficulty: "standard" }, frontierCtx) === true, "frontier standard bypasses");

  // 2. Small 0.5B model on standard task (D = 3) => requires review!
  const smallModelCtx = Object.assign(fakeCtx("/tmp"), { model: "auren/qwen2.5-0.5b-instruct" });
  check(bypassesDraftReview(balancedCfg, { ...baseQuest, difficulty: "standard" }, smallModelCtx) === false, "small model standard requires review");

  // 3. Small model on trivial task (D = 1) => 1 * 2.5 = 2.5 (<= 4.5, can bypass)
  check(bypassesDraftReview(balancedCfg, { ...baseQuest, difficulty: "trivial" }, smallModelCtx) === true, "small model trivial bypasses");

  // 4. Model on standard task with setbacks => requires review!
  const setbackQuest = {
    ...baseQuest,
    difficulty: "standard" as const,
    setbacks: [
      { reason: "test failure", evidence: ["tests failed with exit code 1"] },
      { reason: "regression", evidence: ["build broken"] },
    ],
  };
  check(bypassesDraftReview(balancedCfg, setbackQuest, frontierCtx) === false, "setbacks tighten policy to require review");
});
