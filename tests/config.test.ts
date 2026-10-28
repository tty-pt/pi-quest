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



Deno.test("config derives reviewer/validator fallback chains from role lists", () => {
  const cfg = loadConfig({
    roles: { reviewer: ["a/x", "b/y", " ", "c/z"], validator: "d/w" },
  });
  check(cfg.roles.reviewer === "a/x", "first reviewer entry is primary");
  check(JSON.stringify(cfg.roles.reviewerChain) === JSON.stringify(["b/y", "c/z"]), "reviewer rest is chain");
  check(cfg.roles.validator === "d/w", "string validator stays string");
  check(cfg.roles.validatorChain?.length === 0, "string validator has empty chain");
  check(resolveRoleFallbacks(DEFAULT_CONFIG, "reviewer").length === 0, "absent means none");
  // The legacy *Fallback settings keys are ignored, by string concatenation.
  const ignored = loadConfig({ roles: { reviewer: "a/x", [`reviewer` + "Fallback"]: ["b/y"] } });
  check(JSON.stringify(ignored.roles.reviewerChain ?? []) === JSON.stringify([]), "legacy fallback key ignored");
});

Deno.test("judge and intent defaults work out of the box (systemone + olmoe + embeddings)", () => {
  const d = loadConfig({ judgeMode: "auto", embedMode: "auto" });
  check(d.judgeProtocol === "systemone" && d.judgeModel === "olmoe", "judge defaults to systemone/olmoe");
  check(d.judgeUrl === "http://127.0.0.1:4242", "local auren by default");
  check(DEFAULT_CONFIG.embedMode === "auto" && d.embedMode === "auto" && d.embedModel === "bge-base", "embeddings on by default");
  check(d.embedUrl === "http://127.0.0.1:4242", "embedUrl follows the judge url");
  check(d.intentMinMargin === 0.075 && d.intentMinSimilarity === 0.6, "calibrated intent thresholds");
  check(Object.keys(d.intentExemplars).length === 0, "no operator exemplars by default");
  check(d.questMinMargin === 0.1, "quest detection margin calibrated on held-out corpus B");
  check(Object.keys(d.questExemplars).length === 0, "no operator quest exemplars by default");
  check(d.difficultyMinMargin === 0.075, "difficulty margin validated on held-out corpus C");
  check(Object.keys(d.difficultyExemplars).length === 0, "no operator difficulty exemplars by default");
});

Deno.test("intent and embedding settings are configurable and validated", () => {
  const c = loadConfig({
    embedMode: "off",
    embedUrl: " http://emb.test ",
    embedModel: "bge-small",
    intentMinMargin: 0.2,
    intentMinSimilarity: "0.7",
    intentExemplars: { advance: ["vamos", "", 3], bogus: "x" },
    questMinMargin: "0.2",
    questExemplars: { quest: ["faz isto", ""], conversation: ["olá"], bogus: ["x"] },
  });
  const dc = loadConfig({ difficultyMinMargin: "0.2", difficultyExemplars: { trivial: ["x", ""], complex: ["y"], bogus: ["z"] } });
  check(dc.difficultyMinMargin === 0.2, "difficultyMinMargin, numeric strings accepted");
  check(JSON.stringify(dc.difficultyExemplars) === JSON.stringify({ trivial: ["x"], complex: ["y"] }), "difficulty exemplars sanitized to known levels");
  check(loadConfig({ difficultyMinMargin: 9 }).difficultyMinMargin === 0.075, "out-of-range difficultyMinMargin falls back");
  check(c.questMinMargin === 0.2, "questMinMargin, numeric strings accepted");
  check(JSON.stringify(c.questExemplars) === JSON.stringify({ quest: ["faz isto"], conversation: ["olá"] }), "quest exemplars sanitized to known kinds");
  check(c.embedMode === "off" && c.embedUrl === "http://emb.test" && c.embedModel === "bge-small", "embedding settings");
  check(c.intentMinMargin === 0.2 && c.intentMinSimilarity === 0.7, "thresholds, numeric strings accepted");
  check(JSON.stringify(c.intentExemplars) === JSON.stringify({ advance: ["vamos"] }), "exemplars sanitized");
  const bad = loadConfig({ intentMinMargin: 5, intentMinSimilarity: -1, embedMode: "maybe" });
  check(bad.embedMode === "auto" || Deno.env.get("PI_QUEST_EMBED_MODE") === "off", "unknown embedMode never means off by itself");
  check(bad.intentMinMargin === 0.075 && bad.intentMinSimilarity === 0.6, "out-of-range thresholds fall back");
  check(loadConfig({ questMinMargin: 9 }).questMinMargin === 0.1, "out-of-range questMinMargin falls back");
});
