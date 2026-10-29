import { check } from "../check.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readQuestConfig, resolveRoleFallbacks, resolveRoleModel } from "../../src/config.ts";
import {
  classifyTimeoutLayer,
  isModelResolutionOrProviderError,
  resolveDefaultReviewModel,
  resolveReviewThinking,
  reviewModelCandidates,
  stripThinkingSuffix,
} from "../../src/review/model.ts";
import { fakeCtx } from "../fake-pi.ts";

function clearReviewEnv(): void {
  Deno.env.delete("PI_CRITICAL_REVIEW_MODEL");
  Deno.env.delete("PI_REVIEW_MODEL");
  Deno.env.delete("PI_PROVIDER");
  Deno.env.delete("PI_MODEL");
  Deno.env.delete("PI_REVIEW_THINKING");
  Deno.env.delete("PI_CRITICAL_REVIEW_THINKING");
  Deno.env.delete("PI_CRITICAL_REVIEW_MODEL_FALLBACK");
}

Deno.test("suffix stripping removes only registered thinking levels", () => {
  check(
    stripThinkingSuffix("some/model:high") === "some/model",
    "high stripped",
  );
  check(
    stripThinkingSuffix("some/model:minimal") === "some/model",
    "minimal stripped",
  );
  check(
    stripThinkingSuffix("some/model") === "some/model",
    "bare id untouched",
  );
  check(
    stripThinkingSuffix("owner/name:custom") === "owner/name:custom",
    "unknown suffix kept",
  );
  check(
    stripThinkingSuffix("owner/name") === "owner/name",
    "slash ids untouched",
  );
});

Deno.test("default review model passes explicit env through verbatim", () => {
  clearReviewEnv();
  Deno.env.set("PI_CRITICAL_REVIEW_MODEL", "some/model:high");
  try {
    check(
      resolveDefaultReviewModel() === "some/model:high",
      "explicit env wins verbatim",
    );
  } finally {
    clearReviewEnv();
  }
});

Deno.test("default review model combines the launcher pair verbatim", () => {
  clearReviewEnv();
  Deno.env.set("PI_PROVIDER", "someprovider");
  Deno.env.set("PI_MODEL", "somemodel");
  try {
    check(
      resolveDefaultReviewModel() === "someprovider/somemodel",
      "provider pair joined without remapping",
    );
  } finally {
    clearReviewEnv();
  }
});

Deno.test("default review model reads the context model verbatim", () => {
  clearReviewEnv();
  // The structural ctx carries no model; richer hosts may attach one.
  const objectCtx = { ...fakeCtx("/tmp"), model: { provider: "someprovider", id: "somemodel" } };
  check(
    resolveDefaultReviewModel(objectCtx as never) === "someprovider/somemodel",
    "context object joined",
  );
  const stringCtx = { ...fakeCtx("/tmp"), model: "someprovider/somemodel" };
  check(
    resolveDefaultReviewModel(stringCtx as never) === "someprovider/somemodel",
    "context string kept",
  );
});

Deno.test("default review model is empty without any source", () => {
  clearReviewEnv();
  check(resolveDefaultReviewModel() === "", "empty means inherit");
});

Deno.test("review thinking inherits by default and validates env", () => {
  clearReviewEnv();
  check(resolveReviewThinking() === undefined, "no env means inherit");
  Deno.env.set("PI_REVIEW_THINKING", "off");
  check(resolveReviewThinking() === "off", "explicit level honored");
  Deno.env.set("PI_REVIEW_THINKING", "turbo");
  check(resolveReviewThinking() === undefined, "unknown level ignored");
  Deno.env.delete("PI_REVIEW_THINKING");
  Deno.env.set("PI_CRITICAL_REVIEW_THINKING", "low");
  check(resolveReviewThinking() === "low", "alias honored");
  clearReviewEnv();
});

Deno.test("model errors are recognized for retry", () => {
  check(
    isModelResolutionOrProviderError('Model "some/model:high" not found.'),
    "model not found retries",
  );
  check(isModelResolutionOrProviderError("unknown provider foo"), "unknown provider retries");
  check(
    isModelResolutionOrProviderError("HTTP 403 permission_error: OAuth authentication is currently not allowed (oauth_not_allowed_for_organization)"),
    "auth/permission failure falls back",
  );
  check(isModelResolutionOrProviderError("401 Unauthorized"), "401 falls back");
  check(!isModelResolutionOrProviderError("Subagent delegation failed (error)"), "bridge failure does not retry");
  check(!isModelResolutionOrProviderError("review cancelled: aborted"), "cancel never retries");
});

