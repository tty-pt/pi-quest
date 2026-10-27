<p align="center">
  <img src="cover.png" alt="pi-quest cover banner" width="100%">
</p>

<p align="center">
  <strong>Supervised, Verifiable Epistemic Workflows for Pi Coding Agent</strong>
</p>

<p align="center">
  <a href="https://github.com/earendil-works/pi-coding-agent"><img src="https://img.shields.io/badge/Pi-Extension-19c7d4?logo=circle" alt="Pi Extension"></a>
  <a href="https://www.npmjs.com/package/@tty-pt/pi-quest"><img src="https://img.shields.io/npm/v/@tty-pt/pi-quest" alt="npm version"></a>
  <img src="https://img.shields.io/badge/License-BSD--2--Clause-blue.svg" alt="License">
</p>

# pi-quest

A quest journal for the Pi coding agent: every task gets a plan, an adversarial
review, and a validation pass, so complex long-running work gets done — and
checked — with almost no input from you.

pi-quest gives the agent a work ethic for big tasks. Instead of running
straight at a request, it researches, writes a plan, has the plan reviewed, and
only then touches code — then it validates what it built against the plan
before calling the task done. State is stamped into the conversation and
re-read before every reply, so quests survive compactions and restarts without
any setup.

**Conceived for Token Economy, Built for Every Model Tier:**
pi-quest was originally conceived with token economy in mind, designed so that fast, low-cost models (such as Gemini Flash) could follow through with disciplined planning, verification, and big tasks without wandering off or hallucinating completion. At the same time, pi-quest natively empowers expensive/frontier model users (e.g. Grok, Claude 3.5 Sonnet) by providing configurable review policies (`strict`, `balanced`, `off`) and role-based model delegation, so operators can use an expensive model for implementation while offloading reviews to fast, economical auditors, or bypass reviews entirely on routine tasks.

## How a quest goes

One quest is active at a time. Every quest runs through three modes:

1. **Drafting** — the agent may write exactly one file: the draft plan
   (`.pi/quest/future/<qid>.md`). Research, reading, and test runs are never
   blocked. Every content-changing save fires a fresh adversarial reviewer;
   a PASS promotes to implementing automatically, a FAIL returns findings.
   You can reply `go` at any moment to promote immediately — approval is
   never required.
2. **Implementing** — the agent works unrestricted from the approved plan.
   Setbacks and surprises are recorded as amendments; nothing blocks. A change
   of scope is a new quest.
3. **Validation** — a validator checks the implementation against the plan and
   its amendments. A PASS archives the quest (a slim `archive/<qid>.zip`);
   a FAIL sends it back to implementing with findings. You can reply `ship it`
   or `confirm` at any moment to accept completion and archive immediately —
   human judgment is supreme.

Some quests ask for a **verdict, not a change**: open them with
`quest_update_state { "kind": "analysis" }` and the deliverable is the quest's
own `## Analysis` section. A draft review PASS auto-claims straight to
validation, the validator judges the analysis against a bounded extract of the
research, and a FAIL returns the analysis to drafting for revision.

Large tasks split into **sub-quests**, each running the same three modes under
its own quest id (nested up to the depth cap). Plans can be **revised** mid-way
when reality contradicts them: each revision is re-reviewed, prior plans are
kept in history, and a rejected revision snaps back to the last good plan. The
validator judges plan moves too — the acceptance bar can't be quietly lowered
to fit what was built.

## Features

- **Plan gate** — drafting locks every write to the single draft file, so the
  agent thinks before it codes. Searches, inspections, and test runs flow
  freely.
- **Adversarial review** — every draft save boots an independent reviewer that
  returns PASS or FAIL with findings. A rebuttal with evidence reopens a
  question rather than arguing in circles.
- **Analysis quests** — `{ "kind": "analysis" }` turns the quest into a
  research deliverable: a draft PASS skips implementation and goes straight to
  validation, the validator checks the analysis against the research
  transcript, and a FAIL returns it to drafting.
- **Sub-quests** — complex sub-tasks become full-lifecycle quests up to the
  depth cap. A failed child never fails its parent: the parent records,
  adjusts, and continues.
- **Durability without setup** — quest state lives in the transcript as
  snapshots, re-read before every reply. Quests survive compaction and
  restarts; missing state recovers itself automatically.
- **Asks that never block** — when the agent needs a human decision it records
  a recommended default, waits a minute, and proceeds on absence. A late
  answer still applies whenever it arrives.
