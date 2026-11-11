export {
  findRepoRoot,
  findGitCommonDir,
  findPrimaryRepoRoot,
  isGitWorktree,
} from "./root";

export {
  runGit,
  getGitHead,
  getModifiedSubmodules,
  sleep,
} from "./exec";

export {
  createWorktree,
  mergeWorktreeBranch,
  removeWorktree,
  setupWorktreeEnvironment,
  type CreateWorktreeOptions,
} from "./worktree";

export {
  hasSubmodules,
  initWorktreeSubmodules,
  commitDirtySubmodules,
  syncWorktreeSubmodulesToPrimary,
  rebaseSubmoduleBranch,
  restoreSubmoduleWorktrees,
  pruneSubmoduleWorktrees,
  EMPTY_TREE_SHA,
  guardSubmoduleWorkingTree,
  alignPrimarySubmoduleBranches,
} from "./submodules";

export { squashSubmoduleCommits, retainSlotLease } from "./pool-rescue";

export {
  acquireWarmSlot,
  releaseWarmSlot,
  initializeSlot,
  sanitizeSlot,
  auditAndReclaimPool,
  readSlotLease,
  writeSlotLease,
  rescueDirtySlotIfNeeded,
  ensureQuestWorktreeAttached,
  type SlotLease,
  type PoolAcquireResult,
  type PoolProgressNotifier,
  type SanitizeSlotOptions,
  type ReleaseSlotOptions,
} from "./pool";

export {
  commitMilestone,
  type MilestoneSpec,
  type MilestoneCommitResult,
  type MilestoneType,
} from "./milestones";

export {
  getBranchCommitSummaries,
  getBranchDiffStat,
  synthesizeSquashCommitMessage,
  squashMergeBranch,
  confirmAndSquashWorktree,
  preflightWorktreeIntegration,
  promptConflictResolution,
  type SquashSummaryParams,
  type ConfirmAndSquashOptions,
  type PreflightCheckResult,
} from "./squash";

export {
  MAX_DIFF_CHARS,
  captureUnifiedDiff,
  type UnifiedChangesResult,
  type DiffOptions,
} from "./diff";

export {
  acquireWorkspaceLock,
  releaseWorkspaceLock,
  withWorkspaceLock,
  type WorkspaceLockInfo,
} from "./workspace-lock";

export {
  isWorkspaceDirty,
  getCurrentRef,
  stashDirtyWorkspace,
  restoreWorkspaceState,
  runTestInPrimaryWorkspace,
  execTestShell,
  type TestExecutionResult,
} from "./workspace-runner";

export {
  syncHarnessCwd,
  getPrimaryRoot,
  resetPrimaryRootCache,
} from "./harness-cwd";
