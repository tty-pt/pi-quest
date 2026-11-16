// Held-out live evaluation of invariant classification and referential activation
// resolution against a running axil-auren (`POST /v1/systemone`, default http://127.0.0.1:4242):
//   PI_QUEST_EVAL_JUDGE=1 deno test --allow-all --sloppy-imports tests/eval/invariant-referential-eval.test.ts
import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { DEFAULT_INTENT_EXEMPLARS } from "../../src/domain/intent-exemplars.ts";
import {
  isReferentialActivationObjective,
  resolvePriorConversationObjective,
} from "../../src/durability/transcript.ts";
import { clearIntentMemo } from "../../src/judge/intent-classifier.ts";
import {
  classifyInvariantByEmbedding,
  INVARIANT_EXEMPLARS,
} from "../../src/surface/invariants.ts";
import { fakeCtx } from "../fake-pi.ts";
import { type Case, evaluateStrategy, formatReport, serverInfo, type Strategy } from "./harness.ts";

const LIVE = Deno.env.get("PI_QUEST_EVAL_JUDGE") === "1";
const URL_ = Deno.env.get("PI_QUEST_EVAL_URL") ?? "http://127.0.0.1:4242";

/**
 * Held-out invariant corpus (32 cases: 16 standing_invariant, 16 transient_or_invalid).
 * Bilingual (EN + PT) and strictly disjoint from INVARIANT_EXEMPLARS.
 */
export const INVARIANT_EVAL_CORPUS: Case[] = [
  // Standing invariants (16)
  { text: "Pure-C isomorphic UX: no #ifdef or engine symbols in mods/*/ux/", want: "standing_invariant" },
  { text: "Accent-sensitive search (pão ≠ pao), never strip diacritics", want: "standing_invariant" },
  { text: "Never compliment yourself or use self-flattery when asked for metrics.", want: "standing_invariant" },
  { text: "Minimize and eliminate regex usage across the system; rely on semantic classification.", want: "standing_invariant" },
  { text: "All row writes must go through source_update_item or source_delete_item, never direct var/.", want: "standing_invariant" },
  { text: "Every cross-.so boundary must use XY_DECL and XY_IMPL with the two-header rule.", want: "standing_invariant" },
  { text: "Do not add site-specific identifiers or module names to client JavaScript in htdocs/.", want: "standing_invariant" },
  { text: "Always verify standalone C libraries with unit tests before wiring them into modules.", want: "standing_invariant" },
  { text: "Never run make test for a single-module change; use targeted Tier 0 verification.", want: "standing_invariant" },
  { text: "Keep every TypeScript file under 350 lines and every function under 80 lines.", want: "standing_invariant" },
  { text: "Do not use extern globals across C modules; keep state static within the owning module.", want: "standing_invariant" },
  { text: "Always preserve existing docstrings and comments that are unrelated to your code changes.", want: "standing_invariant" },
  { text: "Regra de arquitetura: todos os módulos UX devem compilar tanto para SSR nativo quanto para WASM.", want: "standing_invariant" },
  { text: "Nunca escreva diretamente no diretório var/ sem passar pela API de persistência.", want: "standing_invariant" },
  { text: "Diretriz: mantenha o JavaScript do cliente estritamente genérico, sem lógica de domínio.", want: "standing_invariant" },
  { text: "Sempre crie testes unitários isolados para cada abstração antes da integração.", want: "standing_invariant" },

  // Transient or invalid statements (16)
  { text: "Just commit. We can work on tests later.", want: "transient_or_invalid" },
  { text: "Skip tests for now and commit", want: "transient_or_invalid" },
  { text: "Make sure everything is committed and pushed as part of this wip commit thing.", want: "transient_or_invalid" },
  { text: "Make sure the nd work is committed.", want: "transient_or_invalid" },
  { text: "Push a quick WIP commit now and we will fix the broken tests tonight.", want: "transient_or_invalid" },
  { text: "Ignore the failing unit test for now and commit the current files.", want: "transient_or_invalid" },
  { text: "Just stage everything and make a temporary checkpoint commit.", want: "transient_or_invalid" },
  { text: "Don't run the test suite right now, just commit and push to the branch.", want: "transient_or_invalid" },
  { text: "Judging by the introduced clever preprocessor guards, the wasm boundary is not totally unified. Correct? This is an analysis request. Nothing else.", want: "transient_or_invalid" },
  { text: "And our site, which is pure C, should work without those clever precompiler guards? Understood?", want: "transient_or_invalid" },
  { text: "How unified is this boundary right now across all the libs?", want: "transient_or_invalid" },
  { text: "Can you check git status and tell me which files are untracked?", want: "transient_or_invalid" },
  { text: "Why did the last build fail on the shader compiler?", want: "transient_or_invalid" },
  { text: "Faz o commit disso tudo agora como WIP e depois corrigimos os testes.", want: "transient_or_invalid" },
  { text: "Pula os testes por enquanto e faz logo o commit e push.", want: "transient_or_invalid" },
  { text: "Como funciona a fronteira WASM neste módulo?", want: "transient_or_invalid" },
];