- **Autonomous Foreman Sub-Quest Dispatcher** — parses markdown backlog items
  from the plan and sequences sub-quests automatically, mounting each child onto
  the stack and resuming the coordinator when all tasks complete (or halting on failure).
- **Adaptive Difficulty Tiers** — automatically classifies incoming tasks as `trivial`,
  `standard`, or `complex`, dynamically adjusting required requirements and evidence counts
  so simple fixes are not burdened with unnecessary process.
- **Natural Language Steering & Human Supremacy** — operators can speak naturally at any
  time (e.g. *"proceed"*, *"looks good"*, *"ship it"*, *"wrap it up"*). Human intent overrides
  subagent reviews in both drafting and validation phases.
- **Mid-Quest Directive Engine & Anti-Amnesia** — guarantees remarks given to the agent
  mid-quest in plain conversational English are never forgotten (no special commands required).
  Injects active directives on every turn via `before_agent_start`, auto-amends `## Requirements`
  on disk, sequences new tasks into the Foreman's `## Sub-Quests` backlog, and supports optional
  fast-path shortcuts (`!sq`, `!later`, `!rule`, `!chat`).
- **Phase × Difficulty model router (`quest/auto`)** — pi-quest registers a
  virtual model, `quest/auto`, that routes every request to a physical model
  chosen by quest phase and difficulty (cheap model for implementing, a strong
  one for complex drafting, quota-aware fallbacks). Select it with
  `/model quest/auto` (or `"defaultModel": "quest/auto"`); inspect with
  `/quest-router`. Selecting a concrete model bypasses the router. See the
  operator guide.
- **Model-aware review policy (`policyByModel`)** — strict review for weaker
  models, balanced for frontier ones, chosen automatically from the model in
  use (the routed model when on `quest/auto`).
- **Draft quality bar (`draftQuality`)** — beyond requirement/evidence counts, a
  bypassed (balanced/off) draft must cite file:line locations that actually
  resolve, break into discrete steps and name a verification step — with
  per-difficulty defaults you can tune.
- **Two-Strike Loop Breakers** — caps consecutive review and validation rejections at 2,
  pausing automated thrashing and asking the operator directly how to proceed.
- **Deterministic Semantic Linters** — zero-token pre-validation linter verifying
  codebase constraints (pure-C UX `#ifdef` prevention, cross-module `#include "*.c"`
  barriers, git conflict markers) before expensive LLM review passes.
- **Persistent Test Receipts** — captures build and test execution exit codes and log
  tails, surviving transcript compactions and session reloads.
- **State & Disk Dual-Reconciliation** — automatically syncs parent markdown checkboxes
  and records execution receipts into `## Sub-Quests` upon child completion.
- **Full-screen plan viewer** — `[^Q]` floats the active quest's plan; the status
  bar shows the current phase and qid at all times.
- **External editor** — opens the plan in your configured editor (falls back to `$EDITOR`).
- **Idle boot** — a fresh session starts idle. Nothing takes over until you
  describe a request (which opens a quest) or run `/quest`. With several known
  quests, `/quest` lets you pick one.
- **Jev System One Quest Intent Judge** — automatically classifies incoming prompts
  using calibrated local neural judging, cleanly distinguishing casual conversational
  exchanges from multi-step engineering work that warrants an autonomous quest.
- **Standalone Distribution Packaging** — package the extension into an offline
  distribution bundle (`npm run zip` → `pi-quest-bundle.zip`) containing code,
  diagnostics, and manifests.

## Installation

```bash
pi install npm:@tty-pt/pi-quest
```

`/reload` picks up changes. Developing locally: drop the folder into
`.pi/extensions/pi-quest/` and restart pi.

## Usage

For an operator overview, see the [Operator Guide](docs/OPERATOR_GUIDE.md).

Engine usage — commands for the user:

| Command | Effect |
|---------|--------|
| `/quest` | Pick a quest when idle, or show the active quest. No argument resumes the newest / presents known quests for selection. |
| `/quest <qid\|name>` | Resume a named quest or drafting phase directly. |
| `/quest doctor` | Check judge endpoint health, network latency, detected models, and active trigger word families. |
| `/quest-doctor` | Dedicated command alias for `/quest doctor`. |
| `/quests` | List all quests with their phases and the active marker in an interactive terminal widget. |
| `/quest-del [qid]` | Archive (kill) the current or named quest. Only you can abandon a quest this way. |

