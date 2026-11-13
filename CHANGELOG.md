# Changelog

All notable changes to the `pi-quest` extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] (target: v1.12.0)

### Changed
- **Unified `/quest` Command Surface, `Alt+J` Shortcut & Default Disabled Mode** (`src/surface/commands/index.ts`, `src/surface/commands/quest.ts`, `src/config/defaults.ts`, `src/durability/status.ts`):
  - Consolidated all operator commands under `/quest` (`list`, `pick`, `new`, `edit`, `pause`/`on`/`toggle`, `cancel`, `del`, `handoff`, `slots`, `doctor`, `policy`, `router`, `ratings`) with tab completion and a self-explaining status card on bare `/quest`.
  - Registered `alt+j` (replacing `ctrl+q` and `alt+q`, which conflict with Pi's `app.message.followUp` and `app.message.dequeue` bindings on WSL/Windows) as the keyboard shortcut to toggle `pi-quest` on or off for the current session.
  - Defaulted `enabled` to `false` unless explicitly configured or toggled via `/quest on` (`⏸️` in status bar), and delegated model readiness status (`⚡ bge-base`) to `pi-mm`.
- **Consolidated `garden` into `/quest list` and `/quest del`** (`src/surface/commands/quests.ts`, `src/surface/commands/quest-del.ts`, `src/surface/commands/continuity.ts`, `src/surface/commands/index.ts`, `src/domain/garden.ts`):
  - Removed `/quest garden` subcommand.
  - Upgraded `/quest list` with the rich triage table from `garden` (`active`, `fresh`, `stale`, `orphan`, `empty-shell`, age in days, requirement progress, plan status, and active worktree slot) and automatic bullet deduplication.
  - Upgraded `/quest del` to delete draft/backlog quests directly by `<qid>` or heading without resuming them first, and added batch prune flags (`--all`, `--stale`, `--empty`, `--orphans`, `--days N`, `--dry-run`).
  - Added automatic `dedupeDocBullets` on quest document writes (`src/durability/quest-doc-io.ts`, `src/surface/tools/draft-writer.ts`, `src/surface/tools/handlers/provision.ts`, `src/subquests/index.ts`).
- **Removed `.pi/quest/archive/<qid>.zip` Creation** (`src/views/quest-view.ts`, `src/files.ts`, `src/surface/tools/archive.ts`):
  - Completing (`quest_archive`) or deleting (`/quest del`) a quest now cleans up `.pi/quest/future/<qid>.md` and `.pi/quest/.staging/<qid>` directly without spawning `zip` or writing `.pi/quest/archive/*.zip` files, relying on Git history and `pi-mm` episodic memory distillation.

### Added
- **Argon-First Session Routing & Conversation-Aware Quest Activation** (`src/router/engine.ts`, `src/durability/transcript.ts`, `src/drafting/detect.ts`, `src/surface/commands/quest.ts`, `src/surface/commands/quest-del.ts`):
  - Updated `routeQuestState` so when `pi-quest` is paused/disabled (`quest.disabled === true`), the virtual router uses the `"idle"` matrix rule (keeping sessions on `antigravity-acp/gemini-4-argon:high` until a quest enters active execution/review).
  - Added `extractPriorConversationObjective` and `isReferentialActivationObjective` so activating a quest after brainstorming with Argon (`"quest: Go for it."`, `/quest on`, `/quest on [goal]`, `/quest new [goal]`) automatically extracts the substantive objective and context from prior session messages and steers the agent to author `.pi/quest/future/<qid>.md` immediately.
- **Earlier Plan Authoring & Structured `[Drafter–Reviewer Dialogue]`** (`src/drafting/edits.ts`, `src/drafting/review-outcomes.ts`, `src/durability/injection.ts`):
  - Editing `.pi/quest/future/<qid>.md` while in `provisional` automatically transitions the quest to `drafting` with `planAuthored: true`.
  - Added `renderReviewerDialogue` and recorded resolved review turns in `reviewHistory` so the drafter and adversarial reviewer exchange structured `[Drafter–Reviewer Dialogue]` rounds in the background while the operator continues chatting concurrently.
- **Manual Testing in Scratch Worktrees on Completion (`keep-slot`, `squash-keep-slot`) & `/quest finish`** (`src/utils/git/squash.ts`, `src/surface/tools/archive/core.ts`, `src/surface/tools/archive.ts`, `src/surface/commands/quest-del.ts`, `src/surface/commands/index.ts`):
  - Enabled `keep-slot` (leave completed quest unmerged in `.pi/scratch/slot-N` for manual testing before merge) and `squash-keep-slot` (squash-merge into `main` while keeping `slot-N` alive) on `COMPLETED` quests via `quest_archive({ action })` and the interactive archive selector.
  - Added `/quest finish [--keep-slot]` (aliases: `/quest merge`, `/quest integrate`) to complete/integrate the active quest or squash-merge a retained scratch slot into `main` once manual testing is done.
- **Slot Retention on Delete (`/quest del --keep-slot`) & Same-Slot Quest Chaining (`/quest new`)** (`src/surface/commands/quest-del.ts`, `src/surface/commands/index.ts`, `src/surface/tools/archive/core.ts`, `src/utils/git/pool-rescue.ts`, `src/drafting/detect.ts`, `src/drafting/promote.ts`, `src/surface/tools/handlers/provision.ts`):
  - Added `--keep-slot` (`--slot`, `-s`) and interactive `"Keep work in slot (do not reset or free slot)"` option to `/quest del` so a quest can be deleted without resetting or freeing its `.pi/scratch/slot-N` worktree.
  - Added `/quest new [objective]` (aliases: `/quest chain`, `/quest next`) to retire the active/paused quest while keeping its scratch slot and branch intact, re-enable `pi-quest`, and start a brand-new quest on top of that slot's work.
- **Scratch Workspace Telemetry & Inspection** (`src/utils/git/pool-inspect.ts`, `src/surface/tools/scratches.ts`, `src/surface/commands/index.ts`):
  - Added `quest_scratches` tool and `/quest-scratches` command (with `/quest scratches` and `/quest slots` aliases) to inspect all scratch workspace slots (`.pi/scratch/slot-N`).
  - Reports slot allocation status (`idle` vs. `leased`), assigned Quest ID, checked-out branch, worker PID and liveness check (`alive` vs. `dead/orphaned`), quest objective loaded from `.pi/quest/future/<qid>.md`, current phase, in-flight review status, working-tree dirty counts (staged, unstaged, untracked), and latest commit hash/subject/date.
- **Fail-Safe Worktree Integration on `/quest-del`** (`src/surface/commands/quest-del.ts`, `src/surface/tools/archive/core.ts`, `src/surface/tools/archive/hierarchy.ts`):
  - Checkpoint commit before archive: automatically stages and commits all uncommitted changes in both the worktree and modified submodules to the quest feature branch (`quest/<qid>`) before unmounting or resetting any scratch slot.
  - Interactive integration selector when abandoning via `/quest-del`: prompts operator to "Integrate (squash-merge) into current branch", "Keep feature branch unmerged (quest/<qid>)", or "Discard changes and reset". Headless/non-interactive mode safely defaults to keeping the branch unmerged.
  - Automatic submodule commit preservation: always runs `syncWorktreeSubmodulesToPrimary` before worktree teardown so commits inside submodule worktrees are never orphaned or lost from `.git/modules/`.
- **Scratch Slot HUD & Status Line Telemetry** (`src/durability/status.ts`):
  - Overhauled status bar indicator to display active scratch slot environment and verified test passing status: `[s1]`, `[s1✓]`, `[s2]`, `[s2✓]`, `[wt]`, `[wt✓]`, replacing the static test-tube icon with actionable workspace awareness.
- **Pre-Warmed Scratch Workspace Pool & Dynamic Allocation** (`src/utils/git/pool.ts`):
  - Managed pool of pre-warmed worktrees under `.pi/scratch/slot-N` eliminating dynamic 39-submodule cloning freezes during human plan approval.
  - Dynamic elastic slot allocation scaling up to `worktreePoolMaxSize` (default 8).
  - Autonomous stale lease auditing and dead PID reclamation (`auditAndReclaimPool`).
- **Worktree Submodule Hardening & Pruning** (`src/utils/git/submodules.ts`, `src/utils/git/worktree.ts`, `src/utils/git/pool.ts`):
  - Added `syncWorktreeSubmodulesToPrimary`: fetches worktree submodule feature branches into primary `.git/modules/` without network access.
  - Added `pruneSubmoduleWorktrees` to prevent git worktree lock leaks in `.git/modules/`.
  - Added JIT symbolic-ref branching for submodules when current branch matches target HEAD commit.
  - Hardened worktree diff resolution and tool interception jailing (`interception.ts`).
- **Tool-Call Interception & Fail-Closed Jailing** (`src/surface/tools/handlers/interception.ts`):
  - Jails all tool calls (`bash`, `bg_run`, `read`, `write`, `edit`, `subagent`) to the active `worktreePath` during the implementation phase.
  - Enforces fail-closed write protection on the primary repository during implementing, preventing unisolated mutations.
- **Workspace Locking & Primary Workspace Test Runner** (`src/utils/git/workspace-lock.ts`, `src/utils/git/workspace-runner.ts`, `src/surface/tools/run-test.ts`):
  - Added `quest_run_test` verification tool executing test commands inside the worktree (or primary repo when configured).
  - Mutual exclusion workspace locking with PID-based deadlock recovery and bit-for-bit SHA-256 dirty stash preservation.
- **Foreman & Multi-Lane Subquest Sequencing** (`src/subquests/foreman.ts`, `tests/subquests/foreman_worktree.test.ts`):
  - Autonomous backlog parsing from markdown bullets and sequential child quest mounting for complex initiatives.
  - Worktree inheritance across parent and child quests (`inheritParentWorktree`), preventing branch divergence.
- **Anti-Tampering Verification** (`src/validation/test_tampering.ts`, `src/validation/evidence-gate.ts`):
  - Completion gate blocks validation if tests contain commented-out or deleted assertions without replacements.

### Fixed
- **Turn-Coalesced Draft Reviews, Premature Difficulty Elevation Fix & Fast-Fail `cancelReview` Cleanup** (`src/drafting/reviews.ts`, `src/drafting/review-outcomes.ts`):
  - Coalesced passive file edits (`write`/`edit` on `.pi/quest/future/<qid>.md`) within a turn into a single reviewer launch at `turn_end` instead of launching on the first edit and immediately self-aborting on subsequent edits in the same turn.
  - Checked draft maturity thresholds against the current difficulty *before* calling `recalibrateQuestDifficulty`, fixing a bug where a 2-requirement `standard` plan was elevated to `complex` mid-flight and immediately fast-failed against the 4-requirement `complex` threshold.
  - Cleaned up `inFlightReviews` via `cancelReview(qid)` inside `handleDraftFastFail` so subsequent saves can launch a fresh reviewer without being blocked by a stale `hasInFlight(qid)` lock.
- **Submodule Auto-Alignment, Worktree Pointer Restoration & `@tty-pt` Symlink Isolation** (`src/utils/git/submodule-restore.ts`, `src/utils/git/worktree.ts`, `src/utils/git/squash.ts`, `src/utils/git/pool.ts`):
  - Automatically runs `git submodule update --init --no-fetch --force` immediately after `mergeWorktreeBranch`, `squashMergeBranch`, worktree branch pre-sync, and `sanitizeSlot` so submodule working trees always match the merged parent index.
  - Added `restoreSubmoduleWorktrees` and `guardSubmoduleWorkingTree` to repair stale `core.worktree` pointers in `.git/modules/` and block accidental empty-tree (`4b825...`) submodule commits.
  - Isolated `node_modules/@tty-pt/*` symlinks inside worktree slots so worktree builds resolve local slot headers rather than primary repo symlinks.
- **Worktree Squash-Merge Pre-Sync & Hard Failure Blocker** (`src/utils/git/squash.ts`, `src/surface/tools/archive/core.ts`):
  - In `confirmAndSquashWorktree`, automatically syncs the target branch into the feature branch within the worktree before attempting squash-merge into primary workspace, resolving clean non-conflicting updates without manual intervention.
  - Made worktree squash-merge failures a hard blocker in `archiveActiveQuest`: aborts archive and throws an explicit error when conflicts prevent landing on target branch, preventing quests from silently finishing as COMPLETED with stranded feature commits.
- **Reviewer Config Resolution, Synchronous Review Slot Claiming & Stay-in-Quest on Archive Cancel/Decline** (`src/implementing/plan-revision.ts`, `src/validation/flow.ts`, `src/review/flow.ts`, `src/drafting/reviews.ts`, `src/durability/compaction-handoff.ts`, `src/surface/tools/draft-writer.ts`, `src/surface/tools/archive/core.ts`, `src/utils/git/squash.ts`, `src/subquests/index.ts`, `src/subquests/scope.ts`, `src/judge/intent-classifier.ts`):
  - Loaded `readQuestConfig(ctx.cwd)` when `baseConfig` is omitted in `bootPlanRevisionReview` and respected `planRevisionMaxDurationMs` / `planRevisionInactivityMs` instead of clamping inactivity to 60s or falling back to `DEFAULT_CONFIG`.
  - Synchronously claimed the in-flight review slot (`supersedeReviewThenBootFresh`) before async config/diff preparation in `ensureValidationFlow` and awaited `maybeBootDraftReview` inside `writePlanToDraft` / `writeAnalysisToDraft`, eliminating the race where `onTurnEnd` launched a second subagent that aborted the first.
  - Preserved `exactNextAction` during `validating` in `markActiveReview` so `implementationFingerprint` does not drift mid-validation, and synced `activeReview` across compaction.
  - Added `"Cancel archive (stay in quest)"` to the clean squash-merge selector (treating `Escape` as cancel), and demoted the quest from `validating` back to `implementing` (or `drafting` for analysis quests) on archive cancel or operator `DECLINE` / directive / refinement during `validating`.

### Changed
- **Purged Documentation Debt** (`docs/EXTENSIONS.md`, `docs/ADVANCED_GIT_RECOVERY.md`):
  - Replaced all legacy `.pi/quest/current/<qid>/quest.md` references with canonical `.pi/quest/future/<qid>.md` active quest storage.

## [1.11.0] - 2026-11-06

### Added
- **Quest Continuity Engine — handoffs** (`src/domain/handoff.ts`, `src/durability/handoff-io.ts`, `src/surface/tools/handoff.ts`):
  - `quest_handoff { qid?, notes? }` tool and `/quest-handoff [qid]` command (alias `/quest handoff`) write a deterministic handoff to `.pi/quest/handoffs/<qid>-<YYYYMMDD-HHMMSS>.md`: verbatim operator request, every directive deduplicated, Asked-vs-Accomplished table (only recorded RTM status or checked boxes count; everything else **UNVERIFIED**), approved plan (capped at 8000 chars with a doc pointer), touched files + `git diff --stat` since base commit, last test receipt and review, setbacks / running and failed sub-quests, exact next action, resume rules, agent notes.
  - Works for non-active quests via the newest transcript snapshot or a doc-only reconstruction.
- **Auto-handoff on compaction** (`src/durability/compaction-handoff.ts`, `src/hooks/events.ts`): `session_before_compact` (awaited, never cancels) writes a handoff; `session_compact` arms a one-shot `[Post-Compaction Handoff]` pointer injected on the next turn.
- **`handoff` operator intent** (`src/domain/intent.ts`, `src/domain/intent-exemplars.ts`, `src/subquests/scope.ts`, `src/subquests/index.ts`): EN/PT/ES exemplars plus `!handoff` / `handoff:` sigils; margin-gated like every actionable kind. Writes a baseline handoff and steers the agent to enrich it; never recorded as requirement, amendment, or refinement. Live eval (bge-base): handoff 4/4 held-out, 0 false actions.
- **`/quest-garden`** (`src/domain/garden.ts`, `src/surface/commands/continuity.ts`, alias `/quest garden`): triage of `.pi/quest/future` with verdicts active / fresh / stale / orphan / empty-shell; `prune` archives selections as ABANDONED via the archive writer (active quest and its stack are never pruned; confirms when a UI is present); `dedupe` repairs duplicate bullets preserving file mtime.

### Fixed
- **Duplicate directives** (`src/domain/dedupe.ts`, `src/domain/quest.ts`, `src/domain/quest-doc.ts`, `src/subquests/index.ts`): `recordAmendment`, `recordRefinement`, `appendRequirementToDoc`, `appendAmendmentToDoc` and follow-up appends are idempotent (exact match after whitespace/case normalization; `R7: x` ≡ `R9: [User Directive] x`). Previously one repeated message produced up to three identical amendments and R7/R8/R9.

## [1.10.1] - 2026-11-01

### Fixed
- **Validator Compliance & User Request Supremacy** (`src/review/prompts.ts`, `src/validation/flow.ts`):
  - Enforced User Request Supremacy in validation guidance: established that the original user request and RTM checklist form the supreme contract, framing the author's plan merely as an internal proposal. Following the plan while failing or omitting user-requested features is an automatic `VERDICT: FAIL`.
  - Added clean deliverable slicing in `validationBrief`: extracts only the actual deliverable plan body via `deliverableBody(sections, state.kind)`, stripping out conversation history (`## Context / Background Discussion`), HTML guideline comments, and invariant blocks that previously caused attention dilution and framing bias.
  - Injected bounded `git diff` (`codeDiff`) directly into the validation brief via `captureGitDiff`, providing validator subagents immediate visibility into concrete code changes.
  - Confined completion validation bypass under `reviewPolicy: "balanced"` strictly to `trivial` chores (`state.difficulty === "trivial" && testsPassed`), guaranteeing that `minor`, `standard`, `major`, and `complex` tasks undergo isolated validator review.
  - Added first-class `strictMode: boolean` support in `src/config.ts` and `src/validation/flow.ts`, honoring `"strictMode": true` in `settings.json` to prevent validation bypass even for trivial chores.

## [1.10.0] - 2026-11-01

### Added
- **Earned Autonomy Ladder & Level 3 Fast-Path Gating** (`src/policy/effective.ts`, `src/drafting/bypass.ts`, `src/validation/flow.ts`):
  - Added `resolveAutonomyLevel(need)` mapping review need $N$ into 3 graduated trust tiers: Level 3 (Full Autonomy, $N \le 2.2$), Level 2 (Balanced Autonomy, $2.2 < N \le 4.5$), and Level 1 (Supervised Audit, $N > 4.5$).
  - Level 3 permits zero-subagent execution and auto-approves validation on clean test exit code 0 or clean trees.
- **Zero-Friction Implicit Behavioral Telemetry** (`src/durability/ratings.ts`, `src/surface/tools/archive.ts`, `src/drafting/detect.ts`):
  - Added post-quest commit handoff tracking (`.pi/quest/recent-handoff.json`) and automated git revert detection (`checkPostQuestReversions`): detects if delivered commits were reset or reverted within 3 turns and penalizes model reliability with $S = 0.0$.
  - Added immediate conversational correction detection (`checkPostQuestCorrection`): observes developer complaints or bug reports in post-handoff turns and applies a retrospective score penalty ($S = 0.25$).
- **Model Ratings Dashboard Command (`/quest-ratings`)** (`src/surface/commands/ratings.ts`, `src/surface/commands/index.ts`):
  - Added `/quest-ratings` (and `/quest ratings` alias) displaying an ASCII table of tracked model reliability scores, Beta distributions, episode counts, and active autonomy tiers.
- **Configurable Model Accuracy Dictionary (`modelAccuracy`)** (`src/config.ts`, `src/policy/effective.ts`):
  - Added `modelAccuracy` configuration mapping model glob patterns to accuracy ratings in $(0.0, 1.0]$.
  - Calculates dynamic review need: $\text{ReviewNeed} = (D / \text{Accuracy}) + (\text{Setbacks} \times 1.5)$, allowing verified models to operate autonomously on routine tasks while escalating to adversarial subagents for complex work or degraded scores.
- **Quest Outcome Feedback Loop & Bayesian Ratings Persistence** (`src/durability/ratings.ts`, `src/surface/tools/archive.ts`):
  - Captures post-quest telemetry (setbacks, review cycles, validator outcome) and updates model reliability distributions ($\text{Beta}(\alpha, \beta)$) with memory discounting ($\gamma = 0.98$) stored in `.pi/quest/model-ratings.json`.
  - Supports explicit operator ratings via `/quest rate <1-5>` or non-blocking prompts.
- **VCS & Maintenance Chore Exemplars** (`src/drafting/quest-exemplars.ts`):
  - Added routine git commands (`"commit my work"`, `"git push"`, `"stash changes"`, `"git status"`), workspace maintenance, and system meta-inquiries to `conversation`, eliminating false-positive quest launches while maintaining strict disjointness from test corpora.
- **Natural Inquiry Request Guard** (`src/drafting/detect.ts`):
  - Bypasses quest creation for exploratory queries ending in `?` under `MAX_QUESTION_CHARS` unless summoned via explicit trigger prefixes (`quest:`, `/quest`).
- **Evidence Gate Adaptability for Trivial Tasks** (`src/validation/evidence-gate.ts`, `src/validation/flow.ts`):
  - Relaxed mandatory binary test runner execution for `trivial` difficulty quests where no test runner is applicable, preventing false deadlocks when claiming completion.
- **Default Model Accuracy Calibration & Risk Evaluation** (`src/policy/effective.ts`):
  - Added `DEFAULT_MODEL_ACCURACY` baseline mapping model patterns (`*claude-3-5-sonnet*`, `*gpt-4o*`, `*gemini-2.5-pro*`, `*gemini*flash*`, `*qwen*`, etc.) to calibrated accuracy scores (1.0, 0.67, 0.40).
  - Mathematical risk calibration: $\text{risk} = 1.0 / \text{accuracy}$, allowing review need to continuously adapt to model strength.
- **Automated Commit Tracking on Handoff** (`src/surface/tools/archive.ts`):
  - Automatically queries and records the latest git commit hash into `recent-handoff.json` upon quest completion, observing post-handoff turns for potential regressions, reversions, or user corrections.
- **Spec-Map Gate Path Resilience** (`tests/dag_and_spec.test.ts`):
  - Added dynamic path fallback for `HIGH_LEVEL.md` lookup, ensuring spec-map tests succeed both in isolated package runs and monorepo submodule environments.

## [1.9.3] - 2026-10-31

### Added
- **5-Level Difficulty Scaling & Numeric Tiers (1–5)** (`src/domain/quest.ts`, `src/config.ts`, `src/drafting/difficulty-exemplars.ts`):
  - Expanded difficulty tiers from 3 to 5 levels: `trivial` (1), `minor` (2), `standard` (3), `major` (4), and `complex` (5).
  - Assigned numeric ratings (1–5) to each tier to facilitate quantitative policy calculations and fine-grained review thresholds.
- **Model Capability Risk Assessment & Dynamic Review Need** (`src/policy/effective.ts`, `src/drafting/bypass.ts`, `src/validation/flow.ts`):
  - Added model capability tier classification (`modelCapabilityTier`) evaluating active session models against task complexity.
  - Dynamically determines review requirements: allows highly capable models to auto-promote low-risk trivial/minor tasks while enforcing strict review policies on complex initiatives or lower-capability models.
- **Single-Call Quest Creation** (`src/surface/tools/update-params.ts`, `src/surface/tools/update-state.ts`):
  - Enabled atomic quest creation and drafting in one call by accepting `objective`, `plan`, `difficulty`, and `kind` directly in `quest_update_state`.
- **Structured Execution Metadata on Quest Archive** (`src/surface/tools/archive.ts`):
  - Enriched `quest_archive` return value with structured execution diagnostics: wall-clock duration, turn count, tool invocation breakdown, git diff line statistics, and validation status.
- **Active Invariant Draft Seeding** (`src/surface/invariants.ts`, `src/views/draft-template.ts`):
  - Automatically queries active standing operational directives and repository invariants from persistent memory and embeds them into newly created draft plans under `## Context / Background Discussion`, guaranteeing compliance during planning.
- **Reviewer Failover Hardening** (`src/review/flow.ts`, `src/review/runner.ts`):
  - Hardened multi-provider failover chains across rate limits (HTTP 429), quota depletion, and timeouts, preventing draft stalls during peer review.
- **Parallelized Drafting Evaluation & Model Filtering** (`src/drafting/detect.ts`, `src/drafting/quality.ts`, `src/review/model.ts`):
  - Parallelized execution of difficulty evaluation, kind classification, and exemplar checks via `Promise.all`.
  - Filtered internal quest subagent models from reviewer selection to prevent circular delegation.
- **Cached Citation Verification & Fast-Fail Optimization** (`src/drafting/citations.ts`, `src/drafting/quality.ts`, `src/drafting/reviews.ts`, `src/durability/injection.ts`):
  - Memoized citation file:line resolution on unchanged files to eliminate repetitive disk I/O.
  - Added deterministic fast-fail checks for empty plans or missing requirements before booting review subagents.
  - Optimized test command regex fast-path and slimmed down context injection during implementation phase.

### Changed
- **Calibrated Quest Margin to 0.05** (`src/config.ts`):
  - Calibrated default `questMinMargin` from 0.10 to 0.05, allowing genuine engineering tasks, suggestions, and polite tech-lead phrasing to clear the gate without false quests on conversational queries.
- **Expanded Tech-Lead & Suggestive Exemplars** (`src/drafting/quest-exemplars.ts`):
  - Added natural tech-lead suggestions, observations, and architectural critiques in English and Portuguese to `QUEST_EXEMPLARS.quest` (*"I think you should have X instead of Y"*, *"We aren't doing X, let's change to Y"*, *"Can we improve the overall efficiency of this system?"*).
  - Achieved 100% recall on conversational tech-lead directives while maintaining 100% specificity and 0 false quests on casual conversation.

### Removed
- **Complete Elimination of Heuristics**:
  - Removed all regex and structural heuristics (`isCorrectiveOrBugHeuristic`, `evaluateQuestDifficultyLevelHeuristic`, `evaluateQuestDifficultyHeuristic`).
  - Deprecated and removed `"heuristic"` from `JudgeMode`, `DifficultyMode`, and `JudgeFallback`.
  - Zero heuristic guessing: decisions are strictly evaluated via server-side nearest-exemplar embeddings (`/v1/systemone`) or explicit documented trigger prefixes/commands (`quest:`, `fix:`, `/quest`).
  - When offline or unavailable, the system safely falls back to `"skip"` (triggers required) and default difficulty (`"standard"`), never guessing.

## [1.9.2] - 2026-10-30

### Added
- **Unified `POST /v1/systemone` Decision Integration** (`src/judge/nearest.ts`, `src/judge/choice.ts`):
  - Updated nearest-exemplar classification to target the unified `POST /v1/systemone` endpoint in `axil-auren`.
  - Supports both `decision` and `choice` response fields with calibrated confidence scoring.
  - Cleaned up obsolete `/v1/classify` references while maintaining the fast circuit-breaker protected path (<15ms) and local heuristic fallbacks.
- **Persistent Idle Status and Sub-Quest Depth Display** (`src/durability/status.ts`):
  - `questStatus` renders `💤 idle [^Q]` in dim styling when no quest is active (`qid: null`), keeping the quest status slot anchored instead of clearing it.
  - Sub-quests display their hierarchy depth appended to the quest identifier (`${icon} ${qid}:${depth} [^Q]`, e.g. `🔨 1xMjwo:1 [^Q]`).
- **Unified Model Status Slot & Disconnected Power-Off State** (`src/auren-bootstrap.ts`, `src/index.ts`):
  - Standardized local model status widget on shared slot ID `"auren-model"` with `AUREN_STATUS_SLOT`.
  - Added `"🔌 off"` state in `describeModelStatus` when the daemon is offline or disconnected, replacing invisible cleared slots with explicit power-off feedback.
- **Daemon Circuit Breaker & Resilient Timeout Wrapper** (`src/judge/circuit.ts`, `src/judge/embed.ts`, `src/judge/nearest.ts`):
  - Added shared circuit breaker wrapper `withCircuitBreaker` protecting all `axil-auren` calls against connection refusal, hung sockets, and daemon downtime.
  - Implemented fast-fail backoff (`CIRCUIT_BACKOFF_MS = 30_000`) and tight default timeout (`DEFAULT_CLASSIFY_TIMEOUT_MS = 250`).
  - When `axil-auren` is offline or times out, the circuit breaker opens daemon-wide; subsequent calls fail fast immediately (~1 µs, 0 ms overhead) without touching the network or socket layer, preventing Pi event loop hangs.
  - Added unit test suite in `tests/judge/circuit_breaker.test.ts` verifying connection refusal fast-fail, timeout abort, and manual/success circuit reset.
- **Corrective Bug Reports & Negative Behavioral Directives Recognition** (`src/drafting/quest-exemplars.ts`, `src/drafting/judge.ts`, `src/drafting/kind-exemplars.ts`):
  - Expanded `QUEST_EXEMPLARS.quest` with bilingual (EN/PT) exemplars for corrective directives ("You shouldn't draw X as Y, draw Z", "It shouldn't do X, do Y instead"), negative behavioral specifications ("Don't do X, do Y"), and rendering/logic bug observations ("The items are showing up as ephemeral objects instead of stones").
  - Added `isCorrectiveOrBugHeuristic(text)` in `src/drafting/judge.ts` routed through the fallback and heuristic paths of `evaluateQuestIntent`, ensuring corrective directives are recognized deterministically when the classifier server is offline or in heuristic mode (`judgeFallback: "heuristic"`), without pre-empting embedding evaluation when online.
  - Expanded `KIND_EXEMPLARS.bugfix` in `src/drafting/kind-exemplars.ts` so detected corrective directives classify accurately as `kind: "bugfix"`.
  - Added unit test suite in `tests/quest_intent.test.ts` and evaluation script `scripts/eval-bug-intent.ts`.

### Fixed
- **Pi freeze on daemon unavailability**: Eliminated 2000ms+ sequential classification delays in `classifyViaEndpoint` when `axil-auren` is uncommunicative or stopped, ensuring zero turn stalls when local AI daemon is offline.

## [1.9.1] - 2026-10-29

### Added
- **Automated reviewer rate-limit failover and fallback chains** (`src/review/model.ts`, `src/review/flow.ts`).
  - `reviewModelCandidates` automatically extends configured reviewer models with the router's default model (`config.router.default`, e.g. `antigravity/gemini-3.8-flash`), the active session model (`resolveDefaultReviewModel(ctx)`), and `{ label: "inherit" }` as the ultimate safety floor.
  - Suffix-stripped variants and de-duplication are preserved throughout the fallback candidate chain.
  - Wired `routerDefault`, `sessionModel`, and `cooldownMs` across all review triggers: `bootDraftReview` (`src/drafting/reviews.ts`), `ensureValidationFlow` (`src/validation/flow.ts`), and `bootPlanRevisionReview` (`src/implementing/plan-revision.ts`).
- **Provider-level cooldown tracking & rate-limit skipping** (`src/review/flow.ts`).
  - Added in-memory review cooldown tracker (`recordModelCooldown`, `isModelInCooldown`, `clearReviewCooldowns`) defaulting to 15 minutes.
  - When any reviewer model hits HTTP `429`, quota exhaustion, or capacity errors (`isRateLimitOrQuotaError`), the model, its base variant, and the provider prefix (`provider:<prov>`) are placed on cooldown.
  - Subsequent candidates sharing the same provider namespace are immediately skipped without wasting network requests or timing out, failing over directly to distinct providers.
- **Compound advance steering and trailing directive attachment** (`src/domain/intent.ts`).
  - When the operator sends an approval followed by trailing instructions (e.g. `"go. Make sure to also update the docs."`), `parseLeadingAdvance` detects the predetermined advance word (`"go"`), promotes the quest immediately from `drafting` to `implementing`, and extracts the trailing sentence as an active directive injected into turn context.
- **Conversational brainstorming vs quest intent differentiation** (`src/drafting/quest-exemplars.ts`).
  - Added technical inquiry, collaborative thinking, and brainstorming exemplars to `conversation` in `QUEST_EXEMPLARS` to ensure questions (*"Let's think this through"*, *"Can you explain how this module works?"*) never accidentally trigger quest creation.
- **Fine-grained quest kind classification via embeddings** (`POST /v1/classify`, `src/drafting/kind-exemplars.ts`).
  - `evaluateQuestKind` classifies objectives into `feature`, `bugfix`, `refactor`, `docs`, `analysis`, or `standard`.
  - `assertCompletionEligibility` relaxes binary test commands for `docs` quests (requiring non-empty documentation diffs).
- **Embedding-Only Model Provisioning & Redundancy Prevention** (`src/auren-bootstrap.ts`):
  - In `shouldAutoDownload`, restricted automatic model downloads strictly to models declaring embedding capabilities (`capabilities: ["embed"]`), eliminating downloads of heavy, unused inference/chat/judge models (`qwen`, `olmoe`).
  - In `run`, verified if any embedding model is already present on disk (`~/.models/`); if present, auto-download is skipped entirely. If absent, only the primary preferred embedding model (`bge-base`, 117 MB) is downloaded.
- **Non-Blocking Visual Feedback on Downloads & Model Usage** (`src/auren-bootstrap.ts`, `src/index.ts`):
  - Enriched `describeProgress` to report model identifier and progress percentage (`⬇ bge-base (42%)`).
  - Added `describeModelStatus` reporting download progress during fetching, active model status (`⚡ bge-base`) when running on port 4242, or clearing when idle.
  - Wired into reserved status bar key `"quest-judge"` with deduplicated, single-shot informational toasts on download start and completion.
- **Analysis quest direct-to-validating auto-claim & handoff bridge** (`src/drafting/promotion.ts`, `src/views/quest-view.ts`).
  - Review PASS on an `analysis` quest auto-claims completion and moves directly to validation, skipping implementation scaffolding.
  - On conclusion, generates an implementation handoff prompt to seamlessly seed follow-up implementation quests.

### Fixed
- **Reviewer rate-limit stall and manual intervention trap.** Resolved the condition where an exhausted Claude model in `roles.reviewer` caused review retries to repeatedly hammer the same rate-limited provider or stall awaiting human `"go"`.
- **A stale draft-review verdict no longer strands a draft.** When a reviewer verdict arrived for a superseded revision and nothing was in flight, `bootDraftReview` returned silently: no promotion, no new review, no wake. It now re-boots one review for the current file (then wakes the agent instead of looping). A PASS that cannot promote steers the agent instead of returning silently. The cause of the originally reported stall is unproven; this closes the one silent path found.

## [1.9.0] - 2026-10-28

### Changed
- **Quest detection uses embeddings.** `evaluateQuestIntent` first classifies a free-form message by nearest-exemplar embeddings (`questMinMargin` 0.10, floor `intentMinSimilarity` 0.6), then falls back to the judge, then to the structural `# Quest` header / trigger prefix. A quest needs the floor and the margin; anything weaker is conversation. **Measured** (48 EN/PT messages per corpus, `bge-base` vs `olmoe`): held-out corpus B, embeddings 35/48 (73%) with **0 false quests**, judge 35/48 with 11 false quests; pooled over both corpora, 0 vs 21 false quests in 96 messages. Quest recall is modest (17/24 on A, 11/24 on B at the 0.10 margin), accepted because a miss only needs `/quest` or a trigger prefix. The 0.10 margin was tuned on corpus A (a 0.075 margin gave one false quest there), recorded as a hypothesis, and validated unchanged on the fresh corpus B.
- **Difficulty uses embeddings in `difficultyMode: "auto"`** (`difficultyMinMargin` 0.075; `trivial` and `complex` need the margin, anything unsure is `standard`). **Measured** over three corpora (45 EN/PT requests each): embeddings 73/135 (54%) with **0 wrong "trivial"** verdicts; the judge 59/135 (44%) with **52** wrong "trivial" verdicts (it never answered "standard"; a wrong "trivial" drops plan review). A first hypothesis (margin 0.02, from corpus A) was **falsified** on corpus B (3 wrong "trivial") and discarded; the default 0.075 was then pre-registered and validated on a fresh corpus C (24/45 vs judge 17/45, 0 vs 17 wrong "trivial"). Recall of trivial/complex is low (11/45 and 17/45): embeddings mostly say `standard`, which is the safe direction. An explicit `difficultyMode: "judge"` skips embeddings.
- **Plan verification stays on the judge (embeddings measured, not adopted).** On 44 plans, embeddings (36/44) would wrongly block 8 of 22 good plans in `enforce` mode; no similarity floor or margin gives full recall with zero false "yes". Finding: on `olmoe` the judge answers "yes" to every plan (0 of 22 missing verification steps found), so the verification gap in `quality.ts` rarely fires today. Recorded as a follow-up (an advisory-only embedding check is a possible later improvement).

### Added
- Settings `questMinMargin`, `questExemplars`, `difficultyMinMargin`, `difficultyExemplars` (kinds validated and sanitized; any language; merged with the shipped exemplars `src/drafting/quest-exemplars.ts` and `src/drafting/difficulty-exemplars.ts`). Env: `PI_QUEST_QUEST_MIN_MARGIN`, `PI_QUEST_DIFFICULTY_MIN_MARGIN`. `QuestIntentResult.source` and `QuestDifficultyResult.source` gain `"embed"`.
- `src/judge/nearest.ts`: the generic nearest-exemplar engine (`mergeExemplars`, cached exemplar index, `nearestExemplar`, `gate`) that steering, quest detection and difficulty now share. Behaviour of steering is unchanged (live: 43/48, 0 false actions).
- A measurement harness for "can embeddings replace the judge here?": `tests/eval/harness.ts` reports accuracy, wrong state-changing verdicts, p50/p95 latency, per-label recall and every miss for both strategies, prints the server and model it ran against, and applies the adoption rule (`gateDecision`). Corpora and live evaluations: `tests/eval/{quest-intent,difficulty,plan-verification,intent}-eval.test.ts` (opt-in, `PI_QUEST_EVAL_JUDGE=1`; their corpus/exemplar disjointness checks run in `npm test`).
- **`npm test` is now genuinely hermetic.** The suite made one live `GET /v1/models` request to the real auren server on every run (`/quest doctor`'s bring-up and health probe, reached from `tests/surface/plan.test.ts`). The test script now preloads `tests/no-live-network.ts` (refuses non-loopback hosts and port 4242; ephemeral loopback fake servers still work) and sets `PI_QUEST_AUTO_START_AUREN=0`, both asserted by `tests/no_live_network.test.ts`; `PI_QUEST_ALLOW_LIVE=1` lifts the guard. Measured: 0 requests to the live server, suite time unchanged (about 12 s).
- Documentation: the "What Decides What" matrix in `docs/OPERATOR_GUIDE.md` (decision, decided by, fallback, offline behaviour, measured result).

### Fixed
- **Measurement harness bug that made the judge look unavailable.** The judge warm-up used the production 6 s timeout; a cold model load takes longer, and the aborted generation left the local server saturated (`session close queue full`), so most judge answers came back unavailable. Strategies now carry their own warm-up (judge: 180 s) and the judge's quality is measured with a 30 s timeout; embedding-only measurements run before judge runs.

## [1.8.0] - 2026-10-28

### Changed
- **Operator steering is classified by embeddings, not a generative judge.** `interpretUserTurn()` embeds the message through axil-auren `POST /v1/embeddings` (`bge-base`, ~15 ms) and picks the nearest labelled exemplar kind (`src/judge/embed.ts`, `src/domain/intent-exemplars.ts`). State-changing verdicts need cosine similarity >= `intentMinSimilarity` (0.6) and a margin >= `intentMinMargin` (0.075) over the runner-up; anything weaker is a recorded refinement. Held-out evaluation (48 English/Portuguese messages, disjoint from the exemplars): 43/48 correct, 0 false state-changing verdicts; the misses are mostly non-English phrasings. For comparison, permutation-averaged judge questions on `olmoe` recognised 1 of 7 approvals because forward and reversed option orders cancel each other (position bias). The judge tier is removed from steering (it stays for difficulty and plan verification), as is the double-ask-agree rule.
- **Defaults work out of the box.** `judgeProtocol` defaults to `systemone` and `judgeModel` to `olmoe` (SystemZero scored 3/8 with `qwen`, 6/8 with `olmoe` on a quest-vs-chat check); `judgeTimeoutMs` defaults to 6000. The project `.pi/settings.json` no longer needs to override them. The loader's fallback for an invalid `judgeProtocol` is the default instead of `auto`.
- pi-mm: `judgeModel` now defaults to `olmoe` (protocol was already `systemone`).

### Added
- Settings: `embedMode`, `embedUrl`, `embedModel`, `intentMinSimilarity`, `intentMinMargin`, `intentExemplars` (extra exemplars per intent, any language, merged with the shipped ones). Env: `PI_QUEST_EMBED_MODE`, `PI_QUEST_EMBED_URL`, `PI_QUEST_EMBED_MODEL`, `PI_QUEST_INTENT_MIN_MARGIN`, `PI_QUEST_INTENT_MIN_SIMILARITY`.
- Opt-in live evaluation `tests/eval/intent-eval.test.ts` (`PI_QUEST_EVAL_JUDGE=1`).
- A failed embeddings endpoint is skipped for 10 s so a dead server cannot stall every message; exemplar vectors are embedded once per server/model in a single batch request.
- `npm test` is hermetic: it runs with `PI_QUEST_JUDGE_MODE=off PI_QUEST_EMBED_MODE=off`; tests that need the stubs enable them explicitly.

## [1.7.1] - 2026-10-28

### Fixed
- **A failing judge no longer looks decisive.** `askJudgeChoice` treats a `choice: null` answer and the legacy fabricated answer of older auren builds (first option, confidence exactly 0.90, every other option 0.05) as "judge unavailable". That fabricated answer, not model weakness, is what made every message read as the first option and made the local judge look biased.
- Settings: `pi-quest` and `pi-mm` now use `judgeProtocol: "systemone"` with `judgeModel: "olmoe"`. SystemZero (`auto` tried it first) scores 3/8 with `qwen` and 6/8 with `olmoe` on a quest-vs-chat check, so it is no longer the default path.

## [1.7.0] - 2026-10-28

### Changed (breaking)
- **Judge-first operator intent, no natural-language word lists in code.** One `interpretUserTurn()` (`src/domain/intent.ts`) classifies each operator message once (memoized per message), via one judge call, into advance / abort / constraint / sub-quest / question / ack / refinement. Draft approval, plan-revision adoption, validation confirmation, late-answer handling and mid-quest triage all consume that single result. Removed: `ADVANCE_PHRASES` / `ABORT_PHRASES` (EN + PT, and their substring matching that returned *before* the judge), the `triage.ts` confirm/ack/question/sub-quest/constraint vocabularies, `GO_PATTERN` / `APPROVE_PATTERN` / `CONFIRM_PATTERN`, and the English verb / "My grandfather|cat|dog" quest-detection regexes.
- **Judge-less fallback is one word.** With the judge off or unreachable, only the exact message `go` (plus operator-owned `steeringPhrases` in settings) advances a quest; every other phrasing becomes a recorded refinement that cannot advance, abort or archive. Sigils (`!rule`, `!sq`, `!later`, `!chat`, `? `) keep working. Free-form text no longer opens a quest without a judge: use a trigger prefix or `/quest`.
- **Judge answers must equal a declared label.** The new `askJudgeChoice()` seam (`src/judge/choice.ts`) replaces three duplicated Jev fetch/parse blocks; substring synonyms (`task`, `chat`, `minor`, `epic`, ...) are gone. `judgeMode: "systemone"` now forces the systemone protocol, and a SystemZero reply with no decision/choice falls through to systemone instead of reading as "conversation".
- **Difficulty fallback is structural** (4+ distinct file paths => complex, else standard); the keyword lists are removed. **Plan verification** is a judge yes/no question and is advisory (never blocks promotion) when no judge is available.
- **Setbacks key on exit status only.** Output text is never scraped, fixing the false "Test/build command failed" on a passing run whose output says `0 failed`. `isTestCommand` now matches runner tokens (`npm test`, `make`, `pytest`, ...) per command segment, not a word anywhere in the line; add runners with `testCommands`.
- **One provider-error classifier** (`src/utils/provider-error.ts`) shared by review retries and the router: status codes on word boundaries and API error codes only; generic words (`model`, `process`, `context`) no longer match.
- **Repo-specific lint rules moved to config.** `semantic-lint` ships only the conflict-marker check; the site's UX / XY rules now live in the repo's `.pi/settings.json` under `pi-quest.lintRules`.
- **Section headings** are recognized through one registry (`src/domain/sections.ts`) by title prefix at a word boundary instead of "contains word".

### Added
- Settings: `steeringPhrases`, `testCommands`, `lintRules`.

## [1.6.0] - 2026-10-28

### Added
- **Array-valued role models (`roles.reviewer`, `roles.validator`)**: these keys now accept a string (primary only) or an ordered array. The first entry is the primary model; the remaining entries form the fallback chain used on provider/model/rate-limit and auth/permission errors (`401`, `403`, `permission_error`, `oauth_not_allowed`).

### Fixed
- **"Go on" no longer sends an implementing quest back to draft**: bare steering messages ("go on", "carry on", "keep going", "ship it", "let's go", PT "continua"/"vai em frente", and abort phrases like "cancel") are no longer recorded as refinements/amendments mid-quest; they are left to the phase handlers. Matching is exact, so "add a cancel button" is still recorded. Note: nothing acts on abort phrases while implementing yet; they are simply ignored by mid-quest triage.
- **Mid-quest demotion is limited to explicit constraints**: only `!rule` / `must:` / natural constraint phrasing returns implementing or validating work to drafting. Plain refinements are recorded as amendments but keep the approved plan, and an in-flight review is cancelled only when a demotion happens.

### Removed
- **`roles.reviewerFallback` and `roles.validatorFallback`**: no longer read by the config loader or the runtime. Place fallback models as trailing entries in `roles.reviewer` / `roles.validator`. This is a breaking change with no compatibility shim, hence the minor bump.

## [1.5.0] - 2026-10-27

### Added
- **Zero-Configuration `axil-auren` Inference Server Bring-Up (`src/auren-bootstrap.ts`)**:
  - Automatically provisions local inference configuration at `~/.config/auren/config.json` if absent, mapping detected models and capabilities without requiring manual setup.
  - Automatically manages background daemon startup on port 4242 with socket/HTTP readiness polling and process lifecycle management.
- **Intelligent Model Provisioning & Tiered Consent (`~/.models/`)**:
  - Supports automatic discovery and downloading of local models (`qwen2.5-0.5b`, `bge-base`, `bge-small`, `olmoe`) with cryptographic `sha256` verification, resumable range downloads, and atomic file swaps.
  - Tiered consent: light models download seamlessly, while large MoE models (`olmoe`, 3.3 GB) prompt interactively via `ctx.ui.confirm()` to respect user bandwidth and disk budget.
- **Proactive C Engine Dependency Tracking on `session_start` (`src/versions.ts`, `src/index.ts`)**:
  - Pure TypeScript SemVer parser and engine detector inspecting system packages (`pkgconfig`), source repositories (`external/`), and git tags for `axil`, `libcorm`, `libsepal`, `liblemma`, `libjoint`, and `axil-auren`.
  - Automatically alerts users on `session_start` with concise TUI remediation toasts if any required engine is missing or outdated, eliminating the need to manually invoke `/quest doctor`.
- **Integrated C Engine Diagnostics in `/quest doctor` (`src/surface/commands/doctor.ts`)**:
  - Displays full matrix of core C engines, installed versions, required thresholds, and exact copy-paste remediation commands for package managers and source compilation.
- **`policyByModel`** (`src/policy/effective.ts`): ordered glob rules map the active `provider/id` to `strict` / `balanced` / `off`. The model is read live from `ctx.model` (env fallback); under `quest/auto` the physical model last routed to (`src/router/last-route.ts`) is matched. Applied in draft review, plan-revision review and validation; wake messages and the draft profile name the rule.
- **`draftQuality`** (`src/drafting/quality.ts`, `quality-config.ts`, `citations.ts`): configurable per-difficulty depth bar — resolvable `file:line` citations, discrete plan steps, a verification step. `mode` `enforce` (default) holds bypassed drafts below the bar, `warn` promotes with an advisory, `off` disables; under `strict` it is advisory reviewer context. Shown in every draft profile.
- **`/quest-policy`** command: active model, configured vs effective policy, matching rule, quality tiers, and config warnings (`src/surface/commands/policy.ts`, `src/policy/warnings.ts`). Invalid or shadowed `policyByModel` / `draftQuality` settings are reported instead of silently dropped.
- Friendly forms: `"draftQuality": "warn"` / `false`; env fallbacks `PI_QUEST_POLICY_BY_MODEL` (`glob=policy,…`) and `PI_QUEST_DRAFT_QUALITY`; policy and mode values are case/space tolerant.
- Citation detection recognises more file types (js, json, py, mk, yml, toml, rs, go, css, html, cc/cpp/hpp).
- README and operator guide document the `quest/auto` router and how to select it.
- **Reviewer / validator fallback chains** (`roles.reviewerFallback`, `roles.validatorFallback`): ordered fallback models tried when the primary review model fails with a provider/model/rate-limit error. Provider-error detection now also covers `503`, `529`, `overloaded`, and `capacity`.
- Operator guide section "What to Expect: A Quest End to End".

### Fixed
- **Quest stuck in drafting forever under `reviewPolicy: "balanced"` / `"off"`**: when a non-complex draft was below the maturity bar the bypass path returned silently — no reviewer, no promotion, no message — so the agent was never woken and the tool gate stayed locked. The bypass now wakes the agent with the draft profile (what is missing), the policy in force, and the live-user `go` override. Logic lives in `drafting/bypass.ts`.
- **Draft profile no longer says "bar met" when the gate disagrees**: `draftProfileText` now includes requirement→plan (RTM) coverage and ignores comment-only plans (the review-count marker), exactly like `meetsReviewThresholds`.
- **Plans with their own `## ` headings are refused** (`quest_update_state {plan|analysis|planRevision}`): a nested `## Requirements` / `## Steps` ended the Implementation Plan section and left an empty plan behind. The error says to use `###`.
- **Phantom `PLAN_REVISION_REVIEW` lockout under `reviewPolicy: "balanced"`**: the draft-review in-flight tracker is now cleared on policy bypass and on promotion, so tools are no longer blocked after an auto-promote. A human `APPROVE` now cancels a stuck in-flight review before the hash check. Covered by an end-to-end test.
- Natural-language advance phrases now include `go on`.

## [1.4.0] - 2026-10-26

### Added
- **Configurable Phase × Difficulty Virtual Model Router (`quest/auto`) (`src/router/`, `src/config.ts`, `src/surface/commands/router.ts`)**:
  - **Dynamic Phase × Difficulty Matrix**: Registers virtual model `quest/auto` routing each request to physical models based on active quest phase (`idle`, `provisional`, `drafting`, `implementing`, `validating`) and difficulty tier (`trivial`, `standard`, `complex`).
  - **Wildcard Cascades & Fallback Chains**: Full support for wildcard `*` matching across phases and difficulties, single string or array fallback chains, and automatic fallback to `router.default`.
  - **Subscription Quota & Rate-Limit Cooldown**: Automatically detects `429`, quota exceeded, and capacity exhaustion errors on retry turns, placing affected models on a configurable cooldown (`cooldownMs`, default 15m) and switching requests to secondary fallback models.
  - **Prompt-Cache Optimization**: Multi-tool continuation turns remain sticky on the active model to preserve prompt prefix caching, and direct tasks (such as compaction summaries) route to an economical `direct` model.
  - **Status Inspection Command (`/quest-router`)**: Adds `/quest-router` displaying live registration state, active quest cell, resolved candidate models, cooldown timers, and matrix configuration validation warnings.
  - **Structural Interface Compatibility (`src/hooks/events.ts`)**: Extends pi-quest's internal structural `Pi` and `PiCtx` interfaces with optional `registerVirtualModel` and `modelRegistry` support without coupling to external `@earendil-works` dependencies.

## [1.3.1] - 2026-10-26

### Added
- **Mid-Quest Directive Engine & Anti-Amnesia (`src/config.ts`, `src/subquests/triage.ts`, `src/subquests/scope.ts`, `src/subquests/index.ts`, `src/domain/quest-doc.ts`, `src/durability/injection.ts`, `src/validation/flow.ts`, `skills/quest-journal/SKILL.md`)**:
  - **Conversational Natural Language Priority**: Zero required commands or prefixes. Ordinary English/Portuguese statements are automatically captured and categorized into constraints (auto-amending plan requirements) or separable tasks (queued to Foreman backlog or pre-empted).
  - **Agent-Directed Triage Protocol in Skill (`skills/quest-journal/SKILL.md`)**: Added authoritative protocol teaching the agent how to evaluate `[Active Mid-Quest Directives]`, proactively spawn sub-quests via `quest_subquest` for separable work, adopt constraints via plan amendments, and satisfy all directives before completion claims.
  - **Optional Fast-Path Shortcuts (`src/subquests/triage.ts`)**: Retained `!sq`, `!later`, `!rule`, and `!chat` as optional deterministic power-user and scripting shortcuts.
  - **Lower Ingestion Threshold**: Reduced arbitrary `< 20` length cutoff down to 3 characters, preventing short but critical constraints (`"Use port 8080"`, `"Keep C99"`) from being silently dropped.
  - **Anti-Amnesia Context Injection with Actionable Cues (`src/durability/injection.ts`)**: `contextLine` in `before_agent_start` now injects active mid-quest user directives with tool cues on every turn, preventing model forgetfulness across tool executions and conversation compactions.
  - **Single Source of Truth Plan Synchronization (`src/domain/quest-doc.ts`, `src/subquests/index.ts`)**: Implemented `appendRequirementToDoc`, `appendSubQuestBacklogItem`, and `appendAmendmentToDoc` to reliably synchronize disk documents and update content hashes.
  - **Validation Gating on Acceptance Criteria (`src/validation/flow.ts`)**: Fixed validation brief so user directives/refinements are delivered to the validator under `requirements` (acceptance criteria) rather than passive `evidence`.
  - **Fine-Grained Configuration (`src/config.ts`)**: Added `midQuest` settings (`mode`, `subquestAction`, `autoAmendRequirements`, `turnInjection`, `promptTimeoutMs`) to `QuestConfig` and `DEFAULT_CONFIG`.

## [1.3.0] - 2026-10-26

<p align="center">
  <img src="https://raw.githubusercontent.com/tty-pt/pi-quest/main/cover.png" alt="pi-quest cover banner" width="100%">
</p>

### Added
- **Configurable Review Policies (`src/config.ts`, `src/drafting/reviews.ts`, `src/validation/flow.ts`, `src/implementing/plan-revision.ts`)**:
  - Added `reviewPolicy`: `"strict" | "balanced" | "off"` (default `"strict"`), configurable in `.pi/settings.json` or via `PI_QUEST_REVIEW_POLICY`.
  - In `"balanced"` (Frontier Mode): skips plan reviews for `trivial` and `standard` tasks, allowing models like Grok and Claude 3.5 to jump straight to implementation; auto-completes validation when tests pass cleanly (`exitCode 0`), reserving subagents for `complex` tasks or test failures.
  - In `"off"` (Speedrun Mode): completely bypasses subagent review calls across drafting, validation, and mid-implementation plan revisions while retaining full quest journal structure, checklists, git tracking, and test receipts.
  - Plan revisions in `src/implementing/plan-revision.ts` now respect `reviewPolicy`, auto-approving under `off` and `balanced` (for non-complex tasks) without spawning subagent reviews.
  - Policy-bypassed validation runs synthesize honest `PASS` review outcomes in state, cleanly satisfying the `hasValidationPass()` gate and archiving without errors.
- **Role-Based Model Customization (`src/config.ts`, `src/review/flow.ts`, `src/drafting/reviews.ts`, `src/validation/flow.ts`, `src/domain/steering.ts`)**:
  - Added `roles`: `{ reviewer?: string; validator?: string; judge?: string; }` (as well as `reviewerModel` and `validatorModel`) with environment overrides (`PI_QUEST_REVIEWER_MODEL`, `PI_QUEST_VALIDATOR_MODEL`, `PI_QUEST_JUDGE_MODEL`).
  - Added `resolveRoleModel(cfg, role)` helper unifying model resolution across reviewer, validator, and judge invocations.
  - Enables the Economical Frontier pattern: run expensive reasoning models (e.g. Grok, Claude) as primary implementation workers while delegating review, validation, and judging roles to fast, economical auditors (e.g. `google/gemini-2.5-flash`).
  - Consistent judge model application across intent detection (`judge.ts`), difficulty inference (`difficulty.ts`), and natural language steering evaluation (`steering.ts`).
- **Natural Language Steering & Semantic Circuit Breaking (`src/domain/steering.ts`)**:
  - Implemented `evaluateSteeringIntent()` with fast local heuristic intent classification (<5ms) and optional neural judging via Jev System One.
  - Understands conversational operator approval/advancement phrases (e.g. *"proceed"*, *"ship it"*, *"looks good"*, *"start coding"*, *"wrap it up"*, *"avança"*, *"está feito"*) and abort/cancellation phrases without rigid regex constraints.
  - Allows human operators to advance drafting to code or archive completed validation work using natural speech.
- **Symmetric Human Supremacy in Validation (`src/validation/flow.ts`)**:
  - Removed the blocker (`isReviewerAvailable`) that previously prevented human operators from confirming completion when an automated validator subagent was configured.
  - The operator can now approve and archive completed quests at any point, cleanly canceling any in-flight background validator runs.
- **Two-Strike Review & Validation Loop Breakers (`src/drafting/draft-retry.ts`, `src/validation/flow.ts`)**:
  - Automatically tracks consecutive review rejections (`MAX_CONSECUTIVE_REVIEW_FAILS = 2`, `MAX_CONSECUTIVE_VALIDATION_FAILS = 2`).
  - Upon 2 consecutive rejections, the automated re-review loop is paused and the agent stops thrashing, prompting the human operator directly for guidance or approval.
- **Autonomous Foreman Auto-Kickoff on Plan Approval (`src/drafting/promote.ts`, `src/subquests/foreman.ts`)**:
  - `promoteAfterPass` now inspects the approved plan for sub-quest backlog items (`- [ ] SQ1: ...`).
  - When sub-quests are defined, Foreman automatically mounts `SQ1` onto `questStack` immediately upon promotion to `implementing`, setting bounded `allowedPaths` and assigned requirements.
  - Updated `parseDraftSections` to capture `## Sub-Quests` and fold backlog items into `deliverableBody`, ensuring reviewers inspect sub-quest plans.
  - Updated `renderDraftTemplate` to inject structured `SQ1`, `SQ2`, `SQ3` active backlog templates when difficulty is `complex`.
- **Adaptive Difficulty Tiers (`src/config.ts`, `src/drafting/difficulty.ts`)**:
  - Added `QuestDifficulty = "trivial" | "standard" | "complex"` with adaptive maturity thresholds:
    - `trivial`: 1 requirement, 2 evidence items.
    - `standard`: 2 requirements, 7 evidence items.
    - `complex`: 3 requirements, 10 evidence items.
  - Added dual heuristic and Jev System One difficulty classifier (`evaluateQuestDifficulty`).
- **Operator Documentation & Contextual Guidance (`docs/OPERATOR_GUIDE.md`, `src/drafting/detect.ts`)**:
  - Added comprehensive 1-page English operator guide covering quest phases, natural steering, shortcuts, and circuit breakers.
  - Added contextual hints to quest opening announcements reminding operators how to skip reviews or fast-track execution.

### Fixed
- **Missing Authored Requirements in Review Packets (`src/drafting/plan-text.ts`, `src/review/prompts.ts`)**:
  - Fixed regression where `sections.requirements` was collected but omitted from `ReviewMaterial`, causing draft reviewers in FAST-FAIL mode to reject valid plans for missing requirement bullets.
  - Authored requirements bullets and counts are now cleanly rendered in draft review briefs.

## [1.2.0] - 2026-10-24

### Added
- **Autonomous Foreman Sub-Quest Dispatcher (`src/subquests/foreman.ts`)**:
  - Automatically parses markdown backlog tasks (`- [ ] SQ1: Goal [paths: ...] [test: ...] [req: ...]`).
  - Automatically binds contracts and mounts the next pending sub-quest onto `questStack` upon previous sub-quest completion.
  - Automatically halts sequencing if a sub-quest fails, waking the coordinator with a structured failure setback.
- **Deterministic Zero-Token Semantic Linters (`src/validation/semantic-lint.ts`)**:
  - Pre-validation regex linter evaluating git patches in `<15ms` before expensive LLM reviewer calls.
  - Rules: `no-ux-compile-branch` (forbidding `#if`/`#ifdef` in isomorphic pure-C UX with sanctioned macro exemptions), `no-ux-engine-symbols` (forbidding backend symbols in UX), `no-cross-module-c-include` (preserving XY modular boundaries), and `no-conflict-markers` (forbidding unresolved git conflict markers).
- **Persistent Test Receipts (`src/domain/quest.ts`, `src/durability/snapshots.ts`)**:
  - Defined pure `VerificationReceipt` and `lastTestReceipt` field on `QuestState`.
  - Persisted test outcomes across transcript snapshot encoding/decoding and `/reload` restarts.
- **State & Disk Dual-Reconciliation on Stack Pop (`src/domain/quest-doc.ts`, `src/quest-doc.ts`)**:
  - Implemented `reconcileDocContent` and best-effort `reconcileParentDocOnReturn`.
  - Automatically checks off satisfied parent requirements (`- [ ] R1:` → `- [x] R1:`) and appends sub-quest execution logs into `## Sub-Quests` on child completion.

### Fixed
- **Zero-Path Lockout Trap on Emergent Sub-Quests (`src/domain/contract.ts`, `src/domain/gates.ts`)**:
  - Updated `isPathAllowedByContract` to treat empty `allowedPaths: []` or omitted paths as unrestricted worker mode instead of rejecting all edits.
  - Enhanced gate reason text with actionable guidance when explicit paths are locked.
- **First-Turn Scaffold Review Bypass (`src/drafting/reviews.ts`)**:
  - Updated `onTurnEndCatchAll` to inspect deliverable body content on turn 1 when `contentHash === null`.
  - Authored plans written on turn 1 now immediately boot draft review without requiring dummy edits on turn 2.
- **Structured Failure Recovery (`src/domain/stack.ts`)**:
  - Pop on `FAILED` receipts synthesizes structured `Setback` items with test commands, exit logs, and assigned requirements, steering the coordinator with actionable recovery guidance.

## [1.1.0] - 2026-10-21

### Added
- **Jev System One Quest Intent Judge (`src/drafting/judge.ts`)**:
  - Local neural judging for incoming prompt classification.
  - Offline fail-closed safety with deterministic trigger prefixes (`quest:`, `task:`, `feat:`, `fix:`).
- **Diagnostic Command (`src/surface/commands/doctor.ts`)**:
  - `/quest doctor` health inspection reporting judge connectivity, latency, and active policies.
- **Standalone Distribution Packaging (`scripts/zip_bundle.ts`)**:
  - Bundles extension code, diagnostics, and manifests into `pi-quest-bundle.zip`.

## [1.0.0] - 2026-10-20

- Initial layered rebuild of `pi-quest`:
  - 3-phase epistemic state machine (`drafting`, `implementing`, `validating`).
  - Pure domain reducers and strictly acyclic module DAG.
  - Transcript snapshot durability and auto-recovery.
  - Non-blocking human asks with default timeouts.
  - Full-screen terminal plan overlay (`[^Q]`).
