import { check } from "../check.ts";
import { resolveChoice } from "../../src/judge/choice.ts";

Deno.test("resolveChoice is exact: no substring or synonym matching", () => {
  const options = [
    { key: "yes", description: "positive" },
    { key: "no", description: "negative" },
  ];
  check(resolveChoice("yes", options) === "yes", "matches exact key");
  check(resolveChoice("YES", options) === "yes", "case-insensitive");
  check(resolveChoice("  no  ", options) === "no", "trims whitespace");
  check(resolveChoice("maybe", options) === null, "unknown label is null");
});