Keyboard — the agent's own shortcuts:

| Key | Effect |
|-----|--------|
| `[^Q]` | Open the active quest's plan in a floating, near-fullscreen viewer |
| External editor | Open the active quest's plan in the external editor (`planEditor` or `$EDITOR`) |

### The plan viewer

| Key | Effect |
|-----|--------|
| `↑` / `k` / `↓` / `j` | Scroll one line |
| `PgUp` / `PgDn` / `Space` | Scroll one page |
| `Ctrl+U` / `Ctrl+D` | Scroll half a page |
| `Home` / `g`, `End` / `G` | Jump to top / bottom |
| `Enter`, `Esc`, `q` | Close the viewer |

The viewer is view-only and best-effort — the draft file stays the source of
truth.

### The status bar

The footer shows the active quest dimmed, with an `[F2]` hint, and flashes
bright for a few seconds right after the agent saves a draft change:

| Style | Format | Default |
|-------|--------|---------|
| `icon` | `📝 <qid> [F2]` | yes |
| `text` | `drafting <qid> [F2]` | |

Phase icons can be any of: `💤` idle · `🔍` provisional · `📝` drafting ·
`🔨` implementing · `🧪` validating · `📦` archived.

## Configuration

All settings are optional and live in `.pi/settings.json` under `"pi-quest"`:

```json
{
  "pi-quest": {
    "reviewPolicy": "balanced",
    "policyByModel": { "anthropic/claude-sonnet-5*": "balanced", "*flash*": "strict" },
    "draftQuality": { "mode": "enforce", "tiers": { "standard": { "citations": 2, "steps": 3 } } },
    "roles": {
      "reviewer": "google/gemini-2.5-flash",
      "validator": "google/gemini-2.5-flash"
    },
    "askTimeoutMs": 60000,
    "depthCap": 3,
    "draftThresholds": { "requirements": 2, "evidence": 7 },
    "bindings": { "reviewRunner": { "tool": "subagent" } },
    "statusStyle": "icon",
    "autoArchive": true,
    "judgeMode": "auto",
    "judgeUrl": "http://127.0.0.1:4242",
    "judgeModel": "qwen",
    "judgeFallback": "heuristic"
  }
}
```

