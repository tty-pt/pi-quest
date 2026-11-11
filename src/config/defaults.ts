import type {
  DifficultyThresholds,
  GitWorkflowConfig,
  MidQuestConfig,
  QuestConfig,
  SubquestCompactionConfig,
} from "./schema";
import type { RouterConfig } from "../router/types";
import { DEFAULT_DRAFT_QUALITY } from "../drafting/quality-config";

export const DEFAULT_DIFFICULTY_THRESHOLDS: DifficultyThresholds = {
  trivial: { requirements: 1, evidence: 2 },
  minor: { requirements: 1, evidence: 4 },
  standard: { requirements: 2, evidence: 7 },
  major: { requirements: 3, evidence: 9 },
  complex: { requirements: 4, evidence: 12 },
};

export const DEFAULT_MID_QUEST_CONFIG: MidQuestConfig = {
  mode: "hybrid",
  subquestAction: "queue_backlog",
  autoAmendRequirements: true,
  turnInjection: true,
  promptTimeoutMs: 10000,
};

export const DEFAULT_SUBQUEST_COMPACTION_CONFIG: SubquestCompactionConfig = {
  mode: "auto",
  minTurnsToCompact: 3,
  minTokensToCompact: 30000,
};

export const DEFAULT_GIT_WORKFLOW_CONFIG: GitWorkflowConfig = {
  worktreeMode: "auto",
  autoSubmodules: true,
  milestoneCommits: true,
  squashOnArchive: "ask_human",
  featureBranchPrefix: "quest/",
  testInPrimaryWorkspace: false,
  worktreePoolSize: 4,
  worktreePoolMaxSize: 8,
  worktreePoolDir: ".pi/scratch",
};

export const DEFAULT_TRIGGER_PREFIXES: string[] = [
  "quest:",
  "task:",
  "fix:",
  "feat:",
  "refactor:",
  "chore:",
  "test:",
  "@quest",
  "!quest",
];

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  enabled: false,
  provider: "quest",
  id: "auto",
  name: "Quest Auto Router",
  default: "antigravity/gemini-3.8-flash",
  direct: "antigravity/gemini-3.8-flash",
  cooldownMs: 900000,
  matrix: {},
};

export const DEFAULT_CONFIG: QuestConfig = {
  enabled: false,
  askTimeoutMs: 300000,
  depthCap: 3,
  draftThresholds: { requirements: 2, evidence: 7 },
  difficultyMode: "auto",
  defaultDifficulty: "standard",
  difficultyThresholds: DEFAULT_DIFFICULTY_THRESHOLDS,
  bindings: {
    reviewRunner: { tool: "subagent" },
  },
  statusStyle: "icon",
  autoArchive: true,
  approvalGate: true,
  approvalMode: "select",
  reviewPolicy: "strict",
  policyByModel: [],
  modelAccuracy: {},
  strictMode: false,
  roles: {
    reviewerChain: [],
    validatorChain: [],
  },
  reviewInactivityMs: 300000,
  reviewMaxDurationMs: 1500000,
  planRevisionInactivityMs: 300000,
  planRevisionMaxDurationMs: 1500000,
  planEditor: "",
  draftQuality: DEFAULT_DRAFT_QUALITY,
  judgeMode: "auto",
  judgeProtocol: "auto",
  judgeModel: "default",
  judgeFallback: "skip",
  judgeTimeoutMs: 60000,
  embedMode: "auto",
  embedUrl: undefined,
  embedModel: "bge-base",
  intentMinMargin: 0.075,
  intentMinSimilarity: 0.6,
  intentExemplars: {},
  questMinMargin: 0.05,
  difficultyMinMargin: 0.075,
  difficultyExemplars: {},
  triggerPrefixes: DEFAULT_TRIGGER_PREFIXES,
  steeringPhrases: [],
  testCommands: [],
  actionMatrix: [],
  lintRules: [],
  autoStartAuren: true,
  autoDownloadModels: "ask",
  midQuest: DEFAULT_MID_QUEST_CONFIG,
  gitWorkflow: DEFAULT_GIT_WORKFLOW_CONFIG,
  router: DEFAULT_ROUTER_CONFIG,
  subquestCompaction: DEFAULT_SUBQUEST_COMPACTION_CONFIG,
  questExemplars: {},
};
