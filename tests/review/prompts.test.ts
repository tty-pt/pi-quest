import { check } from "../check.ts";
import { createQuest } from "../../src/domain/quest.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { buildReviewPrompt } from "../../src/review/prompts.ts";
import { implementationFingerprint } from "../../src/review/flow.ts";

const QID = "abc123" as Qid;

Deno.test("review prompts carry brief, rules, and verdict format", () => {
  const prompt = buildReviewPrompt("draft", QID, "hash-1", {
    objective: "ship it",
    plan: "do things",
    evidence: ["saw it"],
    amendments: [],
  });
  check(prompt.includes("abc123"), "qid present");
  check(prompt.includes("hash-1"), "target present");
  check(prompt.includes("ship it"), "objective present");
  check(prompt.includes("strictly read-only"), "read-only rules present");
  check(prompt.includes("VERDICT: PASS | FAIL"), "verdict format present");
  const validation = buildReviewPrompt("validation", QID, "snap-9", {
    objective: "ship it",
    plan: "did things",
    evidence: [],
    amendments: ["changed x (because y)"],
    implementationSummary: "done",
  });
  check(validation.includes("IMPLEMENTATION"), "validation material present");
  check(validation.includes("changed x"), "amendments present");
});

Deno.test("draft brief carries the maturity bar", () => {
  const prompt = buildReviewPrompt("draft", QID, "h1", {
    objective: "ship it",
    plan: "do things",
    evidence: [],
    amendments: [],
  });
  check(prompt.includes("MATURITY BAR"), "maturity section present");
  check(prompt.includes("2 requirements"), "threshold numbers present");
  const custom = buildReviewPrompt("draft", QID, "h1", {
    objective: "ship it",
    plan: "do things",
    evidence: [],
    amendments: [],
  }, { requirements: 3, evidence: 10 });
  check(custom.includes("3 requirements") && custom.includes("10 evidence"), "configured bar honored");
  const validation = buildReviewPrompt("validation", QID, "s1", {
    objective: "ship it",
    plan: "did things",
    evidence: [],
    amendments: [],
  });
  check(!validation.includes("MATURITY BAR"), "validation has no maturity bar");
});

Deno.test("re-review briefs carry the diff plus prior findings", () => {
  const prompt = buildReviewPrompt("draft", QID, "hash-2", {
    objective: "ship it",
    plan: "do things\nthen verify",
    evidence: [],
    amendments: [],
    planDiff: "- do things\n+ do things\n+ then verify",
    previousVerdict: "FAIL",
    previousFindings: "no verification step",
  });
  check(prompt.includes("CHANGES SINCE LAST REVIEW"), "diff section present");
  check(prompt.includes("then verify"), "diff content present");
  check(prompt.includes("PRIOR VERDICT: FAIL"), "prior verdict present");
  check(prompt.includes("no verification step"), "prior findings present");
  check(prompt.includes("a prior FAIL presumes nothing"), "independence preserved");
  const fresh = buildReviewPrompt("draft", QID, "hash-1", {
    objective: "ship it",
    plan: "do things",
    evidence: [],
    amendments: [],
  });
  check(!fresh.includes("CHANGES SINCE LAST REVIEW"), "first review has no diff section");
  check(!fresh.includes("PRIOR VERDICT"), "first review has no prior section");
});
Deno.test("empty sections render self-describing, never a bare none", () => {
  const prompt = buildReviewPrompt("draft", QID, "h1", {
    objective: "ship it",
    plan: "do things",
    requirements: [],
    evidence: [],
    amendments: [],
  });
  check(!prompt.includes("(none)"), "no bare none for reviewers to quote");
  check(prompt.includes("no evidence items recorded"), "empty evidence labeled");
  check(prompt.includes("no requirements recorded in the draft file"), "empty requirements labeled");
});

Deno.test("draft review packet renders authored requirements bullets and counts", () => {
  const prompt = buildReviewPrompt("draft", QID, "h1", {
    objective: "ship it",
    plan: "do things",
    requirements: ["R1: First requirement", "R2: Second requirement"],
    evidence: ["E1: First evidence"],
    amendments: [],
  });
  check(prompt.includes("REQUIREMENTS (2 recorded in the draft file's ## Requirements section):"), "requirements header with count");
  check(prompt.includes("- R1: First requirement"), "requirement 1 bullet present");
  check(prompt.includes("- R2: Second requirement"), "requirement 2 bullet present");

  const unspec = buildReviewPrompt("validation", QID, "s1", {
    objective: "ship it",
    plan: "did things",
    evidence: [],
    amendments: [],
  });
  check(!unspec.includes("REQUIREMENTS ("), "no requirements section when undefined");
});

Deno.test("output format splits PASS support from FAIL revisions", () => {
  const draft = buildReviewPrompt("draft", QID, "h1", {
    objective: "ship it",
    plan: "do things",
    evidence: [],
    amendments: [],
  });
  check(draft.includes("ADVISORIES"), "PASS branch offers advisories");
  check(draft.includes("REQUIRED REVISIONS"), "FAIL branch keeps revisions");
  check(draft.includes("approval is unconditional"), "PASS approval unconditional");
  const validation = buildReviewPrompt("validation", QID, "s1", {
    objective: "ship it",
    plan: "did things",
    evidence: [],
    amendments: [],
  });
  check(validation.includes("ADVISORIES"), "validation shares the PASS branch");
  check(validation.includes("REQUIRED REVISIONS"), "validation shares the FAIL branch");
});

