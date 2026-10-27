import { check } from "./check.ts";
import { DEFAULT_CONFIG, loadConfig, readQuestConfig, resolveRoleFallbacks, resolveRoleModel } from "../src/config.ts";

Deno.test("config defaults match the spec", () => {
  check(DEFAULT_CONFIG.askTimeoutMs === 60000, "one minute default");
  check(DEFAULT_CONFIG.depthCap === 3, "depth cap 3");
  check(DEFAULT_CONFIG.draftThresholds.requirements === 2, "2 requirements");
  check(DEFAULT_CONFIG.draftThresholds.evidence === 7, "7 evidence");
  check(DEFAULT_CONFIG.bindings.reviewRunner.tool === "subagent", "runner binding");
  check(DEFAULT_CONFIG.statusStyle === "icon", "icon status default");
  check(DEFAULT_CONFIG.reviewPolicy === "strict", "reviewPolicy defaults to strict");
  check(DEFAULT_CONFIG.reviewInactivityMs === 300000, "5 minute inactivity default");
  check(DEFAULT_CONFIG.reviewMaxDurationMs === 1500000, "25 minute max-duration default");
});

Deno.test("config loads partial settings over defaults", () => {
  check(loadConfig(undefined).askTimeoutMs === 60000, "missing settings default");
  check(loadConfig(null).depthCap === 3, "null defaults");
  check(loadConfig(42).depthCap === 3, "non-object defaults");
  const partial = loadConfig({ askTimeoutMs: 5000, draftThresholds: { requirements: 1 } });
  check(partial.askTimeoutMs === 5000, "timeout overridden");
  check(partial.draftThresholds.requirements === 1, "threshold overridden");
  check(partial.draftThresholds.evidence === 7, "sibling threshold kept");
  check(partial.bindings.reviewRunner.tool === "subagent", "bindings kept");
  check(loadConfig({ statusStyle: "text" }).statusStyle === "text", "text style honored");
  check(loadConfig({ statusStyle: "emoji" }).statusStyle === "icon", "invalid style falls back");
  const knobs = loadConfig({ reviewInactivityMs: 5000, reviewMaxDurationMs: 90000 });
  check(knobs.reviewInactivityMs === 5000, "inactivity knob honored");
  check(knobs.reviewMaxDurationMs === 90000, "max-duration knob honored");
  check(loadConfig({ reviewInactivityMs: "nope" }).reviewInactivityMs === 300000, "invalid inactivity defaults");
});

Deno.test("config reads the settings file with fallback", async () => {
  const dir = await Deno.makeTempDir();
  const missing = await readQuestConfig(dir);
  check(missing.askTimeoutMs === 60000, "missing file defaults");
  await Deno.mkdir(`${dir}/.pi`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/.pi/settings.json`,
    JSON.stringify({ "pi-quest": { askTimeoutMs: 5000, bindings: { reviewRunner: { tool: "custom" } } } }),
  );
  const loaded = await readQuestConfig(dir);
  check(loaded.askTimeoutMs === 5000, "file timeout honored");
  check(loaded.bindings.reviewRunner.tool === "custom", "file binding honored");
  check(loaded.depthCap === 3, "absent keys default");
});

Deno.test("config parses reviewPolicy and role models", () => {
  const balanced = loadConfig({ reviewPolicy: "balanced" });
  check(balanced.reviewPolicy === "balanced", "balanced policy honored");

  const off = loadConfig({ reviewPolicy: "off" });
  check(off.reviewPolicy === "off", "off policy honored");

  const invalid = loadConfig({ reviewPolicy: "yolo" });
  check(invalid.reviewPolicy === "strict", "invalid policy defaults to strict");

  const customRoles = loadConfig({
    reviewPolicy: "balanced",
    roles: {
      reviewer: "google/gemini-2.5-flash",
      validator: "google/gemini-2.5-pro",
      judge: "qwen-local",
    },
  });
  check(customRoles.roles.reviewer === "google/gemini-2.5-flash", "reviewer role mapped");
  check(customRoles.roles.validator === "google/gemini-2.5-pro", "validator role mapped");
  check(customRoles.roles.judge === "qwen-local", "judge role mapped");
  check(customRoles.judgeModel === "qwen-local", "judgeModel aligned with roles.judge");
  check(resolveRoleModel(customRoles, "reviewer") === "google/gemini-2.5-flash", "resolveRoleModel reviewer");
  check(resolveRoleModel(customRoles, "validator") === "google/gemini-2.5-pro", "resolveRoleModel validator");
  check(resolveRoleModel(customRoles, "judge") === "qwen-local", "resolveRoleModel judge");
});

Deno.test("config parses midQuest settings cleanly", () => {
  check(DEFAULT_CONFIG.midQuest.mode === "hybrid", "default midQuest mode hybrid");
  check(DEFAULT_CONFIG.midQuest.subquestAction === "queue_backlog", "default subquest action queue_backlog");
  check(DEFAULT_CONFIG.midQuest.autoAmendRequirements === true, "default autoAmendRequirements true");
  check(DEFAULT_CONFIG.midQuest.turnInjection === true, "default turnInjection true");
  check(DEFAULT_CONFIG.midQuest.promptTimeoutMs === 10000, "default prompt timeout 10s");

  const custom = loadConfig({
    midQuest: {
      mode: "autonomous",
      subquestAction: "preempt_now",
      autoAmendRequirements: false,
      turnInjection: false,
      promptTimeoutMs: 5000,
    },
  });
  check(custom.midQuest.mode === "autonomous", "overridden midQuest mode");
  check(custom.midQuest.subquestAction === "preempt_now", "overridden subquestAction");
  check(custom.midQuest.autoAmendRequirements === false, "overridden autoAmendRequirements");
  check(custom.midQuest.turnInjection === false, "overridden turnInjection");
  check(custom.midQuest.promptTimeoutMs === 5000, "overridden promptTimeoutMs");

  const invalid = loadConfig({
    midQuest: {
      mode: "nonsense",
      subquestAction: "invalid",
    },
  });
  check(invalid.midQuest.mode === "hybrid", "fallback on invalid mode");
  check(invalid.midQuest.subquestAction === "queue_backlog", "fallback on invalid subquest action");
});



Deno.test("config parses role fallbacks as string or list", () => {
  const cfg = loadConfig({
    roles: { reviewer: "a/x", reviewerFallback: ["b/y", " ", 3, "c/z"], validatorFallback: "d/w" },
  });
  check(JSON.stringify(cfg.roles.reviewerFallback) === JSON.stringify(["b/y", "c/z"]), "reviewer list sanitized");
  check(JSON.stringify(cfg.roles.validatorFallback) === JSON.stringify(["d/w"]), "single string becomes list");
  check(resolveRoleFallbacks(DEFAULT_CONFIG, "reviewer").length === 0, "absent means none");
});