/**
 * Held-out referential activation vs concrete task objective corpus (30 cases).
 * Bilingual (EN + PT) and strictly disjoint from DEFAULT_STEERING_PHRASES and DEFAULT_INTENT_EXEMPLARS.
 */
export const REFERENTIAL_EVAL_CORPUS: Case[] = [
  // Unseen referential activation phrases (15) -> should extract prior conversation objective ("referential")
  { text: "Yes please, go right ahead with that plan.", want: "referential" },
  { text: "Sounds solid, let's roll with it.", want: "referential" },
  { text: "That plan looks great, please proceed.", want: "referential" },
  { text: "You have the green light, go ahead and start.", want: "referential" },
  { text: "Agreed, carry on with those changes.", want: "referential" },
  { text: "All good from my side, ship that.", want: "referential" },
  { text: "Looks good, go ahead and make the edits.", want: "referential" },
  { text: "Works for me, please continue with the implementation.", want: "referential" },
  { text: "Perfect, let's get started on that.", want: "referential" },
  { text: "Okay, go ahead and execute those steps.", want: "referential" },
  { text: "Fine by me, proceed with that approach.", want: "referential" },
  { text: "Perfeito, pode seguir em frente com esse plano.", want: "referential" },
  { text: "Parece ótimo, vamos avançar com isso.", want: "referential" },
  { text: "De acordo, pode começar a implementar.", want: "referential" },
  { text: "Tudo certo por mim, manda ver.", want: "referential" },

  // Concrete self-contained task objectives (15) -> should keep own objective ("concrete")
  { text: "Refactor the WebGL shader compiler in external/liblamina to cache uniform locations.", want: "concrete" },
  { text: "Fix the off-by-one buffer overflow in mods/song/song.c when parsing MPFD headers.", want: "concrete" },
  { text: "Add unit tests for accent-sensitive search in external/libhyle/tests/.", want: "concrete" },
  { text: "Remove the deprecated cormd TCP fallback from pi-mm and use N-API directly.", want: "concrete" },
  { text: "Update /quest doctor in src/surface/commands/doctor.ts to omit C storage engines.", want: "concrete" },
  { text: "Implement shallow water Beer-Lambert absorption in the NeverDark Seven terrain shader.", want: "concrete" },
  { text: "Audit mods/gig/ux/gig.c to ensure zero backend symbols or preprocessor branches exist.", want: "concrete" },
  { text: "Wire libislet Morton Z-order spatial indexing into the 2.5D chunk loader.", want: "concrete" },
  { text: "Fix the race condition in worktree slot lease recovery when a process exits uncleanly.", want: "concrete" },
  { text: "Add a CLI flag to axil-auren to dump embedding cache hit/miss statistics.", want: "concrete" },
  { text: "Migrate mods/poem/poem.c to use source_update_item instead of raw file writes.", want: "concrete" },
  { text: "Write a regression test for UTF-8 multibyte truncation in session transcript recall.", want: "concrete" },
  { text: "Corrige o vazamento de memória no parser de JSON em external/libhyle.", want: "concrete" },
  { text: "Adiciona testes unitários para a validação de fronteira WASM em scripts/check-wasm-imports.sh.", want: "concrete" },
  { text: "Refatora o carregador de módulos XY para validar dependências cíclicas no arranque.", want: "concrete" },
];

Deno.test("invariant eval corpus is balanced, bilingual, and strictly disjoint from INVARIANT_EXEMPLARS", () => {
  check(INVARIANT_EVAL_CORPUS.length >= 30, `>= 30 cases, got ${INVARIANT_EVAL_CORPUS.length}`);
  const standing = INVARIANT_EVAL_CORPUS.filter((c) => c.want === "standing_invariant").length;
  const invalid = INVARIANT_EVAL_CORPUS.filter((c) => c.want === "transient_or_invalid").length;
  check(standing >= 15 && invalid >= 15, `balanced labels (${standing} standing, ${invalid} invalid)`);
  check(new Set(INVARIANT_EVAL_CORPUS.map((c) => c.text.toLowerCase())).size === INVARIANT_EVAL_CORPUS.length, "no duplicate cases");

  const exemplars = new Set(Object.values(INVARIANT_EXEMPLARS).flat().map((t) => t.toLowerCase()));
  for (const c of INVARIANT_EVAL_CORPUS) {
    check(!exemplars.has(c.text.toLowerCase()), `corpus case overlaps INVARIANT_EXEMPLARS: ${c.text}`);
  }
});

