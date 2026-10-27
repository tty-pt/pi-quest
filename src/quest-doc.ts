// HIGH_LEVEL: #validation — re-export quest-doc I/O adapter from durability slice.
export {
  readQuestDoc,
  reconcileParentDocOnReturn,
  setDocStatus,
} from "./durability/quest-doc-io.ts";
