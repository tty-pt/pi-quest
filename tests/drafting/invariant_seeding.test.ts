import assert from "node:assert";
import {
  cleanInvariantSummary,
  fetchActiveInvariants,
  formatInvariantsComment,
  isEligibleStandingInvariant,
} from "../../src/surface/invariants.ts";
import { renderDraftTemplate } from "../../src/views/draft-template.ts";
import { ensureDraftFile } from "../../src/files.ts";
import { fakeCtx } from "../fake-pi.ts";

Deno.test("invariant_seeding: cleanInvariantSummary strips episode wrapper cleanly", () => {
  const raw = "Episode: Standing directive: Minimize and eliminate regex usage across the system. — tested: Recorded permanent invariant.";
  assert.strictEqual(cleanInvariantSummary(raw), "Minimize and eliminate regex usage across the system.");

  const plain = "Accent-sensitive search (pão ≠ pao)";
  assert.strictEqual(cleanInvariantSummary(plain), "Accent-sensitive search (pão ≠ pao)");
});

Deno.test("invariant_seeding: isEligibleStandingInvariant rejects harmful, transient, or interrogative statements", () => {
  // Harmful / anti-testing
  assert.strictEqual(isEligibleStandingInvariant("Just commit. We can work on tests later."), false);
  assert.strictEqual(isEligibleStandingInvariant("Just commit, we can work on tests later"), false);
  assert.strictEqual(isEligibleStandingInvariant("Skip tests for now and commit"), false);
  assert.strictEqual(isEligibleStandingInvariant("work on tests later"), false);

  // Transient WIP / commit commands
  assert.strictEqual(isEligibleStandingInvariant("Make sure everything is committed and pushed as part of this wip commit thing."), false);
  assert.strictEqual(isEligibleStandingInvariant("Make sure the nd work is committed."), false);
  assert.strictEqual(isEligibleStandingInvariant("Just commit."), false);

  // Questions / interrogatives
  assert.strictEqual(isEligibleStandingInvariant("Judging by the introduced clever preprocessor guards, the wasm boundary is not totally unified. Correct? This is an analysis request. Nothing else."), false);
  assert.strictEqual(isEligibleStandingInvariant("And our site, which is pure C, should work without those clever precompiler guards? Understood?"), false);
  assert.strictEqual(isEligibleStandingInvariant("How unified is this boundary right now across all the libs?"), false);

  // Genuine invariants
  assert.strictEqual(isEligibleStandingInvariant("Pure-C isomorphic UX: no #ifdef or engine symbols in mods/*/ux/"), true);
  assert.strictEqual(isEligibleStandingInvariant("Accent-sensitive search (pão ≠ pao)"), true);
  assert.strictEqual(isEligibleStandingInvariant("Never compliment yourself or use self-flattery when asked for metrics."), true);
});

Deno.test("invariant_seeding: formatInvariantsComment filters out bad invariants", () => {
  const invs = [
    { ref: 12, summary: "Pure-C isomorphic UX: no #ifdef or engine symbols in mods/*/ux/" },
    { ref: 35107, summary: "Just commit. We can work on tests later." },
    { ref: 25357, summary: "Judging by the introduced clever preprocessor guards... Correct? This is an analysis request." },
    { ref: 45, summary: "Accent-sensitive search (pão ≠ pao)" },
  ];

  const formatted = formatInvariantsComment(invs);
  assert.strictEqual(formatted.includes("• Invariant (Ref 12): Pure-C isomorphic UX"), true);
  assert.strictEqual(formatted.includes("• Invariant (Ref 45): Accent-sensitive search"), true);
  assert.strictEqual(formatted.includes("35107"), false);
  assert.strictEqual(formatted.includes("tests later"), false);
  assert.strictEqual(formatted.includes("25357"), false);
  assert.strictEqual(formatted.includes("analysis request"), false);
});

