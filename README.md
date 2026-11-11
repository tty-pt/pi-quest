<p align="center">
  <img src="https://raw.githubusercontent.com/tty-pt/pi-quest/main/cover.png" alt="pi-quest cover" width="100%" />
</p>

# pi-quest: Work Ethic & Autonomous Quest Orchestration for Pi

[![npm version](https://img.shields.io/npm/v/@tty-pt/pi-quest.svg?color=blue)](https://www.npmjs.com/package/@tty-pt/pi-quest)
[![License: BSD-2-Clause](https://img.shields.io/badge/License-BSD--2--Clause-blue.svg)](LICENSE)
[![Virtual Model Router](https://img.shields.io/badge/model--router-quest%2Fauto-8B5CF6)](#)

> Rigorous task lifecycle orchestration for the Pi Coding Agent: research, plan, peer review, implementation, and automated validation.

`pi-quest` gives your [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) structured discipline for complex programming tasks. Instead of jumping immediately into editing code, it investigates, drafts an implementation plan, passes adversarial review, implements with scope tracking, and validates against the plan before declaring work complete.

---

## 1. Quickstart: How a Quest Goes

Install the extension:

```bash
pi install npm:@tty-pt/pi-quest
```

Every quest executes through three phases:

1. **Drafting**: The agent explores the codebase (read/search/test runs flow freely) and authors its draft plan (`.pi/quest/future/<qid>.md`). Editing `.pi/quest/future/<qid>.md` while in `provisional` automatically transitions the quest to `drafting` (`planAuthored: true`). Passive file edits to the draft coalesce within a turn and boot a single independent reviewer at `turn_end`, while drafter and reviewer exchange structured `[Drafter–Reviewer Dialogue]` rounds in the background as you continue chatting. You can reply `go` or `proceed` at any moment to bypass review.
2. **Implementing**: The agent works from the approved plan in an isolated scratch worktree (`.pi/scratch/slot-N`). Unexpected obstacles and discoveries are recorded as amendments on disk.
3. **Validating**: A validator reviews the implementation against the plan and test results. A PASS completes the quest, integrates the worktree (or leaves it in `slot-N` via `keep-slot` / `squash-keep-slot` for manual testing), and cleans up `.pi/quest/future/<qid>.md`. Reply `go` (or *ship it* / *confirm* in any language, classified by embedding similarity) at any time to accept immediately, or reply `decline` / give corrective feedback (or choose `"Cancel archive (stay in quest)"` in the integration prompt) to demote back to `implementing` and continue working in the quest.

### Instant Session Toggle (`Alt+J`)
Press **`Alt+J`** in the terminal at any time to toggle `pi-quest` on or off for the current session (`/quest on` / `/quest off`).

---

## 2. Conversational Brainstorming (Argon-First) vs. Quest Workflows

`pi-quest` distinguishes between **open conversation / brainstorming** and **task execution directives**:

- **Argon-First Chat & Brainstorming** (No quest opened, no files locked):
  - Sessions start in `idle` (or paused `⏸️`) routed to **`antigravity-acp/gemini-4-argon:high`** (configurable in `router.matrix.idle` / `provisional` / `drafting.standard`). When `pi-quest` is paused (`quest.disabled === true`), the router uses the `idle` matrix rule so you stay on Argon until a quest transitions into active execution/review phases.
  - When you ask open-ended questions, explore design ideas, or brainstorm (*"Let's think this through"*, *"Can you explain how this module works?"*, *"What are our options for handling this issue?"*, or prefix with `? ` / `!chat`), the agent answers directly in conversational markdown.
  - The worktree is **never locked**, and no draft plan is forced upon you.
- **Conversation-Aware Quest Activation**:
  - Once you are happy with the understanding and plan discussed with Argon, activate a quest with `"quest: Go for it."`, `/quest on`, `/quest on [goal]`, or `/quest new [goal]` (or issue a direct imperative task instruction).
  - When activated with a referential prompt (`"Go for it"`, `"do it"`, `"proceed"`, or bare `/quest on`), `pi-quest` automatically extracts the substantive objective and context from the prior conversation transcript (`extractPriorConversationObjective`) instead of recording `"Go for it."` literally, and steers the agent to author `.pi/quest/future/<qid>.md` immediately.

### Flexible Operator Steering & Compound Approvals

Promoting a draft or approving a plan revision does not require rigid magic words:
- **Predetermined Word**: A single word `go` (case- and punctuation-insensitive) advances with zero network dependency.
- **Multilingual Semantic Assent**: Natural approvals in English and Portuguese (*"proceed"*, *"approved"*, *"looks good"*, *"bora"*, *"aprovado"*, *"vai em frente"*, *"manda bala"*) are evaluated server-side via `POST /v1/systemone`.
- **Compound Approvals**: You can approve and give a trailing directive in one breath:
  - Example: `"go. Make sure to also update the docs."`
  - `pi-quest` promotes the quest immediately *and* attaches the trailing instruction as an active directive on the new phase.

### Bug Reports & Negative Behavioral Directives

`pi-quest` recognizes when you report a defect or specify negative behavioral constraints:
- *"You shouldn't draw as an ephemeral item something that's supposed to be a stone or a rock. If it is a stone or a rock or a stone, just draw that."*
- *"It shouldn't do X when Y happens, it should do Z instead."*
- *"Don't write raw SQL in handlers, use the query builder instead."*
- *"The items are showing up as ephemeral objects instead of stones, please fix that."*
- Portuguese equivalents (*"Não devias desenhar pedras como itens efémeros. Se for uma pedra ou rocha, desenha isso."*, *"Não faças X quando Y, faz Z em vez disso."*)

These are evaluated in ~20 ms via in-memory embeddings (`POST /v1/systemone`) with **100% recall** and **0% false quests** on conversational benchmarks. They open a provisional quest draft automatically and classify into **`kind: "bugfix"`** without needing `/quest` or explicit prefixes. When the server is offline, explicit trigger prefixes (`fix:`, `quest:`) or `/quest` are required (zero fuzzy heuristics).

### Fine-Grained Quest Kinds

When a quest opens, `pi-quest` automatically classifies its objective into specialized kinds:

| Quest Kind | Goal | Verification & Completion Rules |
| :--- | :--- | :--- |
| **`feature`** | New capability or subsystem | Requires code diffs, passing tests, and verification receipt. |
| **`bugfix`** | Defect remediation | Requires regression test receipt and clean exit code 0. |
| **`refactor`** | Structural code improvement | Requires zero functional regression, passing tests, and boundary check. |
| **`docs`** | Documentation & guides | Requires modified files (docs/markdown), but binary test runner commands are relaxed. |
| **`analysis`** | Pure investigation or design audit | Delivers a written `## Analysis` in the quest file. No code diffs or tests required. |
| **`standard`** | General development task | Default full lifecycle: plan, review, implement, test verification. |

### Analysis $\rightarrow$ Implementation Handoff

When an `analysis` quest concludes and validates, `pi-quest` automatically archives the analysis and outputs an implementation bridge prompt. You or the agent can immediately start the follow-up implementation quest (e.g. `quest_update_state { objective: "Implement recommendations from analysis <qid>..." }`), carrying forward the approved findings.

---

## 3. Model Router (`quest/auto`) & Review Policies

`pi-quest` registers a virtual model, **`quest/auto`**, that dynamically steers each turn to the optimal physical model:

- **Drafting (Complex)** $\rightarrow$ Advanced reasoning models (e.g. Claude 3.5 Sonnet) with high thinking.
- **Implementing** $\rightarrow$ Fast, economical coding models (e.g. Gemini 2.5 Flash, Qwen).
- **Direct Tasks** (summaries, compactions) $\rightarrow$ Economical direct models.
- **Automatic Cooldowns**: Automatically places rate-limited (`429`) models on a 15-minute cooldown and fails over to secondary options.

### Review Policies (`reviewPolicy`)

| Policy | Behavior |
| :--- | :--- |
| `"strict"` | Full adversarial subagent review required on every draft and validation step. |
| `"balanced"` *(default)* | Routine/standard fixes auto-promote once requirements/evidence bars are met; complex tasks undergo review. |
| `"off"` | Disables subagent reviews entirely while keeping disk journaling and plan tracking intact. |

*Configure rules per model via `"policyByModel": { "gemini/*": "balanced", "claude/*": "strict" }`.*

### 5-Level Difficulty Scaling & Model Capability Risk

`pi-quest` evaluates task complexity across 5 numeric tiers:
1. **`trivial` (Tier 1)**: Single-line fixes, typos, comment adjustments.
2. **`minor` (Tier 2)**: Small scoped modifications, configuration tweaks, localized helper functions.
3. **`standard` (Tier 3)**: Typical engineering features, bug fixes, or routine refactors requiring unit tests.
4. **`major` (Tier 4)**: Multi-file implementations, interface contracts, cross-module updates.
5. **`complex` (Tier 5)**: Architectural redesigns, kernel migrations, multi-service protocol changes.

Dynamic review gating compares the difficulty tier against the active model's capability tier (`modelCapabilityTier`). Highly capable reasoning models can fast-track low-risk tiers (1–2) under balanced policy, while lower-capability models or complex tiers (4–5) trigger thorough peer review.

### Earned Autonomy Ladder & Model Ratings

`pi-quest` dynamically scales review requirements based on an **Earned Autonomy Ladder**:
$$\text{ReviewNeed} = \frac{\text{Difficulty}}{\text{ModelAccuracy}} + (\text{Setbacks} \times 1.5)$$

- **Level 3 (Full Autonomy, $\text{ReviewNeed} \le 2.2$)**:
  High trust. Plan is auto-promoted without review subagents, and validation completes automatically upon passing test receipts or clean file trees.
- **Level 2 (Balanced Autonomy, $2.2 < \text{ReviewNeed} \le 4.5$)**:
  Routine tasks bypass drafting subagent review; completion is gated on execution test receipts.
- **Level 1 (Supervised Audit, $\text{ReviewNeed} > 4.5$)**:
  Mandatory independent reviewer and validator subagents on drafting, revisions, and completion.

#### Zero-Friction Implicit Behavioral Telemetry
Model reliability is continuously learned without manual surveys:
- **Commit Reversions**: Tracks git commit hashes delivered in `.pi/quest/recent-handoff.json` across 3 turns; if a commit is reset or reverted, the model receives a penalty ($S = 0.0$).
- **Developer Corrections**: Subsequent turns are monitored for user bug reports or complaints via semantic embeddings; corrections incur a retrospective penalty ($S = 0.25$).
- **Bayesian Ratings**: Updates model distributions ($\text{Beta}(\alpha, \beta)$) with memory discounting ($\gamma = 0.98$) stored in `.pi/quest/model-ratings.json`.
- **Dashboard Command**: Inspect active ratings with `/quest-ratings` (or `/quest ratings`).
- **Configurable Accuracies**: Set model accuracy baselines in `.pi/settings.json` via `"modelAccuracy": { "anthropic/claude-sonnet-5*": 0.95, "openai/gpt-4o*": 0.92, "local/*": 0.5 }`.

---

## 4. Turn-Coalesced Reviews, `[Drafter–Reviewer Dialogue]`, Failover & Invariant Seeding

When a quest enters peer review (in drafting, mid-flight plan revision, or validation), `pi-quest` guarantees reliable reviewer launches, structured drafter-reviewer convergence, and zero stalls on provider rate limits:

- **Turn-Coalesced Draft Reviews & Fast-Fail Cleanup**:
  - Passive edits (`write`/`edit`) to `.pi/quest/future/<qid>.md` during a turn mark the draft dirty and coalesce into a single reviewer launch at `turn_end` (unless `quest_update_state({ plan })` already booted it), preventing mid-turn self-cancellation when the drafter edits the plan multiple times.
  - Draft maturity thresholds are checked against the current difficulty *before* recalibrating difficulty upward, preventing premature elevation fast-fails, and any fast-fail cleans up `inFlightReviews` via `cancelReview(qid)`.
- **Structured `[Drafter–Reviewer Dialogue]`**:
  - Resolved review rounds are recorded in `reviewHistory` and injected into the system context via `renderReviewerDialogue` as `[Drafter–Reviewer Dialogue]`, allowing the drafter and adversarial reviewer to exchange structured rounds in the background while you continue chatting concurrently.
- **Automated Fallback Chain**:
  The review runner dynamically enriches candidate models in prioritized order:
  1. Configured target model (e.g. `anthropic/claude-sonnet-5-5:low`).
  2. Thinking-stripped model (e.g. `anthropic/claude-sonnet-5-5`).
  3. Explicit fallbacks in `roles.reviewer` / `roles.validator`.
  4. Router default model (`config.router.default`, e.g. `antigravity/gemini-3.8-flash`).
  5. Active session model (`ctx.model`).
  6. `{ label: "inherit" }` (omitting the model flag entirely so `pi-subagents` uses its ambient default).
- **Provider-Level Rate-Limit Skipping & 15m Cooldown**:
  When a candidate model fails with HTTP `429`, quota exhaustion, or capacity errors (`isRateLimitOrQuotaError`):
  - Records a 15-minute cooldown on the model key, its stripped variant, and the provider prefix (`provider:<prov>`, e.g. `provider:anthropic`).
  - All subsequent candidate models under the same provider namespace are immediately skipped without wasting network requests or timing out.
  - The reviewer immediately fails over to an independent provider (e.g. `antigravity/gemini-3.8-flash`) or `{ label: "inherit" }`, returning a timely verdict.
- **Active Invariant Draft Seeding**:
  When drafting opens, `pi-quest` queries persistent memory for standing operational directives and architectural invariants (`level: "L2"`). These invariants are embedded directly into the draft proposal (`## Context / Background Discussion`), ensuring that the planner, peer reviewers, and validators adhere to established project rules from the outset.

---

## 5. Zero-Config Bring-Up & Diagnostics

`pi-quest` operates with zero manual configuration:
- **Automatic Daemon Start**: Automatically detects and launches `axil-auren` on port 4242 for local intent evaluation.
- **Embedding-Only Model Provisioning & Visual Status**: Automatically downloads only the required fast embedding model (`bge-base`, 117 MB). Unused inference/chat models (`qwen`, `olmoe`) are never downloaded. Non-blocking download progress (`⬇️ bge-base (42%)`) and active model status (`⚡ bge-base`) appear in the status bar under `quest-judge`.
- **Proactive Dependency Checks**: On `session_start`, checks core C engine versions and alerts with remediation steps if anything is outdated.
- **Deterministic Trigger Words**: Starting a prompt with `quest:`, `task:`, `fix:`, or `feat:` starts the quest instantly with 0ms latency.
- **In-Memory Embedding Classification**: Steering ("go on", cancel), quest-vs-conversation, difficulty tier, and plan verification are decided by nearest-example embeddings evaluated server-side via `POST /v1/systemone` (~5–15 ms, SIMD dot products in C). If `axil-auren` is offline, `pi-quest` requires explicit trigger prefixes or commands (`quest:`, `fix:`, `/quest`) without guessing or invoking generative LLMs. Each move was measured on held-out English/Portuguese corpora and adopted with zero wrong state-changing verdicts. See [`docs/OPERATOR_GUIDE.md`](docs/OPERATOR_GUIDE.md#what-decides-what-embeddings-judge-or-neither).
- **Corrective Bug Report & Directive Intent Recognition**: Recognizes bug reports ("There's a bug in X", "The items are showing up as ephemeral objects instead of stones") and negative directives ("Don't do X, do Y instead", "You shouldn't draw X as Y") as quest intent with `bugfix` kind via embeddings. When offline, explicit trigger commands are used.
- **Daemon Circuit Breaker & Resilient Fast Timeout**: All calls to `axil-auren` run with strict 250ms timeouts and an in-memory circuit breaker (`30s` cooldown). If the local daemon is uncommunicative, stopped, or slow, the circuit breaker opens daemon-wide; subsequent calls fail fast in ~1 µs without touching the network or socket layer, preventing Pi event loop hangs.

### Diagnostic Command
```text
/quest doctor
```
Inspects live judge status, active model router matrix, core C engine versions, and evaluation policy.

---

## 6. The Agent's Tools

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `quest_update_state` | `objective`, `draftName`, `difficulty`, `plan`, `analysis`, `planRevision`, `claimComplete` | Primary write path: atomic single-call quest creation, plan authoring, mid-flight plan revision, and completion claims. |
| `quest_subquest` | `goal`, `brief`, `allowedPaths`, `requiredTestCommands` | Spawns a sequential child quest on the stack for complex initiatives. |
| `quest_archive` | `outcome`, `summary`, `action` | Concludes and archives the active quest (`outcome: "completed"` requires validation PASS; optional `action: "integrate" \| "keep" \| "keep-slot" \| "discard"` controls worktree disposition); returns structured execution diagnostics (duration, turn count, tool calls breakdown, diff stats). |
| `quest_rebut` | `rebuttal` | Submits concrete evidence addressing reviewer findings, booting a fresh review. |
| `quest_ask_human` | `question`, `default`, `timeoutMs` | Asks the human with a recommended default, continuing autonomously on absence. |
| `quest_recover` | `qid` | Reconstructs quest state from the transcript after crashes or context resets. |
| `quest_handoff` | `qid`, `notes` | Writes an honest, self-contained handoff for the next agent to `.pi/quest/handoffs/<qid>-<stamp>.md` and returns it (see §7a). |
| `quest_scratches` | `slotId` | Inspects scratch workspace slots (`.pi/scratch/slot-N`), assigned quests, process health, git status, and current activity. |
| `quest_run_test` | `command` | Safely executes a verification test inside the active worktree (or primary repo root) and records the test receipt. |

---

## 7. Slash Commands Reference

All operator commands live under **`/quest`** (with interactive tab-completion for subcommands and quest names):

| Command | Alias | Description |
| :--- | :--- | :--- |
| `/quest` | | Show self-explaining quest status card (active quest, phase, plan path, next action, and subcommand reference), or auto-resume a lone draft when idle. |
| `/quest <name\|qid>` | `/quest resume <name\|qid>` | Switch to or resume a quest by its readable draft name or QID. |
| `/quest edit` | `/quest plan` | Open the active quest plan file (`.pi/quest/future/<qid>.md`) in `$EDITOR` (or `planEditor`). |
| `/quest list` | `/quest ls` | List active & draft quests with triage verdicts (`active`, `fresh`, `stale`, `orphan`, `empty-shell`), age, requirement progress, and active worktree slot. |
| `/quest pick` | `/quest switch` | Interactively select a quest to resume. |
| `/quest new [goal]` | `/quest chain` / `/quest next` | Retire the current quest while keeping its scratch slot (`.pi/scratch/slot-N`) and branch intact, re-enable `pi-quest`, and start a new quest on top of that slot's work (inferring `[goal]` from prior conversation when referential/omitted). |
| `/quest finish [--keep-slot]` | `/quest merge` / `/quest integrate` | Complete and integrate the active quest, or squash-merge a retained scratch slot (`.pi/scratch/slot-N`) into `main` after manual testing (`--keep-slot` to keep the slot attached after squash-merging). |
| `/quest pause` / `/quest on [goal]` | `/quest off` / `/quest enable` / `/quest toggle` (`Alt+J`) | Pause, re-enable, or toggle `pi-quest` for the current session (`⏸️` in status bar; starts disabled by default unless `"enabled": true` is set in `.pi/settings.json`). `/quest on [goal]` starts a quest immediately using prior conversation context. |
| `/quest cancel` | `/quest cancel-review` | Cancel any currently running in-flight review or validation and unblock tool execution. |
| `/quest del [qid\|flags]` | `/quest drop` | Delete/abandon the active quest (`--keep-slot` / `-s` to keep slot work intact, `--integrate` / `-i`, `--keep` / `-k`, `--discard` / `-d`), a named draft quest, or batch-prune drafts (`--all`, `--stale`, `--empty`, `--orphans`, `--days N`, `--dry-run`). |
| `/quest handoff [qid]` | | Write and show a handoff for the active (or named) quest. |
| `/quest slots` | `/quest scratches` | Inspect active scratch workspace slots (`.pi/scratch/slot-N`), assigned quests, process health, and working tree state. |
| `/quest doctor` | | Check live health of decision judge, latency, models, and word families. |
| `/quest policy` | | Inspect active model, effective review policy, and draft quality rules. |
| `/quest router` | | Inspect phase $\times$ difficulty matrix cells, active routes, and cooldown timers. |
| `/quest ratings` | | Inspect model accuracy ratings, learned Beta distributions, and autonomy levels. |

---

## 7a. Continuity: Handoffs, Compaction & Draft Triage

Context gets lost: compaction, a fresh agent, a new session. pi-quest packages the quest so nothing the operator asked for is forgotten.

- **Handoff documents** (`quest_handoff`, `/quest handoff`). Deterministic, generated from quest state and the quest doc — never from the agent's self-assessment:
  the operator's request **verbatim**; every later directive (refinements, follow-ups, amendments, answers) deduplicated; an **Asked vs. accomplished** table where only recorded status (RTM verified/satisfied, a checked box) counts and everything else is marked **UNVERIFIED**; the approved plan; files touched and `git diff --stat` since the base commit; last test receipt and review verdict; blockers and running sub-quests; the exact next action; resume rules; and the agent's own `notes` (root causes, dead ends, gotchas).
- **Auto-handoff on compaction.** `session_before_compact` writes a handoff before the transcript is summarized; after `session_compact` the next turn gets a one-shot `[Post-Compaction Handoff]` pointer (path, unverified requirement ids, next action).
- **"Give me a handoff" is a meta request, not a requirement.** A `handoff` intent (embedding exemplars in EN/PT/ES, sigils `!handoff` / `handoff:`) writes a baseline handoff and steers the agent to enrich it via `quest_handoff {notes}`; it is never recorded as an R#, amendment, or refinement.
- **Idempotent directives & auto-dedupe.** Repeating a message never mints a second amendment, refinement, follow-up, or requirement (exact match after whitespace/case normalization), and quest doc writes automatically deduplicate bullets in place.
- **Draft triage** (`/quest list` & `/quest del`). `/quest list` displays every quest in `.pi/quest/future` with age, phase, requirement progress, plan presence, parent link, and a verdict: `active` (active quest and its stack — never pruned), `fresh`, `stale` (≥ `--days`, default 7), `orphan` (parent quest gone), `empty-shell` (no requirements, no plan). `/quest del` removes the active quest, named drafts, or batch-prunes selected drafts (`--all`, `--stale`, `--empty`, `--orphans`, `--dry-run`) directly without creating legacy `.zip` archives.

---

## 7b. Worktrees, Submodules & Scratch Workspaces

Implementation work runs isolated in dedicated git worktrees to keep the primary workspace stable and clean:

- **Warm Scratch Pool (`.pi/scratch/slot-N`)**: A pool of pre-warmed worktree slots avoids expensive submodule cloning delays during execution. Slots dynamically scale up to capacity (`worktreePoolMaxSize`, default 8) and automatically reclaim orphaned or terminated leases.
- **Manual Testing in Worktree on Completion (`keep-slot`, `squash-keep-slot`, `/quest finish`)**:
  When a quest completes (`quest_archive` or `/quest finish`), the operator can choose how to handle the worktree slot:
  - **Squash-merge & release** (`integrate`, default): squash-merges `quest/<qid>` into `main` and releases `slot-N`.
  - **Leave in worktree slot for manual testing before merge** (`keep-slot`): leaves `quest/<qid>` unmerged in `.pi/scratch/slot-N` so you can test or inspect it manually before integrating into `main` via `/quest finish`.
  - **Squash-merge into `main` AND keep worktree slot alive** (`squash-keep-slot`): squash-merges into `main` while keeping `.pi/scratch/slot-N` checked out at the new `main` HEAD for post-merge testing.
- **Fail-Safe Integration & Slot Retention on `/quest del`**: When abandoning an active quest via `/quest del`, the operator can choose to:
  - **Integrate** (`--integrate` / `-i`): squash-merge the feature branch into the primary branch and free the slot.
  - **Keep work in slot** (`--keep-slot` / `-s`): delete the quest record while leaving `slot-N` and all its committed and uncommitted changes untouched as the active workspace.
  - **Keep branch unmerged** (`--keep` / `-k`): preserve `quest/<qid>` unmerged and reset/free `slot-N`.
  - **Discard** (`--discard` / `-d`): discard changes and reset/free `slot-N`.
- **Tool Interception & Jailing**: During the `implementing` phase (or whenever a slot is retained), file edits, bash executions, background tasks, and subagent runs are jailed to the active worktree path.
- **Clean Status HUD**: The status bar displays the phase icon (`🔍`, `📝`, `👀` while reviewing, `🔨`, `🧪`, `⏸️` when paused), sub-quest depth (`↳ `, `↳₂ `), readable quest name, scratch slot badge (`(1)`, `(2)`, `(wt)`), and passing test checkmark (`✓`), e.g. `🔨 ↳ fix-seams (1) ✓`. `/quest slots` provides an instant overview of all slots, assigned quests, and working tree states.

---

## 7c. Common Operator Workflows

1. **Brainstorm with Argon first, then activate a quest (`/quest on`, `"quest: Go for it."`, `/quest new`)**:
   - Start your session chatting with Argon (`antigravity-acp/gemini-4-argon:high`) while `pi-quest` is idle or paused (`⏸️`).
   - Once you are satisfied with the understanding and plan, run `/quest on`, `/quest on [goal]`, `/quest new [goal]`, or say `"quest: Go for it."`. `pi-quest` extracts the objective from the prior conversation, writes `.pi/quest/future/<qid>.md`, and conducts the `[Drafter–Reviewer Dialogue]` in the background.
2. **Toggle or pause quest enforcement (`Alt+J` / `/quest off` / `/quest on`)**:
   - Press **`Alt+J`** (or run `/quest off` / `/quest pause`) to pause `pi-quest` at any time and work freely without draft gates or automatic quest creation.
   - Press **`Alt+J`** again (or run `/quest on`) to resume the paused quest right where you left off.
3. **Test in the scratch worktree before or after merging (`keep-slot`, `squash-keep-slot`, `/quest finish`)**:
   - Select `"Leave in worktree slot for manual testing before merge"` (`keep-slot`) when archiving a completed quest to test in `.pi/scratch/slot-N` before touching `main`.
   - When ready to integrate into `main`, run **`/quest finish`** (or `/quest merge` / `/quest integrate`, optionally with `--keep-slot` to keep the slot alive after merging).
4. **Continue work in the same scratch slot with a brand-new quest (`/quest new`)**:
   - When an active or paused quest has become unwieldy and you want to plan a fresh quest on top of the current `slot-N` worktree without merging or resetting the slot:
     ```text
     /quest new Add atmospheric scattering and horizon fog
     ```
   - Or run `/quest new` with no arguments (or `/quest del --keep-slot`) to retire the old quest while keeping `slot-N` attached, then describe your next task in chat.
5. **Delete a quest without freeing or resetting its slot (`/quest del --keep-slot`)**:
   - Run `/quest del --keep-slot` (or `/quest del -s`, or select `"Keep work in slot (do not reset or free slot)"` in `/quest del`) to delete the quest while keeping all committed and uncommitted work in `.pi/scratch/slot-N`.
   - To later release and reset a retained idle slot, run `/quest del --discard`.
6. **Stay in-quest during validation or archive (`decline` / `Cancel archive`)**:
   - If the validator passes or asks to archive before you are satisfied, reply **`decline`** (or give corrective instructions like `"No, DECLINE. Check what happens when zooming out"`) or choose **`"Cancel archive (stay in quest)"`** (or press `Escape`) at the squash-merge prompt. The quest demotes back to `implementing` with tools unlocked.
7. **Prune stale or orphan draft quests (`/quest list` & `/quest del`)**:
   - Inspect all drafts with `/quest list`, preview cleanup with `/quest del --stale --empty --orphans --dry-run`, and delete with `/quest del --stale --empty --orphans` (or `/quest del <qid|name>`).

---

## 8. Development & Testing

```bash
npm --prefix .pi/extensions/pi-quest test    # Run full test suite (770+ unit & integration tests)
npm --prefix .pi/extensions/pi-quest run zip # Package distribution bundle (pi-quest-bundle.zip)
```

## License

BSD 2-Clause License. Copyright (c) 2026, tty-pt. See `LICENSE`.
