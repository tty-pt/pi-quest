# Git Worktree & Submodule Architecture Audit Findings

This document records the adversarial audit of `pi-quest`'s git worktree, submodule, and testing architecture, detailing the failure modes identified, their root causes, and the architectural hardening implemented in Quest `1xQQMV`.

---

## 1. Worktree Diff Blindspots (`lifecycle.ts` & `diff.ts`)

### Root Cause
* In `src/surface/tools/handlers/lifecycle.ts` (`buildDiffResolvers`), `git diff` was hardcoded to execute in `{ cwd: ctx.cwd }` (`primaryRoot`).
* In `src/utils/git/diff.ts` (`classifyRepos`), submodule inspection only scanned `primaryRoot` via `getModifiedSubmodules(primaryRoot)`.

### Impact & Failure Mode
* If the human operator's branch in the primary workspace was clean, an agent completing work in an isolated worktree would be rejected by `claimComplete` with:
  `Cannot claim completion: No files have been modified.`
* Conversely, if the human operator had uncommitted edits in the primary workspace on their own branch, those unrelated edits leaked into the validator's review brief (`validationBrief`) rather than the agent's worktree diff.

### Hardening
* Anchor `buildDiffResolvers` directly to `state.worktreePath ?? ctx.cwd`.
* Pass `worktreePath` to `classifyRepos` so submodules modified inside the worktree are detected and included in `captureUnifiedDiff`.

---

## 2. Broken Offline Submodule Alternates Initialization (`submodules.ts`)

### Root Cause
* In `src/utils/git/submodules.ts` (`initWorktreeSubmodules`), Step 2 checked `existsSync(candidate)` for `.git/worktrees/<qid>/modules/<subPath>` *before* running `submodule update`.
* Because `git submodule init` only populates `.git/config` and does not create the submodule's worktree gitdir, `candidate` never existed at this point. The alternates file was never written.

### Impact & Failure Mode
* Step 3 subsequently ran `git submodule update --init --recursive --no-fetch`.
* If the parent repository referenced an **unpushed local commit** in a submodule, Git attempted to clone from the remote origin URL, which failed with:
  `fatal: git upload-pack: not our ref <sha>`

### Hardening
* In `initWorktreeSubmodules`, initialize submodules using native worktrees from the primary repository's submodule store (`git -C <primarySubPath> worktree add --detach <wtSubPath> <sha>`).
* This achieves instantaneous zero-network checkouts, directly shares canonical `.git/modules/<subPath>` storage, and never fails on local unpushed commits.

---

## 3. Phantom Worker Subagents on Subquests (`subquest.ts`)

### Root Cause
* In `src/surface/tools/subquest.ts` (`subquestTool`), when `switchNow: true` was set, the active quest session stacked the parent and transitioned into the child quest (`replaceState(child)`).
* Simultaneously, it invoked `delegateSubQuestToSubagent()`, which fired `prompt-template:subagent:request`.
* No handler listened to `prompt-template:subagent:response` for subquests.

### Impact & Failure Mode
* The primary session implemented the subquest while an unmonitored background subagent simultaneously made edits in the exact same worktree directory.
* The background subagent's result was dropped, while file collisions occurred between the two concurrent workers.

### Hardening
* Remove the phantom `delegateSubQuestToSubagent` call when `switchNow: true`. The active session owns the child quest frame on the stack.

---

## 4. Destructive Primary Workspace Cleanup (`workspace-runner.ts`)

### Root Cause
* In `src/utils/git/workspace-runner.ts` (`restoreWorkspaceState`), the teardown logic executed:
  ```bash
  git reset --hard HEAD
  git clean -fd
  ```
  in the primary workspace under the intention of "clearing test build artifacts."

### Impact & Failure Mode
* If a test was run in the primary workspace and the human operator had untracked scratch files, experimental files, or uncommitted scripts in their workspace that were not part of the temporary stash, `git clean -fd` permanently and irreversibly deleted them.

### Hardening
* Remove `git reset --hard HEAD` and `git clean -fd` from `restoreWorkspaceState`. Safe restoration relies strictly on stash pop and checking out the original reference.

---

## 5. Tool Interception Gaps (`interception.ts`)

### Root Cause
* `installToolInterception` only intercepted `bash`, `read`, `write`, and `edit`.
* `bg_run` was not intercepted, defaulting its execution directory to `ctx.cwd` (`primaryRoot`).
* `rewriteBashCommandToWorktree` allowed commands containing `cd <primaryRoot>` to escape the worktree subshell.

### Impact & Failure Mode
* Background processes started by agents ran in the primary workspace rather than the worktree.
* Shell commands could escape worktree confinement by changing directory.

### Hardening
* Intercept `bg_run` tool calls and ensure background tasks are jailed to `worktreePath`.
* Strip or constrain directory escapes in shell command wrapping.

---

## 6. Submodule Desync on Subquest Archiving (`hierarchy.ts`)

### Root Cause
* In `src/surface/tools/archive/hierarchy.ts` (`cleanupWorktree`), subquests with independent worktrees (`wtPath !== parentWtPath`) were squash-merged and removed via `removeWorktree` without calling `syncWorktreeSubmodulesToPrimary`.

### Impact & Failure Mode
* Submodule commits created by subquests in independent worktrees were vaporized upon subquest completion when `git worktree remove --force` was called.

### Hardening
* Wire `syncWorktreeSubmodulesToPrimary(primaryRoot, wtPath, wtBranch, pi)` inside `hierarchy.ts:cleanupWorktree` before worktree removal.
