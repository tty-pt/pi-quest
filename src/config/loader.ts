import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findPrimaryRepoRoot } from "../utils/git/root";
import type {
  ApprovalMode,
  DifficultyMode,
  DifficultyThresholds,
  DraftThresholds,
  GitWorkflowConfig,
  MidQuestConfig,
  MidQuestMode,
  QuestConfig,
  QuestDifficulty,
  ReviewPolicy,
  RoleModels,
  SquashOnArchiveMode,
  SubQuestAction,
  SubquestCompactionConfig,
  SubquestCompactionMode,
  WorktreeMode,
} from "./schema";
import {
  DEFAULT_CONFIG,
  DEFAULT_DIFFICULTY_THRESHOLDS,
  DEFAULT_GIT_WORKFLOW_CONFIG,
  DEFAULT_MID_QUEST_CONFIG,
  DEFAULT_SUBQUEST_COMPACTION_CONFIG,
} from "./defaults";
import {
  dedupe,
  getEnv,
  parseActionMatrix,
  parseExemplars,
  parseLintRules,
  parseModelList,
  parsePolicyRules,
  stringList,
  unitInterval,
} from "./env";
import { loadJudgeConfig, loadRouterConfig } from "./subsystems";
import { parseDraftQuality } from "../drafting/quality-config";

function buildDiffThresholds(
  record: Record<string, unknown>,
  draftThresholds: DraftThresholds,
): DifficultyThresholds {
  const raw = record["difficultyThresholds"] as Record<string, unknown> | undefined;
  const parseTier = (tier: QuestDifficulty, fallback: DraftThresholds): DraftThresholds => {
    const obj = raw?.[tier] as Record<string, unknown> | undefined;
    return {
      requirements: typeof obj?.["requirements"] === "number" ? obj["requirements"] : fallback.requirements,
      evidence: typeof obj?.["evidence"] === "number" ? obj["evidence"] : fallback.evidence,
    };
  };
  return {
    trivial: parseTier("trivial", DEFAULT_DIFFICULTY_THRESHOLDS.trivial),
    minor: parseTier("minor", DEFAULT_DIFFICULTY_THRESHOLDS.minor),
    standard: parseTier("standard", draftThresholds),
    major: parseTier("major", DEFAULT_DIFFICULTY_THRESHOLDS.major),
    complex: parseTier("complex", DEFAULT_DIFFICULTY_THRESHOLDS.complex),
  };
}

function buildRolesConfig(record: Record<string, unknown>, defaultJudgeModel: string): {
  roles: RoleModels;
  reviewerModel?: string;
  validatorModel?: string;
} {
  const rawRoles = (typeof record["roles"] === "object" && record["roles"] !== null)
    ? (record["roles"] as Record<string, unknown>)
    : {};
  const reviewerList = parseModelList(rawRoles["reviewer"]);
  const reviewerModel = reviewerList[0] ?? (
    typeof record["reviewerModel"] === "string" && record["reviewerModel"].trim() !== ""
      ? record["reviewerModel"].trim()
      : getEnv("PI_QUEST_REVIEWER_MODEL") ?? getEnv("PI_REVIEW_MODEL")
  );
  const validatorList = parseModelList(rawRoles["validator"]);
  const validatorModel = validatorList[0] ?? (
    typeof record["validatorModel"] === "string" && record["validatorModel"].trim() !== ""
      ? record["validatorModel"].trim()
      : getEnv("PI_QUEST_VALIDATOR_MODEL") ?? getEnv("PI_VALIDATOR_MODEL")
  );
  const judgeModelOverride = parseModelList(rawRoles["judge"])[0] ?? defaultJudgeModel;
  return {
    reviewerModel,
    validatorModel,
    roles: {
      reviewer: reviewerModel,
      validator: validatorModel,
      judge: judgeModelOverride,
      reviewerChain: dedupe(reviewerList.slice(1)),
      validatorChain: dedupe(validatorList.slice(1)),
    },
  };
}

