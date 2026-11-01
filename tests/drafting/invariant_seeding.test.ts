import assert from "node:assert";
import { fetchActiveInvariants, formatInvariantsComment } from "../../src/surface/invariants.ts";
import { renderDraftTemplate } from "../../src/views/draft-template.ts";
import { ensureDraftFile } from "../../src/files.ts";
import { fakeCtx } from "../fake-pi.ts";

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
