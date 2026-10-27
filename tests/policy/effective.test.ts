// policyByModel: the review policy follows the model actually doing the work.
import { check } from "../check.ts";
import { DEFAULT_CONFIG, loadConfig } from "../../src/config.ts";
import type { PiCtx } from "../../src/hooks/events.ts";
import {
  effectivePolicy,
  globMatches,
  parsePolicyRules,
  resolveActiveModel,
  withEffectivePolicy,
} from "../../src/policy/effective.ts";
import { recordRoutedModel, resetRoutedModel } from "../../src/router/last-route.ts";

function ctxWith(model: unknown): PiCtx {
  return { cwd: ".", hasUI: false, mode: "test", model } as unknown as PiCtx;
}

Deno.test("globMatches: * wildcard, case-insensitive, anchored", () => {
  check(globMatches("anthropic/claude-sonnet-5*", "anthropic/claude-sonnet-5-5"), "prefix glob");
  check(globMatches("*flash*", "antigravity/Gemini-3.8-Flash"), "case-insensitive infix");
  check(globMatches("*", "anything/at-all"), "bare star");
  check(!globMatches("anthropic/claude-sonnet-5", "anthropic/claude-sonnet-5-5"), "anchored: no implicit suffix");
  check(!globMatches("a.c", "abc"), "dots are literal");
});

Deno.test("parsePolicyRules: ordered, invalid policies dropped", () => {
  const rules = parsePolicyRules({ "a/*": "balanced", "b/*": "nonsense", "*": "strict" });
  check(rules.length === 2, `two valid rules, got ${rules.length}`);
  check(rules[0].pattern === "a/*" && rules[0].policy === "balanced", "first rule kept in order");
  check(parsePolicyRules(undefined).length === 0, "absent -> no rules");
  check(parsePolicyRules("x").length === 0, "non-object -> no rules");
});

Deno.test("loadConfig: policyByModel parsed; default is empty", () => {
  check(DEFAULT_CONFIG.policyByModel.length === 0, "default empty");
  const cfg = loadConfig({ policyByModel: { "x/*": "off" } });
  check(cfg.policyByModel.length === 1 && cfg.policyByModel[0].policy === "off", "parsed from settings");
});

Deno.test("resolveActiveModel: live ctx.model beats env; object and string forms", () => {
  check(resolveActiveModel(ctxWith({ provider: "p", id: "m" }), DEFAULT_CONFIG) === "p/m", "object form");
  check(resolveActiveModel(ctxWith("p/m:high"), DEFAULT_CONFIG) === "p/m", "string form, thinking suffix stripped");
});

Deno.test("resolveActiveModel: quest/auto resolves to the last routed physical model", () => {
  resetRoutedModel();
  try {
    recordRoutedModel("anthropic/claude-sonnet-5-5");
    const model = resolveActiveModel(ctxWith({ provider: "quest", id: "auto" }), DEFAULT_CONFIG);
    check(model === "anthropic/claude-sonnet-5-5", `routed model, got ${model}`);
  } finally {
    resetRoutedModel();
  }
});

Deno.test("effectivePolicy: first matching rule wins, else configured reviewPolicy", () => {
  const cfg = {
    ...DEFAULT_CONFIG,
    reviewPolicy: "strict" as const,
    policyByModel: parsePolicyRules({ "anthropic/claude-sonnet-5*": "balanced", "*flash*": "strict" }),
  };
  const hit = effectivePolicy(cfg, ctxWith({ provider: "anthropic", id: "claude-sonnet-5-5" }));
  check(hit.policy === "balanced", "matched rule");
  check(hit.rule === "anthropic/claude-sonnet-5*", "rule reported");
  check(hit.model === "anthropic/claude-sonnet-5-5", "model reported");
  const miss = effectivePolicy(cfg, ctxWith({ provider: "x", id: "unknown" }));
  check(miss.policy === "strict" && miss.rule === undefined, "fallback to reviewPolicy");
});

Deno.test("effectivePolicy: no rules is a no-op even with no model", () => {
  const res = effectivePolicy({ ...DEFAULT_CONFIG, reviewPolicy: "balanced" }, ctxWith(undefined));
  check(res.policy === "balanced", "configured policy untouched");
});

Deno.test("withEffectivePolicy: returns config with the resolved policy and a note", () => {
  const cfg = { ...DEFAULT_CONFIG, policyByModel: parsePolicyRules({ "p/*": "off" }) };
  const out = withEffectivePolicy(cfg, ctxWith({ provider: "p", id: "m" }));
  check(out.reviewPolicy === "off", "policy replaced");
  check(out.policyNote !== undefined && out.policyNote.includes("p/m"), "note names the model");
  check(withEffectivePolicy(DEFAULT_CONFIG, ctxWith({ provider: "p", id: "m" })) === DEFAULT_CONFIG, "no rules -> same object");
});
