import { evaluateSteeringHeuristic, parseJevSteeringChoice, evaluateSteeringIntent } from "../../src/domain/steering.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { check } from "../check.ts";

Deno.test("steering heuristic: recognizes advance phrases in EN and PT", () => {
  const enMatches = ["go", "proceed", "approve", "lgtm", "looks good", "ship it", "confirm", "done", "wrap it up", "go on", "Go on"];
  for (const phrase of enMatches) {
    const res = evaluateSteeringHeuristic(phrase);
    check(res.action === "advance", `expected advance for "${phrase}", got ${res.action}`);
  }

  const ptMatches = ["avança", "avanca", "força nisso", "está bom", "esta feito", "pode fechar", "conclui a quest", "vai em frente", "continua assim"];
  for (const phrase of ptMatches) {
    const res = evaluateSteeringHeuristic(phrase);
    check(res.action === "advance", `expected advance for "${phrase}", got ${res.action}`);
  }
});

Deno.test("steering heuristic: recognizes abort phrases in EN and PT", () => {
  const enMatches = ["abort", "cancel", "kill quest", "stop quest", "abandon"];
  for (const phrase of enMatches) {
    const res = evaluateSteeringHeuristic(phrase);
    check(res.action === "abort", `expected abort for "${phrase}", got ${res.action}`);
  }

  const ptMatches = ["cancela", "cancela a quest", "para a quest", "esquece lá isso", "aborta"];
  for (const phrase of ptMatches) {
    const res = evaluateSteeringHeuristic(phrase);
    check(res.action === "abort", `expected abort for "${phrase}", got ${res.action}`);
  }
});

Deno.test("steering heuristic: neutral on regular instructions and questions", () => {
  const neutralTexts = [
    "please change the background color to blue",
    "what does this function do?",
    "let me inspect the tests first",
    "onde está o ficheiro de configuração?",
  ];
  for (const text of neutralTexts) {
    const res = evaluateSteeringHeuristic(text);
    check(res.action === "neutral", `expected neutral for "${text}", got ${res.action}`);
  }
});

Deno.test("steering judge: parses keyed and array choices", () => {
  check(parseJevSteeringChoice({ answers: { steering_intent: { choice: "advance" } } }) === "advance", "keyed advance");
  check(parseJevSteeringChoice({ answers: { steering_intent: { choice: "abort" } } }) === "abort", "keyed abort");
  check(parseJevSteeringChoice({ answers: [{ id: "steering_intent", choice: "advance" }] }) === "advance", "array advance");
  check(parseJevSteeringChoice({ answers: [] }) === "neutral", "empty array neutral");
  check(parseJevSteeringChoice(null) === "neutral", "null neutral");
});

Deno.test("evaluateSteeringIntent: runs heuristic without network call", async () => {
  const res = await evaluateSteeringIntent("looks good to me", "drafting", DEFAULT_CONFIG);
  check(res.action === "advance", "advances on looks good to me");
  check(res.source === "heuristic", "used heuristic");
});
