import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.0";
import {
  isRateLimitOrQuotaError,
  cleanExpiredCooldowns,
  clampThinkingLevel,
  routeRequest,
  type ModelCandidate,
  type ModelRegistryLike,
} from "../../src/router/engine.ts";
import { replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import type { ModelRouteRequest, RouterConfig, RouterState } from "../../src/router/types.ts";

const mockClaude: ModelCandidate = {
  provider: "anthropic",
  id: "claude-sonnet-4-5",
  name: "Claude 3.5 Sonnet",
  reasoning: true,
};

const mockGemini: ModelCandidate = {
  provider: "antigravity",
  id: "gemini-3.8-flash",
  name: "Gemini 3.8 Flash",
  reasoning: true,
};

const mockQwen: ModelCandidate = {
  provider: "auren",
  id: "qwen",
  name: "Qwen 2.5 0.5B",
  reasoning: false,
};

const mockRegistry: ModelRegistryLike = {
  getAvailable: () => [mockClaude, mockGemini, mockQwen],
  find: (provider: string, id: string) => {
    return [mockClaude, mockGemini, mockQwen].find((m) => m.provider === provider && m.id === id);
  },
  hasConfiguredAuth: () => true,
};

const testConfig: RouterConfig = {
  enabled: true,
  provider: "quest",
  id: "auto",
  name: "Quest Auto Router",
  default: "antigravity/gemini-3.8-flash",
  direct: "antigravity/gemini-3.8-flash:low",
  cooldownMs: 600000,
  matrix: {
    drafting: {
      complex: ["anthropic/claude-sonnet-4-5:high", "antigravity/gemini-3.8-flash"],
      "*": "antigravity/gemini-3.8-flash",
    },
    implementing: "antigravity/gemini-3.8-flash",
  },
};

Deno.test("isRateLimitOrQuotaError detects rate limit and quota exhaustion phrases", () => {
  assertEquals(isRateLimitOrQuotaError("429 Too Many Requests"), true);
  assertEquals(isRateLimitOrQuotaError("Rate limit exceeded for provider"), true);
  assertEquals(isRateLimitOrQuotaError("You have exceeded your current quota"), true);
  assertEquals(isRateLimitOrQuotaError("Model is overloaded, try again"), true);
  assertEquals(isRateLimitOrQuotaError("Resource has been exhausted"), true);
  assertEquals(isRateLimitOrQuotaError("SyntaxError: Unexpected token"), false);
  assertEquals(isRateLimitOrQuotaError(undefined), false);
});

Deno.test("cleanExpiredCooldowns prunes timestamps in the past", () => {
  const now = 1000000;
  const cooldowns = {
    "model/active": now + 50000,
    "model/expired": now - 1000,
  };
  const cleaned = cleanExpiredCooldowns(cooldowns, now);
  assertEquals(cleaned, { "model/active": now + 50000 });
});

Deno.test("clampThinkingLevel honors non-reasoning models by returning off", () => {
  // Qwen has reasoning: false -> must always be "off"
  assertEquals(clampThinkingLevel(mockQwen, "high", "high"), "off");
  // Gemini has reasoning: true -> uses spec level or request level
  assertEquals(clampThinkingLevel(mockGemini, "high", "off"), "high");
  assertEquals(clampThinkingLevel(mockGemini, undefined, "medium"), "medium");
});

Deno.test("routeRequest routes direct requests to direct model", async () => {
  const req: ModelRouteRequest<RouterState> = {
    model: null,
    thinkingLevel: "high",
    reason: "direct",
    messages: [],
  };
  const res = await routeRequest(req, { modelRegistry: mockRegistry }, testConfig);
  assertEquals((res.model as ModelCandidate).id, "gemini-3.8-flash");
  assertEquals(res.thinkingLevel, "low");
});

Deno.test("routeRequest maintains sticky continuation on the previous model", async () => {
  const req: ModelRouteRequest<RouterState> = {
    model: null,
    thinkingLevel: "high",
    reason: "continuation",
    previous: {
      model: mockClaude,
      thinkingLevel: "high",
    },
    messages: [],
  };
  const res = await routeRequest(req, { modelRegistry: mockRegistry }, testConfig);
  assertEquals((res.model as ModelCandidate).id, "claude-sonnet-4-5");
  assertEquals(res.thinkingLevel, "high");
});

Deno.test("routeRequest routes drafting complex quest to Claude with high thinking", async () => {
  replaceState(createQuest("Complex architecture feature", "abc123", null, "complex"));
  // Advance state to drafting
  replaceState({ ...IDLE_STATE, phase: "drafting", difficulty: "complex" });

  const req: ModelRouteRequest<RouterState> = {
    model: null,
    thinkingLevel: "medium",
    reason: "user",
    messages: [],
  };
  const res = await routeRequest(req, { modelRegistry: mockRegistry }, testConfig);
  assertEquals((res.model as ModelCandidate).id, "claude-sonnet-4-5");
  assertEquals(res.thinkingLevel, "high");
  assertEquals(res.state?.lastCell?.phase, "drafting");
  assertEquals(res.state?.lastCell?.difficulty, "complex");
});

Deno.test("routeRequest retry after rate limit applies cooldown and falls back to Gemini", async () => {
  replaceState({ ...IDLE_STATE, phase: "drafting", difficulty: "complex" });

  const req: ModelRouteRequest<RouterState> = {
    model: null,
    thinkingLevel: "high",
    reason: "retry",
    failed: {
      model: mockClaude,
      thinkingLevel: "high",
      message: {
        errorMessage: "Provider rate limit reached (429): Quota exceeded for 5 hours",
      },
    },
    messages: [],
  };
  const res = await routeRequest(req, { modelRegistry: mockRegistry }, testConfig);
  // Should have placed Claude on cooldown and routed to Gemini
  assertEquals((res.model as ModelCandidate).id, "gemini-3.8-flash");
  const claudeKey = "anthropic/claude-sonnet-4-5";
  const cooldownUntil = res.state?.cooldowns[claudeKey];
  assertEquals(typeof cooldownUntil === "number" && cooldownUntil > Date.now(), true);

  // Subsequent request in same phase should also skip Claude while on cooldown
  const nextReq: ModelRouteRequest<RouterState> = {
    model: null,
    thinkingLevel: "high",
    reason: "user",
    state: res.state,
    messages: [],
  };
  const nextRes = await routeRequest(nextReq, { modelRegistry: mockRegistry }, testConfig);
  assertEquals((nextRes.model as ModelCandidate).id, "gemini-3.8-flash");
});

Deno.test("routeRequest routes implementing phase to Gemini", async () => {
  replaceState({ ...IDLE_STATE, phase: "implementing", difficulty: "complex" });

  const req: ModelRouteRequest<RouterState> = {
    model: null,
    thinkingLevel: "high",
    reason: "user",
    messages: [],
  };
  const res = await routeRequest(req, { modelRegistry: mockRegistry }, testConfig);
  assertEquals((res.model as ModelCandidate).id, "gemini-3.8-flash");
});