function buildMidQuest(record: Record<string, unknown>): MidQuestConfig {
  const raw = (typeof record["midQuest"] === "object" && record["midQuest"] !== null)
    ? (record["midQuest"] as Record<string, unknown>)
    : {};
  const rawMode = raw["mode"] ?? getEnv("PI_QUEST_MID_QUEST_MODE");
  const mode: MidQuestMode = (rawMode === "hybrid" || rawMode === "autonomous" || rawMode === "interactive" || rawMode === "off")
    ? rawMode : DEFAULT_MID_QUEST_CONFIG.mode;
  const rawAction = raw["subquestAction"] ?? getEnv("PI_QUEST_MID_QUEST_SUBQUEST_ACTION");
  const subquestAction: SubQuestAction = (rawAction === "queue_backlog" || rawAction === "preempt_now" || rawAction === "ask_human")
    ? rawAction : DEFAULT_MID_QUEST_CONFIG.subquestAction;
  return {
    mode,
    subquestAction,
    autoAmendRequirements: typeof raw["autoAmendRequirements"] === "boolean" ? raw["autoAmendRequirements"] : DEFAULT_MID_QUEST_CONFIG.autoAmendRequirements,
    turnInjection: typeof raw["turnInjection"] === "boolean" ? raw["turnInjection"] : DEFAULT_MID_QUEST_CONFIG.turnInjection,
    promptTimeoutMs: typeof raw["promptTimeoutMs"] === "number" && raw["promptTimeoutMs"] > 0 ? raw["promptTimeoutMs"] : DEFAULT_MID_QUEST_CONFIG.promptTimeoutMs,
  };
}

function buildSubquestCompaction(record: Record<string, unknown>): SubquestCompactionConfig {
  const raw = (typeof record["subquestCompaction"] === "object" && record["subquestCompaction"] !== null)
    ? (record["subquestCompaction"] as Record<string, unknown>)
    : (typeof record["subquests"] === "object" && record["subquests"] !== null)
    ? (record["subquests"] as Record<string, unknown>)
    : {};
  const rawMode = raw["mode"] ?? raw["compactOnReturn"] ?? getEnv("PI_QUEST_SUBQUEST_COMPACT_MODE");
  const mode: SubquestCompactionMode = (rawMode === "auto" || rawMode === "always" || rawMode === "never")
    ? rawMode : DEFAULT_SUBQUEST_COMPACTION_CONFIG.mode;
  const rawTurns = typeof raw["minTurnsToCompact"] === "number" ? raw["minTurnsToCompact"] : Number(getEnv("PI_QUEST_SUBQUEST_COMPACT_MIN_TURNS"));
  const minTurnsToCompact = !isNaN(rawTurns) && rawTurns >= 0 ? rawTurns : DEFAULT_SUBQUEST_COMPACTION_CONFIG.minTurnsToCompact;
  const rawTokens = typeof raw["minTokensToCompact"] === "number" ? raw["minTokensToCompact"] : Number(getEnv("PI_QUEST_SUBQUEST_COMPACT_MIN_TOKENS"));
  const minTokensToCompact = !isNaN(rawTokens) && rawTokens >= 0 ? rawTokens : DEFAULT_SUBQUEST_COMPACTION_CONFIG.minTokensToCompact;
  return {
    mode,
    minTurnsToCompact,
    minTokensToCompact,
  };
}

