import assert from "node:assert";
import {
  isFallbackAdvance,
  parseLeadingAdvance,
  interpretUserTurn,
  FALLBACK_ADVANCE_WORD,
} from "../../src/domain/intent.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";

Deno.test("intent_compound: isFallbackAdvance recognizes single fallback word and extra phrases", () => {
  assert.strictEqual(FALLBACK_ADVANCE_WORD, "go");
  assert.strictEqual(isFallbackAdvance("go"), true);
  assert.strictEqual(isFallbackAdvance("GO!"), true);
  assert.strictEqual(isFallbackAdvance("go."), true);

  // Extra phrases
  assert.strictEqual(isFallbackAdvance("bora", ["bora"]), true);
  assert.strictEqual(isFallbackAdvance("proceed", ["proceed"]), true);

  // Non-advance phrases
  assert.strictEqual(isFallbackAdvance("edit user.c"), false);
  assert.strictEqual(isFallbackAdvance("what is this?"), false);
});

Deno.test("intent_compound: parseLeadingAdvance extracts leading advance and trailing directive", () => {
  // Pure advance
  const pure = parseLeadingAdvance("go");
  assert.strictEqual(pure.isAdvance, true);
  assert.strictEqual(pure.remainder, "");

  // Compound with period
  const compound1 = parseLeadingAdvance("go. Make sure to also update the docs.");
  assert.strictEqual(compound1.isAdvance, true);
  assert.strictEqual(compound1.remainder, "Make sure to also update the docs.");

  // Compound with extra phrases
  const compound2 = parseLeadingAdvance("proceed, and make sure to run all tests", ["proceed"]);
  assert.strictEqual(compound2.isAdvance, true);
  assert.strictEqual(compound2.remainder, "make sure to run all tests");

  const compound3 = parseLeadingAdvance("bora! roda o linter também", ["bora"]);
  assert.strictEqual(compound3.isAdvance, true);
  assert.strictEqual(compound3.remainder, "roda o linter também");

  // Negation guards
  const neg1 = parseLeadingAdvance("don't go yet");
  assert.strictEqual(neg1.isAdvance, false);

  const neg2 = parseLeadingAdvance("do not proceed with this change", ["proceed"]);
  assert.strictEqual(neg2.isAdvance, false);

  const neg3 = parseLeadingAdvance("não avance agora", ["avance"]);
  assert.strictEqual(neg3.isAdvance, false);
});

Deno.test("intent_compound: interpretUserTurn advances and captures compound trailing directive", async () => {
  const cfg = {
    ...DEFAULT_CONFIG,
    embedMode: "off" as const,
  };

  const intent = await interpretUserTurn("go. Make sure to also update the docs.", "drafting", cfg);
  assert.strictEqual(intent.kind, "advance");
  assert.strictEqual(intent.cleanText, "Make sure to also update the docs.");
  assert.strictEqual(intent.source, "fallback");
});
