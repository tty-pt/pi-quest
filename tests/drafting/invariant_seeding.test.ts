import assert from "node:assert";
import {
  classifyInvariantByEmbedding,
  cleanInvariantSummary,
  fetchActiveInvariants,
  formatInvariantsComment,
  INVARIANT_EXEMPLARS,
  isEligibleStandingInvariant,
} from "../../src/surface/invariants.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { renderDraftTemplate } from "../../src/views/draft-template.ts";
import { ensureDraftFile } from "../../src/files.ts";
import { fakeCtx } from "../fake-pi.ts";

Deno.test("invariant_seeding: cleanInvariantSummary strips episode wrapper cleanly", () => {
  const raw = "Episode: Standing directive: Minimize and eliminate regex usage across the system. — tested: Recorded permanent invariant.";
  assert.strictEqual(cleanInvariantSummary(raw), "Minimize and eliminate regex usage across the system.");

  const plain = "Accent-sensitive search (pão ≠ pao)";
  assert.strictEqual(cleanInvariantSummary(plain), "Accent-sensitive search (pão ≠ pao)");
});

Deno.test("invariant_seeding: isEligibleStandingInvariant rejects empty, short, and interrogative strings", () => {
  assert.strictEqual(isEligibleStandingInvariant(""), false);
  assert.strictEqual(isEligibleStandingInvariant("short"), false);
  assert.strictEqual(isEligibleStandingInvariant("Judging by the introduced clever preprocessor guards, the wasm boundary is not totally unified. Correct? This is an analysis request. Nothing else."), false);
  assert.strictEqual(isEligibleStandingInvariant("And our site, which is pure C, should work without those clever precompiler guards? Understood?"), false);
  assert.strictEqual(isEligibleStandingInvariant("How unified is this boundary right now across all the libs?"), false);

  assert.strictEqual(isEligibleStandingInvariant("Pure-C isomorphic UX: no #ifdef or engine symbols in mods/*/ux/"), true);
  assert.strictEqual(isEligibleStandingInvariant("Accent-sensitive search (pão ≠ pao)"), true);
  assert.strictEqual(isEligibleStandingInvariant("Never compliment yourself or use self-flattery when asked for metrics."), true);
});

Deno.test("invariant_seeding: classifyInvariantByEmbedding and fetchActiveInvariants filter transient/harmful directives via /v1/systemone on unseen inputs", async () => {
  const exemplarSet = new Set(
    Object.values(INVARIANT_EXEMPLARS).flat().map((s) => s.toLowerCase()),
  );

  const unseenCases: Array<{ text: string; wantStanding: boolean }> = [
    { text: "Pure-C isomorphic UX: no #ifdef or engine symbols in mods/*/ux/", wantStanding: true },
    { text: "Accent-sensitive search (pão ≠ pao)", wantStanding: true },
    { text: "Never compliment yourself or use self-flattery when asked for metrics.", wantStanding: true },
    { text: "Just commit. We can work on tests later.", wantStanding: false },
    { text: "Skip tests for now and commit", wantStanding: false },
    { text: "Make sure everything is committed and pushed as part of this wip commit thing.", wantStanding: false },
    { text: "Make sure the nd work is committed.", wantStanding: false },
    { text: "Judging by the introduced clever preprocessor guards... Correct? This is an analysis request.", wantStanding: false },
  ];

  for (const c of unseenCases) {
    assert.strictEqual(
      exemplarSet.has(c.text.toLowerCase()),
      false,
      `Test case must be unseen (not in INVARIANT_EXEMPLARS): ${c.text}`,
    );
  }

  let systemoneCalls = 0;
  const server = Deno.serve({ port: 0 }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.includes("/v1/systemone")) {
      systemoneCalls++;
      const body = await req.json() as { text: string; labels: Record<string, string[]> };
      assert.ok(Array.isArray(body.labels["standing_invariant"]), "passes standing_invariant exemplars");
      assert.ok(Array.isArray(body.labels["transient_or_invalid"]), "passes transient_or_invalid exemplars");
      const lower = body.text.toLowerCase();
      const isTransient = lower.includes("commit") || lower.includes("tests later") || lower.includes("skip tests");
      const decision = isTransient ? "transient_or_invalid" : "standing_invariant";
      return new Response(JSON.stringify({
        ok: true,
        decision,
        choice: decision,
        similarity: 0.78,
        margin: 0.14,
      }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  });

  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    judgeMode: "auto",
    embedMode: "auto",
    judgeUrl: `http://127.0.0.1:${server.addr.port}`,
    embedUrl: `http://127.0.0.1:${server.addr.port}`,
  };

  try {
    for (const c of unseenCases) {
      const ok = await classifyInvariantByEmbedding(c.text, cfg);
      assert.strictEqual(ok, c.wantStanding, `classifyInvariantByEmbedding("${c.text}") expected ${c.wantStanding}, got ${ok}`);
    }
    assert.ok(systemoneCalls >= 7, `expected /v1/systemone calls for non-question inputs, got ${systemoneCalls}`);

    const g = globalThis as Record<string, unknown>;
    const prev = g["__pi_mm_directives"];
    try {
      g["__pi_mm_directives"] = [
        { ref: 12, summary: "Pure-C isomorphic UX: no #ifdef or engine symbols in mods/*/ux/" },
        { ref: 35107, summary: "Just commit. We can work on tests later." },
        { ref: 25357, summary: "Judging by the introduced clever preprocessor guards... Correct? This is an analysis request." },
        { ref: 45, summary: "Accent-sensitive search (pão ≠ pao)" },
      ];
      const verified = await fetchActiveInvariants("/nonexistent/dir", cfg);
      assert.strictEqual(verified.length, 2);
      assert.strictEqual(verified[0].ref, 12);
      assert.strictEqual(verified[1].ref, 45);

      const formatted = formatInvariantsComment(verified);
      assert.strictEqual(formatted.includes("• Invariant (Ref 12): Pure-C isomorphic UX"), true);
      assert.strictEqual(formatted.includes("• Invariant (Ref 45): Accent-sensitive search"), true);
      assert.strictEqual(formatted.includes("35107"), false);
      assert.strictEqual(formatted.includes("25357"), false);
    } finally {
      g["__pi_mm_directives"] = prev;
    }
  } finally {
    await server.shutdown();
  }
});

Deno.test("invariant_seeding: formatInvariantsComment formats active invariants and filters interrogatives", () => {
  const invs = [
    { ref: 12, summary: "Pure-C isomorphic UX: no #ifdef or engine symbols in mods/*/ux/" },
    { ref: 25357, summary: "Judging by the introduced clever preprocessor guards... Correct? This is an analysis request." },
    { ref: 45, summary: "Accent-sensitive search (pão ≠ pao)" },
  ];

  const formatted = formatInvariantsComment(invs);
  assert.strictEqual(formatted.includes("[Compliance Criteria]"), true);
  assert.strictEqual(formatted.includes("[Active Mid-Quest Directives - Must be satisfied]"), true);
  assert.strictEqual(formatted.includes("[Standing Repository Invariants from Memory]:"), true);
  assert.strictEqual(formatted.includes("• Invariant (Ref 12): Pure-C isomorphic UX: no #ifdef or engine symbols in mods/*/ux/"), true);
  assert.strictEqual(formatted.includes("• Invariant (Ref 45): Accent-sensitive search (pão ≠ pao)"), true);
  assert.strictEqual(formatted.includes("25357"), false);
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
