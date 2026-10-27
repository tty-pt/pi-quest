import { check } from "../check.ts";
import { triageInQuestRequest } from "../../src/subquests/scope.ts";

Deno.test("triage records refinements with routing guidance", () => {
  const triaged = triageInQuestRequest("abc123", "refinement");
  check(triaged !== null && triaged.record, "refinement recorded");
  check(triaged!.steer.includes("quest_update_state"), "amendment route named");
  check(triaged!.steer.includes("quest_subquest"), "sub-quest route named");
  check(triaged!.steer.includes("finish or archive"), "separate-quest instruction present");
  check(triaged!.steer.includes("abc123"), "qid carried");
});

Deno.test("triage leaves non-refinements to the agent", () => {
  check(triageInQuestRequest("abc123", "question") === null, "questions pass through");
  check(triageInQuestRequest("abc123", "ack") === null, "acks pass through");
  check(triageInQuestRequest("abc123", "confirmation") === null, "approvals pass through");
  check(triageInQuestRequest("abc123", "chat_bypass") === null, "chat_bypass passes through");
});

Deno.test("triage handles directives and subquest actions", () => {
  const preempt = triageInQuestRequest("abc123", "subquest_preempt", "fix memory leak");
  check(preempt !== null && preempt.record, "preempt recorded");
  check(preempt!.action === "preempt_subquest", "action preempt_subquest");
  check(preempt!.steer.includes("Spawning immediate sub-quest"), "preempt steer text");

  const queue = triageInQuestRequest("abc123", "subquest_queue", "export csv");
  check(queue !== null && queue.record, "queue recorded");
  check(queue!.action === "queue_subquest", "action queue_subquest");
  check(queue!.steer.includes("Queued sub-quest"), "queue steer text");

  const rule = triageInQuestRequest("abc123", "directive_constraint", "port 8080");
  check(rule !== null && rule.record, "rule recorded");
  check(rule!.action === "amend_requirement", "action amend_requirement");
  check(rule!.steer.includes("Recorded user constraint"), "rule steer text");
});

Deno.test("triage respects midQuest mode off", () => {
  const off = triageInQuestRequest("abc123", "directive_constraint", "port 8080", {
    mode: "off",
    subquestAction: "queue_backlog",
    autoAmendRequirements: false,
    turnInjection: false,
    promptTimeoutMs: 1000,
  });
  check(off === null, "mode off disables triage interception");
});

