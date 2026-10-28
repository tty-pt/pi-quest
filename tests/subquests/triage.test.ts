import { check } from "../check.ts";
import { classifyUserMessage } from "../../src/subquests/triage.ts";

Deno.test("triage confirms approvals", () => {
  for (const text of ["go", "yes", "lgtm", "please proceed", "looks good", "approve"]) {
    check(classifyUserMessage(text) === "confirmation", `"${text}" confirms`);
  }
});

Deno.test("triage hears acks", () => {
  for (const text of ["thanks", "ok cool", "hi"]) {
    check(classifyUserMessage(text) === "ack", `"${text}" acks`);
  }
});

Deno.test("triage routes short questions to discussion", () => {
  check(classifyUserMessage("what does this do?") === "question", "short question");
  check(classifyUserMessage(" explain the gate table ") === "question", "explainer");
});

Deno.test("triage treats the rest as refinements", () => {
  check(
    classifyUserMessage("Also handle the edge case where the draft is empty and add retries.") === "refinement",
    "requirement refines",
  );
  check(
    classifyUserMessage("What is the full history of this design decision and every alternative we rejected along the way, in detail?".repeat(4)) === "refinement",
    "long question refines",
  );
});

Deno.test("triage parses explicit prefix overrides", () => {
  const sq1 = classifyUserMessage("!sq add database migration tool");
  check(sq1 === "subquest_preempt", "!sq parses to subquest_preempt");

  const sq2 = classifyUserMessage("subquest: add database migration tool");
  check(sq2 === "subquest_preempt", "subquest: parses to subquest_preempt");

  const queue1 = classifyUserMessage("!later export csv reports");
  check(queue1 === "subquest_queue", "!later parses to subquest_queue");

  const queue2 = classifyUserMessage("backlog: export csv reports");
  check(queue2 === "subquest_queue", "backlog: parses to subquest_queue");

  const rule1 = classifyUserMessage("!rule port must be 8080");
  check(rule1 === "directive_constraint", "!rule parses to directive_constraint");

  const rule2 = classifyUserMessage("must: port must be 8080");
  check(rule2 === "directive_constraint", "must: parses to directive_constraint");

  const chat1 = classifyUserMessage("!chat what time is it?");
  check(chat1 === "chat_bypass", "!chat parses to chat_bypass");

  const chat2 = classifyUserMessage("? how does caching work?");
  check(chat2 === "chat_bypass", "? prefix parses to chat_bypass");
});

Deno.test("triage recognizes actionable questions as refinements", () => {
  check(classifyUserMessage("Can we also add error handling for SIGTERM?") === "refinement", "actionable question refines");
  check(classifyUserMessage("Could you also update the test runner?") === "refinement", "could you also refines");
});

Deno.test("triage recognizes natural subquest and constraint phrases without prefixes", () => {
  // Natural sub-quest phrasing
  check(classifyUserMessage("Let's do the database migration in a subquest") === "subquest_queue", "in a subquest queues");
  check(classifyUserMessage("Please spin up a subquest to fix the broken test now") === "subquest_preempt", "urgent subquest preempts");
  check(classifyUserMessage("Split this into a subtask for auth") === "subquest_queue", "split into a subtask queues");

  // Natural constraint phrasing
  check(classifyUserMessage("Make sure port is 8080") === "directive_constraint", "make sure is constraint");
  check(classifyUserMessage("Ensure that all tests pass before commit") === "directive_constraint", "ensure that is constraint");
  check(classifyUserMessage("Don't touch db.c") === "directive_constraint", "don't touch is constraint");
  check(classifyUserMessage("Must use C99 standard") === "directive_constraint", "must use is constraint");
});

Deno.test("triage classifies bare 'go on'-style steering as confirmation, exact only", () => {
  for (const phrase of ["go on", "Go on!", "carry on", "keep going", "ship it", "let's go", "please continue"]) {
    check(classifyUserMessage(phrase) === "confirmation", `"${phrase}" is confirmation`);
  }
  check(classifyUserMessage("Carry on with the migration but also rename the table to users_v2") !== "confirmation", "embedded phrase is not confirmation");
});