| Setting | Values | Default | Effect |
|---------|--------|---------|--------|
| `reviewPolicy` | `"strict"` / `"balanced"` / `"off"` | `"strict"` | Review intensity: `"strict"` audits every plan and validation; `"balanced"` skips reviews on `trivial` and `standard` tasks when tests pass and audits `complex` tasks; `"off"` runs zero subagent reviews. |
| `policyByModel` | object: glob → policy | `{}` | Pick `reviewPolicy` from the model doing the work. Ordered rules matched against `provider/id` (`*` wildcard, case-insensitive, first match wins); no match keeps `reviewPolicy`. Under `quest/auto` the physical model it routed to is matched. See the operator guide. |
| `draftQuality` | object | `{ mode: "enforce", tiers: {…} }` | Deterministic depth bar for drafts: resolvable `file:line` citations, discrete plan steps, a verification step — per difficulty tier. `mode`: `"enforce"` holds bypassed (balanced/off) drafts below the bar, `"warn"` only reports, `"off"` disables. Defaults: standard 2 citations / 3 steps / verification, complex 4 / 5 / verification, trivial 0 / 1 / —. |
| `roles.reviewer` | model name / id | `undefined` (inherit) | Model used for plan review subagents (e.g. `"google/gemini-2.5-flash"`). Fallback: `PI_QUEST_REVIEWER_MODEL`. |
| `roles.reviewerFallback` | model id or list | `[]` | Ordered fallback models for plan review when the reviewer model fails with a provider/model/rate-limit error. |
| `roles.validatorFallback` | model id or list | `[]` | Same, for validation subagents. |
| `roles.validator` | model name / id | `undefined` (inherit) | Model used for completion validation subagents. Fallback: `PI_QUEST_VALIDATOR_MODEL`. |
| `roles.judge` | model name / id | `"qwen"` | Model identifier sent to Jev System One for intent and difficulty judging. Fallback: `PI_QUEST_JUDGE_MODEL`. |
| `askTimeoutMs` | number (ms) | `60000` | How long `quest_ask_human` waits before proceeding with its recommended default. |
| `depthCap` | number | `3` | How deep sub-quests may nest. |
| `difficultyMode` | `"auto"` / `"judge"` / `"heuristic"` / `"off"` | `"auto"` | Automatic task classification tier (`trivial`, `standard`, `complex`). Fallback: `PI_QUEST_DIFFICULTY_MODE`. |
| `defaultDifficulty` | `"trivial"` / `"standard"` / `"complex"` | `"standard"` | Fallback difficulty tier when classifier is off or offline. Fallback: `PI_QUEST_DEFAULT_DIFFICULTY`. |
| `difficultyThresholds` | object | `{ trivial: {1, 2}, standard: {2, 7}, complex: {3, 10} }` | Custom requirements and evidence thresholds per difficulty tier. |
| `draftThresholds.requirements` | number | `2` | Minimum requirements the draft reviewer demands before passing. |
| `draftThresholds.evidence` | number | `7` | Minimum evidence items (used when below the requirements bar). |
| `bindings.reviewRunner.tool` | tool name | `subagent` | Sub-agent tool that runs reviewers/validators isolated (falls back to the user path). |
| `statusStyle` | `icon` / `text` | `icon` | How the active quest renders in the status bar. |
| `autoArchive` | `true` / `false` | `true` | Whether a validation PASS concludes and archives the quest automatically; when `false`, the agent archives manually. |
| `reviewInactivityMs` | number (ms) | `300000` (5 min) | Subagent review watchdog inactivity timeout before aborting. |
| `reviewMaxDurationMs` | number (ms) | `1500000` (25 min) | Hard upper ceiling for reviewer subagent wall-clock execution. |
| `planEditor` | string / `null` | `null` | Custom external plan editor command (falls back to `$EDITOR`). |
| `judgeMode` | `"auto"` / `"systemone"` / `"heuristic"` / `"off"` | `"auto"` | How quest intent is evaluated on new user messages: `"auto"` / `"systemone"` queries Jev System One, `"heuristic"` uses pattern rules, `"off"` disables automatic quest initiation from prompt text. |
| `judgeUrl` | URL string | `http://127.0.0.1:4242` | Endpoint for Jev System One decisions (falls back to `PI_QUEST_JUDGE_URL` or `PI_MM_JUDGE_URL`). |
| `judgeModel` | model name | `"qwen"` | Model identifier submitted to the judge service (falls back to `PI_QUEST_JUDGE_MODEL` or `PI_MM_JUDGE_MODEL`). |
| `judgeKey` | token string | `undefined` | Optional Bearer authorization token for remote endpoints. |
| `judgeFallback` | `"skip"` / `"heuristic"` | `"skip"` | Fallback policy when the judge is unreachable or times out: `"skip"` fails closed to conversation with trigger prompts, `"heuristic"` falls back to legacy pattern rules. |
| `judgeTimeoutMs` | number (ms) | `2000` | Network timeout for judge decision evaluations. |
| `triggerPrefixes` | array of strings | `["quest:", "task:", "fix:", "feat:", "refactor:", "chore:", "test:", "@quest", "!quest"]` | Deterministic word families that immediately start a quest without querying the judge. |

### Environment Variables

| Variable | Corresponds to | Description |
| :--- | :--- | :--- |
| `PI_QUEST_REVIEW_POLICY` | `reviewPolicy` | Set review intensity (`strict`, `balanced`, `off`). |
| `PI_QUEST_REVIEWER_MODEL` / `PI_REVIEW_MODEL` | `roles.reviewer` | Pin specific provider/model for plan reviews. |
| `PI_QUEST_VALIDATOR_MODEL` / `PI_VALIDATOR_MODEL` | `roles.validator` | Pin specific provider/model for validation audits. |
| `PI_QUEST_JUDGE_MODEL` / `PI_MM_JUDGE_MODEL` | `roles.judge` | Model for Jev System One intent & difficulty judging. |
| `PI_QUEST_JUDGE_MODE` / `PI_MM_JUDGE_MODE` | `judgeMode` | Judge strategy (`auto`, `systemone`, `heuristic`, `off`). |
| `PI_QUEST_JUDGE_URL` / `PI_MM_JUDGE_URL` | `judgeUrl` | HTTP endpoint of the local neural judge daemon. |
| `PI_QUEST_JUDGE_KEY` / `PI_MM_JUDGE_KEY` | `judgeKey` | Optional Bearer authorization key for remote judge. |
| `PI_QUEST_JUDGE_FALLBACK` | `judgeFallback` | Fallback policy on judge timeout (`skip`, `heuristic`). |
| `PI_QUEST_JUDGE_TIMEOUT_MS` | `judgeTimeoutMs` | Abort timeout in ms for intent decisions (default: `2000`). |
| `PI_QUEST_DIFFICULTY_MODE` | `difficultyMode` | Classifier mode (`auto`, `judge`, `heuristic`, `off`). |
| `PI_QUEST_DEFAULT_DIFFICULTY` | `defaultDifficulty` | Baseline tier (`trivial`, `standard`, `complex`). |
| `PI_QUEST_TRIGGERS` | `triggerPrefixes` | Comma-separated list of deterministic trigger words. |

