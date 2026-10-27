import { check } from "../check.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { createQuest } from "../../src/domain/quest.ts";
import type { SubQuestContract } from "../../src/domain/contract.ts";
import { isPathAllowedByContract } from "../../src/domain/contract.ts";
import { decide } from "../../src/domain/gates.ts";
import type { ToolRef } from "../../src/domain/gates.ts";

const QID = "c01test" as Qid;
const PARENT_QID = "root01" as Qid;

function ref(toolName: string, toolClass: ToolRef["toolClass"], path?: string): ToolRef {
  return path === undefined ? { toolName, toolClass } : { toolName, toolClass, path };
}

Deno.test("isPathAllowedByContract matches explicit paths and globs", () => {
  const contract: SubQuestContract = {
    qid: QID,
    parentQid: PARENT_QID,
    title: "Child task",
    assignedRequirements: ["R1"],
    allowedPaths: [
      "mods/song/parser.c",
      "mods/song/parser.h",
      "external/libxylem/*",
    ],
    requiredTestCommands: ["make test"],
    acceptanceCriteria: ["parser passes"],
  };

  check(isPathAllowedByContract(contract, "mods/song/parser.c"), "exact file allowed");
  check(isPathAllowedByContract(contract, "mods/song/parser.h"), "second exact file allowed");
  check(isPathAllowedByContract(contract, "external/libxylem/load.c"), "wildcard match allowed");
  check(!isPathAllowedByContract(contract, "mods/song/ux/song.c"), "unallowed path rejected");
  check(!isPathAllowedByContract(contract, "src/index.ts"), "root file rejected");

  // Trailing slash directory prefix matches
  const dirContract: SubQuestContract = {
    qid: QID,
    parentQid: PARENT_QID,
    title: "Child task",
    assignedRequirements: ["R1"],
    allowedPaths: ["src/path/"],
    requiredTestCommands: ["npm test"],
    acceptanceCriteria: ["safe"],
  };
  check(isPathAllowedByContract(dirContract, "src/path/foo.ts"), "file under directory allowed");
  check(isPathAllowedByContract(dirContract, "src/path/nested/sub.ts"), "nested file under directory allowed");
  check(!isPathAllowedByContract(dirContract, "src/other/file.ts"), "outside directory rejected");

  // Absolute path with cwd normalization
  check(isPathAllowedByContract(dirContract, "/workspace/root/src/path/foo.ts", "/workspace/root"), "absolute path normalized against cwd");
});

Deno.test("child quest in implementing gates writes to allowedPaths", () => {
  const quest = createQuest("Child task", QID, PARENT_QID);
  quest.phase = "implementing";
  quest.contract = {
    qid: QID,
    parentQid: PARENT_QID,
    title: "Child task",
    assignedRequirements: ["R1"],
    allowedPaths: ["mods/song/parser.c", "mods/song/parser.h"],
    requiredTestCommands: ["make test"],
    acceptanceCriteria: ["parser safe"],
  };

  // Writing to allowed path is allowed
  const allowedWrite = ref("edit", "write", "mods/song/parser.c");
  check(decide(quest, allowedWrite).allowed, "write to allowedPath allowed");

  // Writing to path outside allowedPaths is permitted with advisory
  const rogueWrite = ref("edit", "write", "mods/other/file.c");
  const decision = decide(quest, rogueWrite);
  check(decision.allowed, "write outside allowedPaths is permitted with advisory");
  check("advisory" in decision && typeof decision.advisory === "string", "advisory notice is present");

  // Reading any path is always allowed
  const readOther = ref("read", "read", "mods/other/file.c");
  check(decide(quest, readOther).allowed, "read outside allowedPaths allowed");
});

Deno.test("root quest without contract allows writing to any application file in implementing", () => {
  const root = createQuest("Root task", QID);
  root.phase = "implementing";

  const write1 = ref("edit", "write", "mods/song/parser.c");
  const write2 = ref("write", "write", "src/foo.ts");
  check(decide(root, write1).allowed, "write1 allowed for root quest");
  check(decide(root, write2).allowed, "write2 allowed for root quest");
});

Deno.test("child quest with empty or undefined allowedPaths acts as unrestricted worker", () => {
  const quest = createQuest("Emergent sub-quest", QID, PARENT_QID);
  quest.phase = "implementing";
  quest.contract = {
    qid: QID,
    parentQid: PARENT_QID,
    title: "Emergent fix",
    assignedRequirements: [],
    allowedPaths: [], // Empty list
    requiredTestCommands: [],
    acceptanceCriteria: [],
  };

  check(isPathAllowedByContract(quest.contract, "mods/song/parser.c"), "empty paths allows song parser");
  check(isPathAllowedByContract(quest.contract, "src/anything.ts"), "empty paths allows anything");

  const write1 = ref("edit", "write", "mods/song/parser.c");
  check(decide(quest, write1).allowed, "write allowed when allowedPaths is empty");

  // Also when allowedPaths is undefined
  const unconstrainedContract: SubQuestContract = {
    qid: QID,
    parentQid: PARENT_QID,
    title: "Unconstrained fix",
    assignedRequirements: [],
    allowedPaths: undefined as unknown as string[],
    requiredTestCommands: [],
    acceptanceCriteria: [],
  };
  check(isPathAllowedByContract(unconstrainedContract, "mods/song/parser.c"), "undefined allowedPaths allows path");
});

