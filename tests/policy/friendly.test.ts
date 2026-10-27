// User-friendly configuration: shorthand forms, env vars, warnings, /quest-policy.
import { check } from "../check.ts";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "../../src/config.ts";
import { parsePolicyRules } from "../../src/policy/effective.ts";
import { parseDraftQuality } from "../../src/drafting/quality-config.ts";
import { collectConfigWarnings } from "../../src/policy/warnings.ts";
import { getPolicyStatusLines } from "../../src/surface/commands/policy.ts";
import { installCommands } from "../../src/surface/commands/index.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

Deno.test("parsePolicyRules: env-style 'glob=policy,glob=policy' string", () => {
  const rules = parsePolicyRules("anthropic/*=balanced, *flash*=strict ,bad=nope,=off");
  check(rules.length === 2, `two valid, got ${rules.length}`);
  check(rules[0].pattern === "anthropic/*" && rules[1].policy === "strict", "order and trimming");
});

Deno.test("parsePolicyRules: values are case/space tolerant", () => {
  const rules = parsePolicyRules({ "x/*": " Balanced " });
  check(rules.length === 1 && rules[0].policy === "balanced", "normalised");
});

Deno.test("parseDraftQuality: bare string shorthand sets the mode", () => {
  check(parseDraftQuality("warn").mode === "warn", "warn");
  check(parseDraftQuality("OFF").mode === "off", "case-insensitive");
  check(parseDraftQuality(false).mode === "off", "false disables");
  check(parseDraftQuality(true).mode === "enforce", "true enables");
});

Deno.test("loadConfig: PI_QUEST_POLICY_BY_MODEL / PI_QUEST_DRAFT_QUALITY env fallbacks", () => {
  Deno.env.set("PI_QUEST_POLICY_BY_MODEL", "z/*=off");
  Deno.env.set("PI_QUEST_DRAFT_QUALITY", "warn");
  try {
    const cfg = loadConfig({});
    check(cfg.policyByModel.length === 1 && cfg.policyByModel[0].policy === "off", "env rules");
    check(cfg.draftQuality.mode === "warn", "env mode");
    const settings = loadConfig({ policyByModel: { "s/*": "strict" }, draftQuality: "enforce" });
    check(settings.policyByModel[0].pattern === "s/*" && settings.draftQuality.mode === "enforce", "settings beat env");
  } finally {
    Deno.env.delete("PI_QUEST_POLICY_BY_MODEL");
    Deno.env.delete("PI_QUEST_DRAFT_QUALITY");
  }
});

Deno.test("collectConfigWarnings: clean config has none", () => {
  check(collectConfigWarnings({ reviewPolicy: "balanced", policyByModel: { "a/*": "strict" }, draftQuality: { mode: "warn" } }).length === 0, "none");
  check(collectConfigWarnings(undefined).length === 0, "absent config");
});

Deno.test("collectConfigWarnings: reports invalid values instead of dropping them silently", () => {
  const w = collectConfigWarnings({
    reviewPolicy: "relaxed",
    policyByModel: { "a/*": "chill" },
    draftQuality: { mode: "loud", tiers: { epic: {}, standard: { citations: -1, steps: "many" } } },
  }).join("\n");
  check(w.includes("reviewPolicy") && w.includes("relaxed"), "reviewPolicy");
  check(w.includes("policyByModel") && w.includes("chill"), "policy value");
  check(w.includes("draftQuality.mode") && w.includes("loud"), "mode");
  check(w.includes("epic"), "unknown tier");
  check(w.includes("standard.citations") && w.includes("standard.steps"), "bad tier numbers");
});

Deno.test("collectConfigWarnings: a rule shadowed by an earlier broader rule", () => {
  const w = collectConfigWarnings({ policyByModel: { "anthropic/*": "balanced", "anthropic/claude-opus*": "strict" } }).join("\n");
  check(w.includes("never match") && w.includes("anthropic/claude-opus*"), "shadow reported");
});

Deno.test("/quest-policy: registered and reports model, policy, rule, quality tiers", async () => {
  const pi = fakePi();
  installCommands(pi);
  check(pi.commands.some((c) => c.name === "quest-policy"), "command registered");
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-policy-"));
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({
    "pi-quest": { reviewPolicy: "strict", policyByModel: { "anthropic/*": "balanced" }, draftQuality: { mode: "warn" } },
  }), "utf8");
  const ctx = Object.assign(fakeCtx(cwd), { model: { provider: "anthropic", id: "claude-sonnet-5-5" } });
  const text = (await getPolicyStatusLines(ctx)).join("\n");
  check(text.includes("anthropic/claude-sonnet-5-5"), "active model");
  check(text.includes("balanced") && text.includes('"anthropic/*"'), "effective policy and rule");
  check(text.includes("warn"), "quality mode");
  check(text.includes("standard") && text.includes("complex"), "tier table");
});

Deno.test("/quest-policy: shows warnings and the no-rules hint", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-policy-"));
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ "pi-quest": { reviewPolicy: "bogus" } }), "utf8");
  const text = (await getPolicyStatusLines(fakeCtx(cwd))).join("\n");
  check(text.includes("Config Warnings") && text.includes("bogus"), "warnings listed");
  check(text.includes("policyByModel") && text.includes("no rules"), "hint when no rules");
  check(DEFAULT_CONFIG.policyByModel.length === 0, "defaults untouched");
});