Deno.test("invariant_seeding: formatInvariantsComment formats active invariants cleanly", () => {
  const invs = [
    { ref: 12, summary: "Pure-C isomorphic UX: no #ifdef or engine symbols in mods/*/ux/" },
    { ref: 45, summary: "Accent-sensitive search (pão ≠ pao)" },
  ];

  const formatted = formatInvariantsComment(invs);
  assert.strictEqual(formatted.includes("[Compliance Criteria]"), true);
  assert.strictEqual(formatted.includes("[Active Mid-Quest Directives - Must be satisfied]"), true);
  assert.strictEqual(formatted.includes("[Standing Repository Invariants from Memory]:"), true);
  assert.strictEqual(formatted.includes("• Invariant (Ref 12): Pure-C isomorphic UX: no #ifdef or engine symbols in mods/*/ux/"), true);
  assert.strictEqual(formatted.includes("• Invariant (Ref 45): Accent-sensitive search (pão ≠ pao)"), true);
});

Deno.test("invariant_seeding: renderDraftTemplate includes invariants comment block", () => {
  const invBlock = formatInvariantsComment([
    { ref: 12, summary: "Pure-C isomorphic UX" },
  ]);

  const doc = renderDraftTemplate("Test Quest", "Implement audio engine", undefined, "standard", invBlock);
  assert.strictEqual(doc.includes("[Compliance Criteria]"), true);
  assert.strictEqual(doc.includes("[Standing Repository Invariants from Memory]:"), true);
  assert.strictEqual(doc.includes("• Invariant (Ref 12): Pure-C isomorphic UX"), true);
});

Deno.test("invariant_seeding: fetchActiveInvariants reads from globalThis.__pi_mm_directives", async () => {
  const g = globalThis as Record<string, unknown>;
  const prev = g["__pi_mm_directives"];
  try {
    g["__pi_mm_directives"] = [
      { ref: 99, summary: "Global invariant directive" },
    ];

    const invs = await fetchActiveInvariants("/nonexistent/dir");
    assert.strictEqual(invs.length, 1);
    assert.strictEqual(invs[0].ref, 99);
    assert.strictEqual(invs[0].summary, "Global invariant directive");
  } finally {
    g["__pi_mm_directives"] = prev;
  }
});

Deno.test("invariant_seeding: fetchActiveInvariants reads from disk standing_directives.json", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const mmDir = `${tmpDir}/.pi/mm`;
    await Deno.mkdir(mmDir, { recursive: true });
    await Deno.writeTextFile(
      `${mmDir}/standing_directives.json`,
      JSON.stringify([
        { ref: 77, summary: "Disk invariant directive", subsystem: "audio" },
      ]),
    );

    const g = globalThis as Record<string, unknown>;
    const prev = g["__pi_mm_directives"];
    delete g["__pi_mm_directives"];
    try {
      const invs = await fetchActiveInvariants(tmpDir);
      assert.strictEqual(invs.length, 1);
      assert.strictEqual(invs[0].ref, 77);
      assert.strictEqual(invs[0].summary, "Disk invariant directive");
      assert.strictEqual(invs[0].subsystem, "audio");
    } finally {
      g["__pi_mm_directives"] = prev;
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("invariant_seeding: fetchActiveInvariants degrades gracefully when no invariants present", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const g = globalThis as Record<string, unknown>;
    const prev = g["__pi_mm_directives"];
    delete g["__pi_mm_directives"];
    try {
      const invs = await fetchActiveInvariants(tmpDir);
      assert.deepStrictEqual(invs, []);
    } finally {
      g["__pi_mm_directives"] = prev;
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("invariant_seeding: ensureDraftFile writes invariants into scaffold", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const ctx = fakeCtx(tmpDir);
    const invBlock = formatInvariantsComment([
      { ref: 42, summary: "Invariant 42 on disk" },
    ]);

    await ensureDraftFile(ctx, "inv001", "inv001", "Objective test", undefined, "standard", invBlock);
    const content = await Deno.readTextFile(`${tmpDir}/.pi/quest/future/inv001.md`);
    assert.strictEqual(content.includes("[Standing Repository Invariants from Memory]:"), true);
    assert.strictEqual(content.includes("• Invariant (Ref 42): Invariant 42 on disk"), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
