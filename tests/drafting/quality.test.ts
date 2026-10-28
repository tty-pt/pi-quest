// draftQuality: deterministic, configurable evidence/plan-depth bar that backs
// the bypass policies (balanced/off), where no reviewer reads the plan.
import { check } from "../check.ts";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "../../src/config.ts";
import { assessDraftQuality, countSteps, judgeHasVerificationStep, parseDraftQuality, DEFAULT_DRAFT_QUALITY } from "../../src/drafting/quality.ts";
import { parseDraftSections } from "../../src/drafting/plan-text.ts";
import { fakeCtx } from "../fake-pi.ts";

async function repo(): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-quality-"));
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(join(cwd, "src/a.ts"), Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n"), "utf8");
  await writeFile(join(cwd, "src/b.ts"), Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n"), "utf8");
  return cwd;
}

const PLAN = `1. Edit src/a.ts:10 to add the option.
2. Wire it in src/b.ts:20.
3. Add a test that verifies the option and run it.`;

function sections(plan: string, evidence = ["src/a.ts:5 shows X", "src/b.ts:7 shows Y"]) {
  const ev = evidence.map((e) => `- ${e}`).join("\n");
  return parseDraftSections(`## Requirements\n- R1: a\n- R2: b\n\n## Evidence\n${ev}\n\n## Implementation Plan\n${plan}\n`);
}

Deno.test("countSteps: numbered, bulleted and checkbox items; prose does not count", () => {
  check(countSteps("1. a\n2) b\n- c\n* d\n- [ ] e") === 5, "list forms");
  check(countSteps("Do the thing. Then the other thing.") === 0, "prose");
  check(countSteps("### Heading\nbody") === 0, "headings are not steps");
});

function stubJudge(answer: string | null): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (() => {
    if (answer === null) return Promise.reject(new Error("judge down"));
    return Promise.resolve(new Response(JSON.stringify({ answers: { plan_verification: { choice: answer } } }), { status: 200 }));
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}
const JUDGED = { ...DEFAULT_CONFIG, judgeMode: "auto" as const, judgeUrl: "http://judge.test" };

Deno.test("judgeHasVerificationStep: decomposed embeddings decide, unavailable is null", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: unknown) => {
    if (String(url).includes("/v1/classify")) {
      return Promise.resolve(new Response(JSON.stringify({
        choice: "automated_test",
        similarity: 0.90,
        margin: 0.20,
        scores: { automated_test: 0.90, non_verify: 0.50 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response("down", { status: 503 }));
  }) as typeof fetch;

  try {
    check((await judgeHasVerificationStep(JUDGED, "1. Run unit tests and make test")) === true, "verified step passes");
  } finally {
    globalThis.fetch = real;
  }

  const down = stubJudge(null);
  try {
    check((await judgeHasVerificationStep({ ...DEFAULT_CONFIG, embedMode: "off" }, "1. Run tests")) === null, "unavailable => null");
  } finally {
    down();
  }
});

Deno.test("standard defaults: a cited, stepped, verified plan passes", async () => {
  const cwd = await repo();
  const res = await assessDraftQuality(fakeCtx(cwd), DEFAULT_CONFIG, sections(PLAN), "standard", "standard");
  check(res.gaps.length === 0, `no gaps, got ${res.gaps.join(" | ")}`);
  check(res.summary.includes("quality"), "summary line present");
});

Deno.test("standard defaults: prose plan without citations lists gaps", async () => {
  const cwd = await repo();
  const res = await assessDraftQuality(fakeCtx(cwd), JUDGED, sections("Just do it.", ["no cites here"]), "standard", "standard");
  check(res.gaps.length >= 2, `gaps listed, got ${res.gaps.length}: ${res.gaps.join(" | ")}`);
  check(res.gaps.some((g) => g.includes("citation")), "citation gap");
  check(res.gaps.some((g) => g.includes("step")), "step gap");
});

Deno.test("standard defaults: judge-less verification check is advisory, never a gap", async () => {
  const cwd = await repo();
  const res = await assessDraftQuality(fakeCtx(cwd), DEFAULT_CONFIG, sections("Just do it.", ["no cites here"]), "standard", "standard");
  check(!res.gaps.some((g) => g.includes("verification")), "no keyword guess without a judge");
});

Deno.test("unresolvable citations do not count", async () => {
  const cwd = await repo();
  const s = sections(PLAN, ["src/ghost.ts:5 invented", "src/a.ts:9999 out of range"]);
  const res = await assessDraftQuality(fakeCtx(cwd), DEFAULT_CONFIG, s, "standard", "standard");
  // PLAN itself cites two real locations; only those count => still 2 resolved (== min), so no gap.
  check(res.resolved === 2 && res.total === 4, `2/4 resolve, got ${res.resolved}/${res.total}`);
  check(res.gaps.length === 0, "real plan citations satisfy the floor");
  const bare = await assessDraftQuality(fakeCtx(cwd), DEFAULT_CONFIG, sections("1. do\n2. do\n3. test it", ["src/ghost.ts:5 invented"]), "standard", "standard");
  check(bare.gaps.some((g) => g.includes("citation")), "invented citations leave a gap");
});

Deno.test("complex tier is stricter than standard", async () => {
  const cwd = await repo();
  const res = await assessDraftQuality(fakeCtx(cwd), DEFAULT_CONFIG, sections(PLAN, []), "standard", "complex");
  check(res.gaps.some((g) => g.includes("step")) && res.gaps.some((g) => g.includes("citation")), "complex wants more");
});

Deno.test("trivial tier asks for almost nothing", async () => {
  const cwd = await repo();
  const res = await assessDraftQuality(fakeCtx(cwd), DEFAULT_CONFIG, sections("1. fix typo", []), "standard", "trivial");
  check(res.gaps.length === 0, `trivial passes, got ${res.gaps.join(" | ")}`);
});

Deno.test("analysis quests: citations only, no step/verification demands", async () => {
  const cwd = await repo();
  const doc = parseDraftSections(`## Requirements\n- R1: a\n\n## Evidence\n- x\n\n## Analysis\nFindings at src/a.ts:3 and src/b.ts:4.\n`);
  const res = await assessDraftQuality(fakeCtx(cwd), DEFAULT_CONFIG, doc, "analysis", "standard");
  check(res.gaps.length === 0, `analysis ok, got ${res.gaps.join(" | ")}`);
});

Deno.test("mode off disables the assessment; warn reports but does not block", async () => {
  const cwd = await repo();
  const bad = sections("Just do it.", []);
  const off = { ...DEFAULT_CONFIG, draftQuality: { ...DEFAULT_DRAFT_QUALITY, mode: "off" as const } };
  const offRes = await assessDraftQuality(fakeCtx(cwd), off, bad, "standard", "standard");
  check(offRes.gaps.length === 0 && offRes.blocks === false, "off: silent");
  const warn = { ...DEFAULT_CONFIG, draftQuality: { ...DEFAULT_DRAFT_QUALITY, mode: "warn" as const } };
  const warnRes = await assessDraftQuality(fakeCtx(cwd), warn, bad, "standard", "standard");
  check(warnRes.gaps.length > 0 && warnRes.blocks === false, "warn: gaps, no block");
  const enf = await assessDraftQuality(fakeCtx(cwd), DEFAULT_CONFIG, bad, "standard", "standard");
  check(enf.gaps.length > 0 && enf.blocks === true, "enforce: blocks");
});

Deno.test("config: draftQuality parsed with per-tier overrides, defaults kept elsewhere", () => {
  const q = parseDraftQuality({ mode: "warn", tiers: { standard: { citations: 5, requireVerification: false } } });
  check(q.mode === "warn", "mode");
  check(q.tiers.standard.citations === 5 && q.tiers.standard.requireVerification === false, "override applied");
  check(q.tiers.standard.steps === DEFAULT_DRAFT_QUALITY.tiers.standard.steps, "untouched field defaulted");
  check(q.tiers.complex.citations === DEFAULT_DRAFT_QUALITY.tiers.complex.citations, "other tier defaulted");
  check(parseDraftQuality(undefined).mode === "enforce", "default enforce");
  check(parseDraftQuality({ mode: "bogus" }).mode === "enforce", "invalid mode -> default");
  check(loadConfig({ draftQuality: { mode: "off" } }).draftQuality.mode === "off", "loadConfig wires it");
});