### Deterministic Trigger Word Families & Intent Detection

`pi-quest` uses a 2-tier deterministic architecture instead of unpredictable regex guessing:

1. **Trigger Word Families (Deterministic First)**:
   If a prompt starts with any recognized prefix (e.g. `quest:`, `task:`, `fix:`, `feat:`, `@quest`), `pi-quest` cleanly strips the prefix and starts the quest immediately. Zero network requests, zero latency, 100% deterministic.
2. **Intelligent Judge Evaluation (System One)**:
   When no trigger prefix is present and the local neural daemon is online, `pi-quest` queries System One on port `4242` to classify whether the user is initiating software tasks versus conversational dialogue.
3. **Offline Fail-Closed Safety**:
   If the judge is offline or times out, `pi-quest` avoids false-positive regex guesses: it leaves the conversation active and notifies the user to use a trigger prefix (e.g. `quest:`) or `/quest`.

### Diagnostic Commands

Run `/quest doctor` (or `/quest-doctor`) in the terminal to inspect health:
```text
/quest doctor
```
Outputs live endpoint connectivity, latency, loaded models, active trigger prefixes, and evaluation policy.

## Workspace on disk

Under `.pi/quest/` in the project:

```
future/<qid>.md     the quest document — one file for the whole life (draft plan, then the editable plan+## Status doc through implementing and validating)
.staging/<qid>/     ephemeral archive staging, removed after zipping (never surfaced, never read back)
archive/<qid>.zip   slim archive of each finished quest (agent doc + rendered view + manifest)
```

Every quest — draft or active — is identified by a short alphanumeric quest id
(`qid`). The conversation transcript is the source of truth; these files are
views.

## The agent's tools

Six tools the main agent uses on your behalf:

| Tool | Parameters | What it does |
|------|------------|--------------|
| `quest_update_state` | `objective`, `draftName`, `difficulty`, `plan`, `analysis`, `refinement`, `amendment`, `exactNextAction`, `checkPlan`, `checkAnalysis`, `planRevision`, `note`, `claimComplete`, `continueWork`, `continuePast` | Primary agent write path: creates quests, authors plans and analyses, records amendments mid-implementation, and claims completion for validation. |
| `quest_subquest` | `goal`, `brief`, `assignedRequirements`, `allowedPaths`, `requiredTestCommands`, `maxTurns`, `switchNow`, `acceptanceCriteria` | Spawns a bounded, sandboxed child sub-quest up to `depthCap`. Child executes isolated and returns findings to parent on completion. |
| `quest_archive` | `outcome: "completed" \| "failed"`, `summary` | Concludes active quest: archives run manifest, renders view, and packs slim `.zip`. (`COMPLETED` requires validated PASS; abandoning is user-only via `/quest-del`). |
| `quest_recover` | `qid` (optional) | Algorithmic state recovery: reconstructs quest state from raw session transcript without loss. Runs automatically if state is ever lost. |
| `quest_rebut` | `rebuttal` | Answers an adversarial review with file:line citations and evidence, reopening the question for fresh review instead of arguing in circles. |
| `quest_ask_human` | `question`, `default`, `timeoutMs` | Non-blocking operator question: registers a recommended default, waits for input or timeout, then automatically proceeds with default. |

## Requirements

- The Pi coding agent.
- pi-vcc with its compaction override enabled, so compacting is deterministic
  and never touches the snapshots quest state lives in.
- A sub-agent extension is optional. Without one, reviews and validations
  degrade to asking you: the plan is presented, a `go` promotes, and
  completion is accepted on your confirmation — the quest never stalls for a
  missing extension.