function buildGitWorkflow(record: Record<string, unknown>): GitWorkflowConfig {
  const raw = (typeof record["gitWorkflow"] === "object" && record["gitWorkflow"] !== null)
    ? (record["gitWorkflow"] as Record<string, unknown>)
    : {};
  const rawMode = raw["worktreeMode"] ?? getEnv("PI_QUEST_WORKTREE_MODE");
  const worktreeMode: WorktreeMode = (rawMode === "auto" || rawMode === "pool" || rawMode === "subquests_only" || rawMode === "manual" || rawMode === "off")
    ? rawMode : DEFAULT_GIT_WORKFLOW_CONFIG.worktreeMode;
  const rawSubmodules = raw["autoSubmodules"] ?? getEnv("PI_QUEST_AUTO_SUBMODULES");
  const autoSubmodules = typeof rawSubmodules === "boolean" ? rawSubmodules : (rawSubmodules === "0" || rawSubmodules === "false") ? false : DEFAULT_GIT_WORKFLOW_CONFIG.autoSubmodules;
  const rawCommits = raw["milestoneCommits"] ?? getEnv("PI_QUEST_MILESTONE_COMMITS");
  const milestoneCommits = typeof rawCommits === "boolean" ? rawCommits : (rawCommits === "0" || rawCommits === "false") ? false : DEFAULT_GIT_WORKFLOW_CONFIG.milestoneCommits;
  const rawSquash = raw["squashOnArchive"] ?? getEnv("PI_QUEST_SQUASH_ON_ARCHIVE");
  const squashOnArchive: SquashOnArchiveMode = (rawSquash === "ask_human" || rawSquash === "auto" || rawSquash === "manual")
    ? rawSquash : DEFAULT_GIT_WORKFLOW_CONFIG.squashOnArchive;
  const rawPrefix = typeof raw["featureBranchPrefix"] === "string" && raw["featureBranchPrefix"].trim() !== ""
    ? raw["featureBranchPrefix"].trim() : DEFAULT_GIT_WORKFLOW_CONFIG.featureBranchPrefix;
  const rawTestMain = raw["testInPrimaryWorkspace"] ?? getEnv("PI_QUEST_TEST_IN_PRIMARY_WORKSPACE");
  const testInPrimaryWorkspace = typeof rawTestMain === "boolean"
    ? rawTestMain
    : (rawTestMain === "1" || rawTestMain === "true")
    ? true
    : (rawTestMain === "0" || rawTestMain === "false")
    ? false
    : DEFAULT_GIT_WORKFLOW_CONFIG.testInPrimaryWorkspace;

  const rawPoolSize = raw["worktreePoolSize"] ?? getEnv("PI_QUEST_WORKTREE_POOL_SIZE");
  const worktreePoolSize = typeof rawPoolSize === "number" && rawPoolSize > 0
    ? rawPoolSize
    : typeof rawPoolSize === "string" && !isNaN(parseInt(rawPoolSize, 10)) && parseInt(rawPoolSize, 10) > 0
    ? parseInt(rawPoolSize, 10)
    : DEFAULT_GIT_WORKFLOW_CONFIG.worktreePoolSize;

  const rawPoolMaxSize = raw["worktreePoolMaxSize"] ?? getEnv("PI_QUEST_WORKTREE_POOL_MAX_SIZE");
  const worktreePoolMaxSize = typeof rawPoolMaxSize === "number" && rawPoolMaxSize >= worktreePoolSize
    ? rawPoolMaxSize
    : typeof rawPoolMaxSize === "string" && !isNaN(parseInt(rawPoolMaxSize, 10)) && parseInt(rawPoolMaxSize, 10) >= worktreePoolSize
    ? parseInt(rawPoolMaxSize, 10)
    : Math.max(worktreePoolSize, DEFAULT_GIT_WORKFLOW_CONFIG.worktreePoolMaxSize);

  const rawPoolDir = typeof raw["worktreePoolDir"] === "string" && raw["worktreePoolDir"].trim() !== ""
    ? raw["worktreePoolDir"].trim()
    : DEFAULT_GIT_WORKFLOW_CONFIG.worktreePoolDir;

  return {
    worktreeMode,
    autoSubmodules,
    milestoneCommits,
    squashOnArchive,
    featureBranchPrefix: rawPrefix,
    testInPrimaryWorkspace,
    worktreePoolSize,
    worktreePoolMaxSize,
    worktreePoolDir: rawPoolDir,
  };
}

function parseModelAccuracy(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [pattern, val] of Object.entries(raw)) {
      const num = typeof val === "number" ? val : typeof val === "string" ? Number(val) : NaN;
      if (!isNaN(num) && num > 0 && num <= 1) out[pattern.trim()] = num;
    }
  }
  return out;
}

function buildDraftThresholds(r: Record<string, unknown>): DraftThresholds {
  const thresholds = r["draftThresholds"] as Record<string, unknown> | undefined;
  return {
    requirements: typeof thresholds?.["requirements"] === "number" ? thresholds["requirements"] as number : DEFAULT_CONFIG.draftThresholds.requirements,
    evidence: typeof thresholds?.["evidence"] === "number" ? thresholds["evidence"] as number : DEFAULT_CONFIG.draftThresholds.evidence,
  };
}

function buildApprovalConfig(r: Record<string, unknown>): { approvalGate: boolean; approvalMode: ApprovalMode } {
  const rawApproval = r["approvalGate"] ?? getEnv("PI_QUEST_APPROVAL_GATE");
  const approvalGate = (rawApproval === false || rawApproval === "0" || rawApproval === "false") ? false : true;
  const rawApprovalMode = r["approvalMode"] ?? getEnv("PI_QUEST_APPROVAL_MODE");
  const approvalMode: ApprovalMode = (rawApprovalMode === "select" || rawApprovalMode === "input" || rawApprovalMode === "chat")
    ? rawApprovalMode : DEFAULT_CONFIG.approvalMode;
  return { approvalGate, approvalMode };
}