Deno.test("validation brief carries the plan revision history", () => {
  const withHistory = buildReviewPrompt("validation", QID, "s1", {
    objective: "ship it",
    plan: "new plan",
    evidence: [],
    amendments: [],
    planRevisionHistory: ["- step 3 was wrong (superseded abc12345, 2026-09-06): old plan"],
  });
  check(withHistory.includes("PLAN REVISION HISTORY"), "history section present");
  check(withHistory.includes("step 3 was wrong"), "revision note present");
  check(withHistory.includes("weakens the acceptance bar"), "bar-weakening rule present");
  const clean = buildReviewPrompt("validation", QID, "s1", {
    objective: "ship it",
    plan: "did things",
    evidence: [],
    amendments: [],
  });
  check(!clean.includes("PLAN REVISION HISTORY"), "unrevised quest has no history section");
  const draft = buildReviewPrompt("draft", QID, "h1", {
    objective: "ship it",
    plan: "do things",
    evidence: [],
    amendments: [],
  });
  check(!draft.includes("weakens the acceptance bar"), "draft guidance has no validator rule");
});

Deno.test("analysis briefs label the deliverable and render the transcript block", () => {
  const brief = {
    objective: "ship it",
    plan: "the allocator is the bottleneck",
    kind: "analysis" as const,
    evidence: ["traced alloc.c:77"],
    amendments: [],
    transcriptExtract: "[user] profile it\n[assistant] traced alloc",
  };
  const validation = buildReviewPrompt("validation", QID, "s1", brief);
  check(validation.includes("APPROVED ANALYSIS:"), "analysis label used");
  check(!validation.includes("APPROVED PLAN"), "no plan label for analysis");
  check(validation.includes("RESEARCH TRANSCRIPT"), "transcript block present");
  check(validation.includes("[assistant] traced alloc"), "extract content present");
  check(validation.includes("You review the ANALYSIS deliverable"), "analysis validation guidance");
  const draft = buildReviewPrompt("draft", QID, "h1", { ...brief, plan: "the allocator is the bottleneck" });
  check(draft.includes("You review the ANALYSIS deliverable"), "analysis draft guidance");
  check(draft.includes("APPROVED ANALYSIS:"), "draft label matches");
  const standard = buildReviewPrompt("validation", QID, "s1", {
    objective: "ship it",
    plan: "did things",
    evidence: [],
    amendments: [],
  });
  check(standard.includes("APPROVED PLAN:"), "standard label unchanged");
  check(standard.includes("You review the IMPLEMENTATION"), "standard guidance unchanged");
  check(!standard.includes("RESEARCH TRANSCRIPT"), "no extract block without an extract");
});

Deno.test("implementation fingerprint is stable and content-bound", () => {
  const a = createQuest("same", "abc123");
  const b = createQuest("same", "abc123");
  check(implementationFingerprint(a) === implementationFingerprint(b), "stable");
  check(/^[0-9a-f]{64}$/.test(implementationFingerprint(a)), "sha256 hex");
  check(
    implementationFingerprint({ ...a, exactNextAction: "different" }) !== implementationFingerprint(a),
    "content-bound",
  );
});

Deno.test("draft review prompt calibrates guidance and packet according to difficulty", () => {
  // 1. Trivial difficulty
  const trivialPrompt = buildReviewPrompt("draft", QID, "h1", {
    objective: "Fix typo in doc",
    plan: "Update readme.md:42",
    difficulty: "trivial",
    requirements: ["R1: Fix typo"],
    evidence: ["README.md:42"],
    amendments: [],
  }, { requirements: 1, evidence: 2 }, true);
  check(trivialPrompt.includes("QUEST DIFFICULTY: trivial"), "trivial difficulty tag present");
  check(trivialPrompt.includes("POSTURE (TRIVIAL DIFFICULTY)"), "trivial posture guidance present");
  check(trivialPrompt.includes("do NOT demand multi-phase sequencing"), "lightweight instruction present");
  check(trivialPrompt.includes("FAST-FAIL MODE: this draft is below the REVIEW MATURITY BAR (trivial difficulty)"), "fast fail mentions trivial difficulty");

  // 2. Complex difficulty
  const complexPrompt = buildReviewPrompt("draft", QID, "h1", {
    objective: "Full system redesign",
    plan: "Phase 1: rewrite",
    difficulty: "complex",
    requirements: ["R1: New engine"],
    evidence: [],
    amendments: [],
  }, { requirements: 3, evidence: 10 }, true);
  check(complexPrompt.includes("QUEST DIFFICULTY: complex"), "complex difficulty tag present");
  check(complexPrompt.includes("POSTURE (COMPLEX DIFFICULTY)"), "complex posture guidance present");
  check(complexPrompt.includes("FAST-FAIL MODE: this draft is below the REVIEW MATURITY BAR (complex difficulty)"), "fast fail mentions complex difficulty");
});