Deno.test("timeout layers classify provider failures", () => {
  check(classifyTimeoutLayer("rate limit 429") === "provider_model_timeout", "rate limit is provider");
  check(classifyTimeoutLayer("spawn ENOENT") === "child_process_deadline", "spawn is child");
  check(classifyTimeoutLayer("weird hang") === "quest_journal_deadline", "unknown is journal");
});

Deno.test("candidates order target then its stripped variant", () => {
  clearReviewEnv();
  const cands = reviewModelCandidates("some/model:high");
  check(cands.length === 2, "target plus stripped variant");
  check(cands[0].model === "some/model:high", "verbatim target first");
  check(cands[1].model === "some/model", "stripped variant second");
});

Deno.test("candidates keep unsuffixed targets and honor the fallback", () => {
  clearReviewEnv();
  const single = reviewModelCandidates("some/model");
  check(single.length === 1 && single[0].model === "some/model", "no duplicate stripped twin");
  Deno.env.set("PI_CRITICAL_REVIEW_MODEL_FALLBACK", "other/model");
  try {
    const cands = reviewModelCandidates("some/model");
    check(cands.length === 2, "fallback appended");
    check(cands[1].model === "other/model", "fallback second");
  } finally {
    clearReviewEnv();
  }
});

Deno.test("candidates degrade to a single inherit when no target", () => {
  clearReviewEnv();
  const cands = reviewModelCandidates("");
  check(cands.length === 1, "one inherit attempt");
  check(cands[0].model === undefined && cands[0].label === "inherit", "no model field sent");
});

Deno.test("configured fallbacks follow the target, deduped, before the env fallback", () => {
  clearReviewEnv();
  Deno.env.set("PI_CRITICAL_REVIEW_MODEL_FALLBACK", "env/model");
  try {
    const cands = reviewModelCandidates("a/primary:high", ["b/second:low", "a/primary", " "]);
    const models = cands.map((c) => c.model);
    check(
      JSON.stringify(models) === JSON.stringify(["a/primary:high", "a/primary", "b/second:low", "b/second", "env/model"]),
      `ordered chain, got ${JSON.stringify(models)}`,
    );
  } finally {
    clearReviewEnv();
  }
});

Deno.test("overload and capacity errors are retryable provider failures", () => {
  check(isModelResolutionOrProviderError("API overloaded_error 529"), "overloaded retryable");
  check(isModelResolutionOrProviderError("503 no capacity"), "capacity retryable");
  check(!isModelResolutionOrProviderError("reviewer wrote garbage"), "garbage not retryable");
});

Deno.test("settings reviewer role and chain flow into candidate order", async () => {
  clearReviewEnv();
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-reviewer-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({
      "pi-quest": {
        roles: {
          reviewer: ["anthropic/claude-sonnet-5-5:low", "antigravity/claude-sonnet-5-5"],
        },
      },
    }),
  );
  const config = await readQuestConfig(cwd);
  const target = resolveRoleModel(config, "reviewer") ?? "";
  check(target === "anthropic/claude-sonnet-5-5:low", "loader reads roles.reviewer");
  const order = reviewModelCandidates(target, resolveRoleFallbacks(config, "reviewer")).map((c) => c.model);
  check(
    JSON.stringify(order) === JSON.stringify([
      "anthropic/claude-sonnet-5-5:low",
      "anthropic/claude-sonnet-5-5",
      "antigravity/claude-sonnet-5-5",
    ]),
    `candidate order: ${JSON.stringify(order)}`,
  );
});

Deno.test("roles.reviewer array: first is primary, rest is the chain; string stays string", async () => {
  clearReviewEnv();
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-reviewer-arr-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({
      "pi-quest": {
        roles: {
          reviewer: ["anthropic/claude-sonnet-5-5:low", "antigravity/claude-sonnet-5-5", " "],
          validator: "v/one",
        },
      },
    }),
  );
  const config = await readQuestConfig(cwd);
  check(resolveRoleModel(config, "reviewer") === "anthropic/claude-sonnet-5-5:low", "first entry is primary");
  const fb = resolveRoleFallbacks(config, "reviewer");
  check(
    JSON.stringify(fb) === JSON.stringify(["antigravity/claude-sonnet-5-5"]),
    `chain is tail, deduped: ${JSON.stringify(fb)}`,
  );
  check(resolveRoleModel(config, "validator") === "v/one", "string form still works");
  check(resolveRoleFallbacks(config, "validator").length === 0, "string form adds no fallbacks");
});
