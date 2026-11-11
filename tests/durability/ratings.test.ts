import { check } from "../check.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuest } from "../../src/domain/quest.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import {
  calculateEpisodeScore,
  updateBetaDistribution,
  readRatingsStore,
  writeRatingsStore,
  recordQuestRating,
  writeHandoffReceipt,
  readHandoffReceipt,
  clearHandoffReceipt,
  checkPostQuestReversions,
  applyModelPenalty,
  isCorrectionByJudge,
  checkPostQuestCorrection,
} from "../../src/durability/ratings.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-quest-ratings-"));
}

Deno.test("calculateEpisodeScore computes scores from setbacks, revisions, and outcomes", () => {
  const cleanQuest = createQuest("Clean task", "test01");
  check(calculateEpisodeScore(cleanQuest, "COMPLETED") === 1.0, "clean completed => 1.0");

  const setbackQuest = createQuest("Setback task", "test02");
  setbackQuest.setbacks = [
    { reason: "test failed", evidence: [] },
  ];
  check(calculateEpisodeScore(setbackQuest, "COMPLETED") === 0.93, "1 setback completed => 0.93");

  check(calculateEpisodeScore(cleanQuest, "FAILED") === 0.20, "failed outcome => 0.20");
  check(calculateEpisodeScore(cleanQuest, "ABANDONED") === 0.10, "abandoned outcome => 0.10");

  // Explicit rating 5 stars
  check(calculateEpisodeScore(cleanQuest, "COMPLETED", 5) === 1.0, "clean 5-star => 1.0");
  // Explicit rating 1 star
  check(calculateEpisodeScore(cleanQuest, "COMPLETED", 1) === 0.70, "clean 1-star => 0.70");
});

Deno.test("updateBetaDistribution updates alpha, beta, and mean with discount", () => {
  const prior = { alpha: 16, beta: 4, mean: 0.8, episodes: 10 };
  const updatedClean = updateBetaDistribution(prior, 1.0);
  check(updatedClean.episodes === 11, "episodes incremented");
  check(updatedClean.mean > 0.8, "clean run increases mean");

  const updatedBad = updateBetaDistribution(prior, 0.1);
  check(updatedBad.mean < 0.8, "bad run decreases mean");
});

Deno.test("ratingsStore round-trips to disk and survives missing directory", async () => {
  const cwd = tmp();
  try {
    const empty = await readRatingsStore(cwd);
    check(empty.version === 1, "version 1");
    check(Object.keys(empty.models).length === 0, "empty models");

    const quest = createQuest("Test task", "test03", null, "trivial", "bugfix");
    const profile = await recordQuestRating(cwd, "test/model", quest, "COMPLETED");
    check(profile.overall.episodes === 1, "recorded 1 episode");
    check(profile.byTier?.trivial?.episodes === 1, "tier recorded");
    check(profile.byKind?.bugfix?.episodes === 1, "kind recorded");

    const reloaded = await readRatingsStore(cwd);
    check(reloaded.models["test/model"] !== undefined, "model persisted");
    check(reloaded.models["test/model"].overall.episodes === 1, "episodes persisted");
  } finally {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("handoff receipts round-trip and checkPostQuestReversions catches dropped commits", async () => {
  const cwd = tmp();
  try {
    await writeHandoffReceipt(cwd, {
      qid: "test04",
      model: "test/model",
      timestamp: new Date().toISOString(),
      commitHashes: ["deadbeef1234567"],
      filesModified: ["foo.c"],
      observedTurnsRemaining: 3,
    });

    const read = await readHandoffReceipt(cwd);
    check(read !== null && read.qid === "test04", "handoff read");
    check(read?.commitHashes[0] === "deadbeef1234567", "hash preserved");

    // Case 1: Commit is valid in history (merge-base returns 0)
    const check1 = await checkPostQuestReversions(cwd, async () => ({ code: 0 }));
    check(check1.reverted === false, "not reverted when merge-base succeeds");

    const readDecremented = await readHandoffReceipt(cwd);
    check(readDecremented?.observedTurnsRemaining === 2, "observed turns decremented to 2");

    // Case 1b: Commit is on another branch (merge-base fails, but branch --contains succeeds)
    const check1b = await checkPostQuestReversions(cwd, async (args) => {
      if (args[0] === "merge-base") return { code: 1 };
      if (args[0] === "branch" && args[1] === "--contains") return { code: 0, stdout: "* feature-branch\n" };
      return { code: 0 };
    });
    check(check1b.reverted === false, "not reverted when commit exists on another branch");

    // Case 2: Commit was reverted / reset (merge-base returns non-zero 1 and branch --contains fails)
    const check2 = await checkPostQuestReversions(cwd, async () => ({ code: 1 }));
    check(check2.reverted === true, "reversion caught");
    check(Boolean(check2.reason?.includes("deadbeef")), "reason names commit");

    // After reversion penalty, store reflects penalty update
    const store = await readRatingsStore(cwd);
    check(store.models["test/model"] !== undefined, "model penalty logged");
    check(store.models["test/model"].overall.mean < 0.8, "mean degraded by penalty");
  } finally {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("isCorrectionByJudge recognizes developer complaints via semantic judge", async () => {
  const server = Deno.serve({ port: 0 }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.includes("/v1/systemone")) {
      const body = await req.json();
      const isCorr = body.text.includes("broke") || body.text.includes("undo");
      const choice = isCorr ? "correction" : "advance";
      return new Response(JSON.stringify({
        choice,
        similarity: 0.95,
        margin: 0.35,
        scores: { correction: isCorr ? 0.95 : 0.40, advance: isCorr ? 0.40 : 0.95 },
        model: "bge-base",
      }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  });

  const port = server.addr.port;
  const cfg = {
    ...DEFAULT_CONFIG,
    embedUrl: `http://127.0.0.1:${port}`,
    embedModel: "bge-base",
  };

  try {
    check(await isCorrectionByJudge("Wait, that broke the build!", cfg) === true, "broke build recognized");
    check(await isCorrectionByJudge("Thanks, looks good!", cfg) === false, "advance recognized");

    const cwd = tmp();
    try {
      await writeHandoffReceipt(cwd, {
        qid: "test05",
        model: "test/model-correct",
        timestamp: new Date().toISOString(),
        commitHashes: ["11223344"],
        filesModified: ["bar.c"],
        observedTurnsRemaining: 3,
      });

      const res = await checkPostQuestCorrection(cwd, "Wait, that broke the parser!", cfg);
      check(res.corrected === true, "correction applied");
      check(Boolean(res.reason?.includes("broke the parser")), "reason mentions text");

      const store = await readRatingsStore(cwd);
      check(store.models["test/model-correct"] !== undefined, "model logged");
      check(store.models["test/model-correct"].overall.mean < 0.8, "mean degraded by correction penalty");
    } finally {
      try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } finally {
    await server.shutdown();
  }
});