Deno.test("referential eval corpus is balanced, bilingual, and strictly disjoint from DEFAULT_INTENT_EXEMPLARS", () => {
  check(REFERENTIAL_EVAL_CORPUS.length >= 30, `>= 30 cases, got ${REFERENTIAL_EVAL_CORPUS.length}`);
  const refCount = REFERENTIAL_EVAL_CORPUS.filter((c) => c.want === "referential").length;
  const concCount = REFERENTIAL_EVAL_CORPUS.filter((c) => c.want === "concrete").length;
  check(refCount >= 15 && concCount >= 15, `balanced labels (${refCount} referential, ${concCount} concrete)`);
  check(new Set(REFERENTIAL_EVAL_CORPUS.map((c) => c.text.toLowerCase())).size === REFERENTIAL_EVAL_CORPUS.length, "no duplicate cases");

  const known = new Set(
    Object.values(DEFAULT_INTENT_EXEMPLARS).flat().map((t) => t.toLowerCase()),
  );
  for (const c of REFERENTIAL_EVAL_CORPUS) {
    check(!known.has(c.text.toLowerCase()), `corpus case overlaps DEFAULT_INTENT_EXEMPLARS: ${c.text}`);
    check(
      !isReferentialActivationObjective(c.text),
      `unseen corpus case must not match synchronous fallback phrase list: ${c.text}`,
    );
  }
});

Deno.test({
  name: "live: classifyInvariantByEmbedding on held-out corpus via axil-auren",
  ignore: !LIVE,
  fn: async () => {
    const { clearEmbedState } = await import("../../src/judge/embed.ts");
    const { mergeExemplars, nearestExemplar } = await import("../../src/judge/nearest.ts");
    clearEmbedState();
    const cfg: QuestConfig = {
      ...DEFAULT_CONFIG,
      judgeMode: "auto",
      embedMode: "auto",
      judgeUrl: URL_,
      embedUrl: URL_,
      judgeProtocol: "systemone",
      judgeTimeoutMs: 5000,
    };
    const strategy: Strategy = {
      name: `invariant-embeddings(${cfg.embedModel})`,
      warmup: async () => {
        clearEmbedState();
        await nearestExemplar({ ...cfg, judgeTimeoutMs: 15000 }, mergeExemplars(INVARIANT_EXEMPLARS, {}), "warmup");
        clearEmbedState();
      },
      classify: async (text) => {
        const isStanding = await classifyInvariantByEmbedding(text, cfg);
        return isStanding ? "standing_invariant" : "transient_or_invalid";
      },
    };
    console.log(await serverInfo(cfg));
    const report = await evaluateStrategy(strategy, INVARIANT_EVAL_CORPUS, {
      stateChanging: new Set(["standing_invariant"]),
    });
    console.log(formatReport("invariant-seeding", report));
    check(report.unavailable === 0, `${report.unavailable} unavailable answers`);
    check(report.falsePositives === 0, `expected 0 false standing invariants, got ${report.falsePositives}`);
    check(report.accuracy >= 0.9, `expected >= 90% accuracy, got ${(report.accuracy * 100).toFixed(1)}%`);
  },
});

Deno.test({
  name: "live: resolvePriorConversationObjective on held-out unseen referential vs concrete corpus via axil-auren",
  ignore: !LIVE,
  fn: async () => {
    const { clearEmbedState } = await import("../../src/judge/embed.ts");
    const { mergedExemplars } = await import("../../src/judge/intent-classifier.ts");
    const { nearestExemplar } = await import("../../src/judge/nearest.ts");
    clearEmbedState();
    const cfg: QuestConfig = {
      ...DEFAULT_CONFIG,
      judgeMode: "auto",
      embedMode: "auto",
      judgeUrl: URL_,
      embedUrl: URL_,
      judgeProtocol: "systemone",
      judgeTimeoutMs: 5000,
    };
    const priorGoal = "PRIOR_GOAL_MARKER: Implement lock-free ring buffer in external/libaxil.";
    const ctx = fakeCtx("/tmp", [
      { data: { role: "user", content: priorGoal } },
      { data: { role: "assistant", content: "Here is the implementation plan for the ring buffer." } },
    ]);

    const strategy: Strategy = {
      name: `referential-resolution(${cfg.embedModel})`,
      warmup: async () => {
        clearEmbedState();
        await nearestExemplar({ ...cfg, judgeTimeoutMs: 15000 }, mergedExemplars(cfg), "warmup");
        clearEmbedState();
      },
      classify: async (text) => {
        clearIntentMemo();
        const resolved = await resolvePriorConversationObjective(ctx, text, cfg);
        return resolved === priorGoal ? "referential" : "concrete";
      },
    };
    console.log(await serverInfo(cfg));
    const report = await evaluateStrategy(strategy, REFERENTIAL_EVAL_CORPUS, {
      stateChanging: new Set(["referential"]),
    });
    console.log(formatReport("referential-activation", report));
    check(report.unavailable === 0, `${report.unavailable} unavailable answers`);
    check(report.falsePositives === 0, `expected 0 false referential overwrites of concrete objectives, got ${report.falsePositives}`);
    check(report.accuracy >= 0.9, `expected >= 90% accuracy, got ${(report.accuracy * 100).toFixed(1)}%`);
  },
});
