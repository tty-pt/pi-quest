import type { QuestDifficulty } from "../domain/quest.ts";
import type { RouterConfig, ModelSpec } from "../router/types.ts";
import type { DraftQualityConfig } from "../drafting/quality-config.ts";

export type { QuestDifficulty, RouterConfig, ModelSpec };

export interface PolicyRule {
  pattern: string;
  policy: ReviewPolicy;
}

export interface DraftThresholds {
  requirements: number;
  evidence: number;
}

export type EmbedMode = "auto" | "off";
export type DifficultyMode = "auto" | "judge" | "off";

export type DifficultyThresholds = Record<QuestDifficulty, DraftThresholds>;

export interface InterfaceBindings {
  reviewRunner: { tool: string };
}

export type StatusStyle = "icon" | "text";
export type JudgeMode = "auto" | "systemone" | "off";
export type JudgeProtocol = "auto" | "systemzero" | "systemone";
export type JudgeFallback = "skip";
export type ReviewPolicy = "strict" | "balanced" | "off";
export type ApprovalMode = "select" | "input" | "chat";

export interface LintRule {
  id: string;
  filePattern?: string;
  excludeFilePattern?: string;
  excludeLinePattern?: string;
  linePattern: string;
  message: string;
}

export interface ActionRule {
  name?: string;
  scope?: string;
  pattern: string;
  buildCommands?: string[];
  testCommands?: string[];
  warning?: string;
}

export type MidQuestMode = "hybrid" | "autonomous" | "interactive" | "off";
export type SubQuestAction = "queue_backlog" | "preempt_now" | "ask_human";

export type SubquestCompactionMode = "auto" | "always" | "never";

export interface SubquestCompactionConfig {
  mode: SubquestCompactionMode;
  minTurnsToCompact: number;
  minTokensToCompact: number;
}

export interface MidQuestConfig {
  mode: MidQuestMode;
  subquestAction: SubQuestAction;
  autoAmendRequirements: boolean;
  turnInjection: boolean;
  promptTimeoutMs: number;
}

export type WorktreeMode = "auto" | "pool" | "subquests_only" | "manual" | "off";
export type SquashOnArchiveMode = "ask_human" | "auto" | "manual";

export interface GitWorkflowConfig {
  worktreeMode: WorktreeMode;
  autoSubmodules: boolean;
  milestoneCommits: boolean;
  squashOnArchive: SquashOnArchiveMode;
  featureBranchPrefix: string;
  testInPrimaryWorkspace: boolean;
  worktreePoolSize: number;
  worktreePoolMaxSize: number;
  worktreePoolDir: string;
}

export interface RoleModels {
  reviewer?: string;
  validator?: string;
  judge?: string;
  reviewerChain?: string[];
  validatorChain?: string[];
}

export interface QuestConfig {
  enabled: boolean;
  askTimeoutMs: number;
  depthCap: number;
  draftThresholds: DraftThresholds;
  difficultyMode: DifficultyMode;
  defaultDifficulty: QuestDifficulty;
  difficultyThresholds: DifficultyThresholds;
  bindings: InterfaceBindings;
  statusStyle: StatusStyle;
  autoArchive: boolean;
  approvalGate: boolean;
  approvalMode: ApprovalMode;
  policyNote?: string;
  reviewPolicy: ReviewPolicy;
  policyByModel: PolicyRule[];
  modelAccuracy: Record<string, number>;
  strictMode: boolean;
  reviewerModel?: string;
  validatorModel?: string;
  roles: RoleModels;
  reviewInactivityMs: number;
  reviewMaxDurationMs: number;
  planRevisionInactivityMs: number;
  planRevisionMaxDurationMs: number;
  planEditor: string;
  draftQuality: DraftQualityConfig;
  judgeMode: JudgeMode;
  judgeProtocol: JudgeProtocol;
  judgeUrl?: string;
  judgeModel: string;
  judgeKey?: string;
  judgeFallback: JudgeFallback;
  judgeTimeoutMs: number;
  embedMode: EmbedMode;
  embedUrl?: string;
  embedModel: string;
  intentMinMargin: number;
  intentMinSimilarity: number;
  intentExemplars: Record<string, string[]>;
  questMinMargin: number;
  difficultyMinMargin: number;
  difficultyExemplars: Record<string, string[]>;
  questExemplars: Record<string, string[]>;
  triggerPrefixes: string[];
  steeringPhrases: string[];
  testCommands: string[];
  actionMatrix: ActionRule[];
  lintRules: LintRule[];
  autoStartAuren: boolean;
  autoDownloadModels: "auto" | "ask" | "never";
  midQuest: MidQuestConfig;
  gitWorkflow: GitWorkflowConfig;
  router: RouterConfig;
  subquestCompaction: SubquestCompactionConfig;
}
