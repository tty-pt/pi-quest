import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { loadConfig, loadRouterConfig, DEFAULT_ROUTER_CONFIG } from "../../src/config.ts";
import { parseModelSpec, normalizeModelSpecs, resolveMatrixCell, validateMatrixConfig } from "../../src/router/matrix.ts";

Deno.test("router config — parses defaults when router section is absent", () => {
  const cfg = loadRouterConfig({});
  assertEquals(cfg.enabled, false);
  assertEquals(cfg.provider, "quest");
  assertEquals(cfg.id, "auto");
  assertEquals(cfg.name, "Quest Auto Router");
  assertEquals(cfg.default, "antigravity/gemini-3.8-flash");
  assertEquals(cfg.direct, "antigravity/gemini-3.8-flash");
  assertEquals(cfg.cooldownMs, 900000);
  assertEquals(cfg.matrix, {});
});

Deno.test("router config — enables router automatically when non-empty matrix is supplied", () => {
  const cfg = loadRouterConfig({
    router: {
      matrix: {
        drafting: "anthropic/claude-sonnet-4-5",
      },
    },
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.matrix, { drafting: "anthropic/claude-sonnet-4-5" });
});

Deno.test("router config — explicit enabled=false overrides matrix presence", () => {
  const cfg = loadRouterConfig({
    router: {
      enabled: false,
      matrix: {
        drafting: "anthropic/claude-sonnet-4-5",
      },
    },
  });
  assertEquals(cfg.enabled, false);
});

Deno.test("router config — parses custom router parameters and cooldown", () => {
  const cfg = loadRouterConfig({
    router: {
      enabled: true,
      provider: "my-router",
      id: "smart",
      name: "Smart Phased Router",
      default: ["antigravity/gemini-3.8-flash", "kilo/kilo-auto/free"],
      direct: "antigravity/gemini-3.8-flash:low",
      cooldownMs: 600000,
    },
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.provider, "my-router");
  assertEquals(cfg.id, "smart");
  assertEquals(cfg.name, "Smart Phased Router");
  assertEquals(cfg.default, ["antigravity/gemini-3.8-flash", "kilo/kilo-auto/free"]);
  assertEquals(cfg.direct, "antigravity/gemini-3.8-flash:low");
  assertEquals(cfg.cooldownMs, 600000);
});

Deno.test("router config — integrated into full loadConfig", () => {
  const full = loadConfig({
    router: {
      enabled: true,
      id: "custom",
    },
  });
  assertEquals(full.router.enabled, true);
  assertEquals(full.router.id, "custom");
});

Deno.test("parseModelSpec — parses provider, id, and thinkingLevel", () => {
  assertEquals(parseModelSpec("anthropic/claude-sonnet-4-5:high"), {
    raw: "anthropic/claude-sonnet-4-5:high",
    provider: "anthropic",
    id: "claude-sonnet-4-5",
    thinkingLevel: "high",
  });

  assertEquals(parseModelSpec("antigravity/gemini-3.8-flash"), {
    raw: "antigravity/gemini-3.8-flash",
    provider: "antigravity",
    id: "gemini-3.8-flash",
    thinkingLevel: undefined,
  });

  assertEquals(parseModelSpec("qwen:off"), {
    raw: "qwen:off",
    provider: "",
    id: "qwen",
    thinkingLevel: "off",
  });

  assertEquals(parseModelSpec("claude-sonnet-4-5"), {
    raw: "claude-sonnet-4-5",
    provider: "",
    id: "claude-sonnet-4-5",
    thinkingLevel: undefined,
  });
});

Deno.test("normalizeModelSpecs — converts string and array specs to string[]", () => {
  assertEquals(normalizeModelSpecs("model1"), ["model1"]);
  assertEquals(normalizeModelSpecs(["model1", "  model2  ", ""]), ["model1", "model2"]);
  assertEquals(normalizeModelSpecs(undefined), []);
});

Deno.test("resolveMatrixCell — cascades through exact, wildcards, and defaults", () => {
  const matrix = {
    drafting: {
      complex: ["anthropic/claude-sonnet-4-5:high", "antigravity/gemini-3.8-flash"],
      "*": "antigravity/gemini-3.8-flash",
    },
    implementing: "antigravity/gemini-3.8-flash",
    "*": {
      trivial: "auren/qwen",
      "*": "kilo/kilo-auto/free",
    },
  };
  const fallback = "default/model";

  // 1. Exact match
  assertEquals(
    resolveMatrixCell(matrix, "drafting", "complex", fallback),
    ["anthropic/claude-sonnet-4-5:high", "antigravity/gemini-3.8-flash"],
  );

  // 2. Phase-specific wildcard
  assertEquals(
    resolveMatrixCell(matrix, "drafting", "standard", fallback),
    ["antigravity/gemini-3.8-flash"],
  );

  // 3. Flat string phase entry
  assertEquals(
    resolveMatrixCell(matrix, "implementing", "complex", fallback),
    ["antigravity/gemini-3.8-flash"],
  );

  // 4. Wildcard phase, specific difficulty
  assertEquals(
    resolveMatrixCell(matrix, "validating", "trivial", fallback),
    ["auren/qwen"],
  );

  // 5. Wildcard phase, wildcard difficulty
  assertEquals(
    resolveMatrixCell(matrix, "validating", "standard", fallback),
    ["kilo/kilo-auto/free"],
  );

  // 6. Completely empty matrix falls back to default
  assertEquals(
    resolveMatrixCell({}, "drafting", "complex", fallback),
    ["default/model"],
  );
});

Deno.test("validateMatrixConfig — detects unrecognized phases and difficulties", () => {
  const valid = validateMatrixConfig({
    drafting: { complex: "model1", "*": "model2" },
    implementing: "model3",
    "*": { trivial: "model4" },
  });
  assertEquals(valid.valid, true);
  assertEquals(valid.warnings.length, 0);

  const invalid = validateMatrixConfig({
    invalidPhase: { complex: "model1" },
    drafting: { unknownDiff: "model2" },
  });
  assertEquals(invalid.valid, false);
  assertEquals(invalid.warnings.length, 2);
});
