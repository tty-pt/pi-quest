# Changelog

All notable changes to the `pi-quest` extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.1] - 2026-10-29

### Fixed
- **A failing judge no longer looks decisive.** `askJudgeChoice` treats a `choice: null` answer and the legacy fabricated answer of older auren builds (first option, confidence exactly 0.90, every other option 0.05) as "judge unavailable". That fabricated answer, not model weakness, is what made every message read as the first option and made the local judge look biased.
- Settings: `pi-quest` and `pi-mm` now use `judgeProtocol: "systemone"` with `judgeModel: "olmoe"`. SystemZero (`auto` tried it first) scores 3/8 with `qwen` and 6/8 with `olmoe` on a quest-vs-chat check, so it is no longer the default path.

## [1.7.0] - 2026-10-29

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