function buildEnabledConfig(r: Record<string, unknown>): boolean {
  const rawEnabled = r["enabled"] ?? r["startEnabled"] ?? getEnv("PI_QUEST_ENABLED");
  if (typeof rawEnabled === "boolean") return rawEnabled;
  if (rawEnabled === "1" || rawEnabled === "true") return true;
  if (rawEnabled === "0" || rawEnabled === "false") return false;
  const rawDisabled = r["disabled"] ?? r["startDisabled"] ?? getEnv("PI_QUEST_DISABLED");
  if (typeof rawDisabled === "boolean") return !rawDisabled;
  if (rawDisabled === "1" || rawDisabled === "true") return false;
  if (rawDisabled === "0" || rawDisabled === "false") return true;
  return DEFAULT_CONFIG.enabled;
}

export function loadConfig(raw: unknown): QuestConfig {
  if (typeof raw !== "object" || raw === null) return DEFAULT_CONFIG;
  const r = raw as Record<string, unknown>;
  const enabled = buildEnabledConfig(r);
  const judge = loadJudgeConfig(r);
  const { roles, reviewerModel, validatorModel } = buildRolesConfig(r, judge.judgeModel);
  if (roles.judge) judge.judgeModel = roles.judge;

  const rawDiff = r["difficultyMode"] ?? getEnv("PI_QUEST_DIFFICULTY_MODE");
  const difficultyMode: DifficultyMode = (rawDiff === "auto" || rawDiff === "judge" || rawDiff === "off") ? rawDiff : DEFAULT_CONFIG.difficultyMode;
  const rawDefDiff = r["defaultDifficulty"] ?? getEnv("PI_QUEST_DEFAULT_DIFFICULTY");
  const defaultDifficulty: QuestDifficulty = (rawDefDiff === "trivial" || rawDefDiff === "standard" || rawDefDiff === "complex") ? rawDefDiff : DEFAULT_CONFIG.defaultDifficulty;
  const draftThresholds = buildDraftThresholds(r);

  const rawPolicy = r["reviewPolicy"] ?? getEnv("PI_QUEST_REVIEW_POLICY");
  const reviewPolicy: ReviewPolicy = (rawPolicy === "strict" || rawPolicy === "balanced" || rawPolicy === "off") ? rawPolicy : DEFAULT_CONFIG.reviewPolicy;
  const rawStrict = r["strictMode"] ?? getEnv("PI_QUEST_STRICT_MODE");
  const strictMode = typeof rawStrict === "boolean" ? rawStrict : (rawStrict === "1" || rawStrict === "true");
  const { approvalGate, approvalMode } = buildApprovalConfig(r);

  const rawEmbedUrl = r["embedUrl"] ?? getEnv("PI_QUEST_EMBED_URL") ?? judge.judgeUrl ?? "http://127.0.0.1:4242";
  const rawEmbedModel = r["embedModel"] ?? getEnv("PI_QUEST_EMBED_MODEL");
  const bindings = r["bindings"] as Record<string, unknown> | undefined;

  const cfg: QuestConfig = {
    enabled,
    askTimeoutMs: typeof r["askTimeoutMs"] === "number" ? r["askTimeoutMs"] : DEFAULT_CONFIG.askTimeoutMs,
    depthCap: typeof r["depthCap"] === "number" ? r["depthCap"] : DEFAULT_CONFIG.depthCap,
    statusStyle: r["statusStyle"] === "icon" || r["statusStyle"] === "text" ? r["statusStyle"] : DEFAULT_CONFIG.statusStyle,
    autoArchive: typeof r["autoArchive"] === "boolean" ? r["autoArchive"] : DEFAULT_CONFIG.autoArchive,
    approvalGate,
    approvalMode,
    reviewPolicy,
    strictMode,
    policyByModel: parsePolicyRules(r["policyByModel"] ?? getEnv("PI_QUEST_POLICY_BY_MODEL")),
    modelAccuracy: parseModelAccuracy(r["modelAccuracy"]),
    draftQuality: parseDraftQuality(r["draftQuality"] ?? getEnv("PI_QUEST_DRAFT_QUALITY")),
    reviewerModel,
    validatorModel,
    roles,
    draftThresholds,
    difficultyMode,
    defaultDifficulty,
    difficultyThresholds: buildDiffThresholds(r, draftThresholds),
    bindings: {
      reviewRunner: {
        tool: typeof (bindings?.["reviewRunner"] as Record<string, unknown> | undefined)?.["tool"] === "string"
          ? (bindings?.["reviewRunner"] as Record<string, unknown>)["tool"] as string
          : DEFAULT_CONFIG.bindings.reviewRunner.tool,
      },
    },
    reviewInactivityMs: typeof r["reviewInactivityMs"] === "number" ? r["reviewInactivityMs"] : DEFAULT_CONFIG.reviewInactivityMs,
    reviewMaxDurationMs: typeof r["reviewMaxDurationMs"] === "number" ? r["reviewMaxDurationMs"] : DEFAULT_CONFIG.reviewMaxDurationMs,
    planRevisionInactivityMs: typeof r["planRevisionInactivityMs"] === "number" ? r["planRevisionInactivityMs"] : DEFAULT_CONFIG.planRevisionInactivityMs,
    planRevisionMaxDurationMs: typeof r["planRevisionMaxDurationMs"] === "number" ? r["planRevisionMaxDurationMs"] : DEFAULT_CONFIG.planRevisionMaxDurationMs,
    planEditor: typeof r["planEditor"] === "string" ? r["planEditor"] : DEFAULT_CONFIG.planEditor,
    midQuest: buildMidQuest(r),
    gitWorkflow: buildGitWorkflow(r),
    router: loadRouterConfig(r),
    subquestCompaction: buildSubquestCompaction(r),
    ...judge,
    embedMode: (r["embedMode"] ?? getEnv("PI_QUEST_EMBED_MODE")) === "off" ? "off" : "auto",
    embedUrl: typeof rawEmbedUrl === "string" && rawEmbedUrl.trim() !== "" ? rawEmbedUrl.trim() : "http://127.0.0.1:4242",
    embedModel: typeof rawEmbedModel === "string" && rawEmbedModel.trim() !== "" ? rawEmbedModel.trim() : DEFAULT_CONFIG.embedModel,
    intentMinMargin: unitInterval(r["intentMinMargin"] ?? getEnv("PI_QUEST_INTENT_MIN_MARGIN"), DEFAULT_CONFIG.intentMinMargin),
    intentMinSimilarity: unitInterval(r["intentMinSimilarity"] ?? getEnv("PI_QUEST_INTENT_MIN_SIMILARITY"), DEFAULT_CONFIG.intentMinSimilarity),
    intentExemplars: parseExemplars(r["intentExemplars"]),
    questMinMargin: unitInterval(r["questMinMargin"] ?? getEnv("PI_QUEST_QUEST_MIN_MARGIN"), DEFAULT_CONFIG.questMinMargin),
    difficultyMinMargin: unitInterval(r["difficultyMinMargin"] ?? getEnv("PI_QUEST_DIFFICULTY_MIN_MARGIN"), DEFAULT_CONFIG.difficultyMinMargin),
    difficultyExemplars: Object.fromEntries(Object.entries(parseExemplars(r["difficultyExemplars"])).filter(([k]) => k === "trivial" || k === "standard" || k === "complex")),
    questExemplars: Object.fromEntries(Object.entries(parseExemplars(r["questExemplars"])).filter(([k]) => k === "quest" || k === "conversation")),
    steeringPhrases: stringList(r["steeringPhrases"]),
    testCommands: stringList(r["testCommands"]),
    actionMatrix: parseActionMatrix(r["actionMatrix"]),
    lintRules: parseLintRules(r["lintRules"]),
  };
  lastConfig = cfg;
  return cfg;
}

let lastConfig: QuestConfig | null = null;

export function getLastLoadedConfig(): QuestConfig {
  return lastConfig ?? DEFAULT_CONFIG;
}

export async function readQuestSettings(cwd: string): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(cwd, ".pi", "settings.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["pi-quest"] : undefined;
  } catch {
    return undefined;
  }
}

export async function readQuestConfig(cwd: string): Promise<QuestConfig> {
  const root = findPrimaryRepoRoot(cwd);
  try {
    const raw = await readFile(join(root, ".pi", "settings.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_CONFIG;
    return loadConfig((parsed as Record<string, unknown>)["pi-quest"]);
  } catch {
    if (root !== cwd) {
      try {
        const raw = await readFile(join(cwd, ".pi", "settings.json"), "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return DEFAULT_CONFIG;
        return loadConfig((parsed as Record<string, unknown>)["pi-quest"]);
      } catch {
        return DEFAULT_CONFIG;
      }
    }
    return DEFAULT_CONFIG;
  }
}
