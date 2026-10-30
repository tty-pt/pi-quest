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

1. **Drafting**: The agent explores the codebase (read/search/test runs flow freely) but may only write to its draft plan (`.pi/quest/future/<qid>.md`). Content changes trigger an independent reviewer. You can reply `go` or `proceed` at any moment to bypass review.
2. **Implementing**: The agent works from the approved plan. Unexpected obstacles and discoveries are recorded as amendments on disk.
3. **Validating**: A validator reviews the implementation against the plan and test results. A PASS archives the finished quest into `.pi/quest/archive/<qid>.zip`. Reply `go` (or *ship it* / *confirm* in any language, classified by embedding similarity) at any time to accept immediately.

### Instant Plan Overlay (`Ctrl+Q`)
Press **`Ctrl+Q`** in the terminal at any time to open a full-screen, scrollable viewer of the active quest document, requirements, and progress.

---

## 2. Conversational Brainstorming vs. Quest Workflows

`pi-quest` distinguishes between **open conversation / brainstorming** and **task execution directives**:

- **Chat & Brainstorming** (No quest opened, no files locked):
  - When you ask open-ended questions, explore design ideas, or brainstorm (*"Let's think this through"*, *"Can you explain how this module works?"*, *"What are our options for handling this issue?"*, or prefix with `? ` / `!chat`), the agent answers directly in conversational markdown.
  - The worktree is **never locked**, and no draft plan is forced upon you.
- **Quest Directives** (Quest workflow begins):
  - When you issue an imperative task instruction (*"Fix the bug in the parser"*, *"Implement the new API endpoint"*, *"Refactor the auth handler"*), or use an explicit trigger (`quest:`, `!task`, `/quest`), `pi-quest` opens a quest, generates a draft scaffold, and manages the lifecycle.

### Flexible Operator Steering & Compound Approvals

Promoting a draft or approving a plan revision does not require rigid magic words:
- **Predetermined Word**: A single word `go` (case- and punctuation-insensitive) advances with zero network dependency.
- **Multilingual Semantic Assent**: Natural approvals in English and Portuguese (*"proceed"*, *"approved"*, *"looks good"*, *"bora"*, *"aprovado"*, *"vai em frente"*, *"manda bala"*) are evaluated server-side via `POST /v1/classify`.
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

These are evaluated in ~20 ms via in-memory embeddings (`POST /v1/classify`) with **100% recall** and **0% false quests** on conversational benchmarks. They open a provisional quest draft automatically and classify into **`kind: "bugfix"`** without needing `/quest` or explicit prefixes. When the server is offline, fallback heuristics (`isCorrectiveOrBugHeuristic`) maintain deterministic recognition.

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

---

## 4. Reviewer Failover & Cooldown Architecture

When a quest enters peer review (in drafting, mid-flight plan revision, or validation), `pi-quest` guarantees that external provider rate limits or quota depletion cannot stall the agent:

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

---

## 5. Zero-Config Bring-Up & Diagnostics

`pi-quest` operates with zero manual configuration:
- **Automatic Daemon Start**: Automatically detects and launches `axil-auren` on port 4242 for local intent evaluation.
- **Embedding-Only Model Provisioning & Visual Status**: Automatically downloads only the required fast embedding model (`bge-base`, 117 MB). Unused inference/chat models (`qwen`, `olmoe`) are never downloaded. Non-blocking download progress (`⬇ bge-base (42%)`) and active model status (`⚡ bge-base`) appear in the status bar under `quest-judge`.
- **Proactive Dependency Checks**: On `session_start`, checks core C engine versions and alerts with remediation steps if anything is outdated.
- **Deterministic Trigger Words**: Starting a prompt with `quest:`, `task:`, `fix:`, or `feat:` starts the quest instantly with 0ms latency.
- **In-Memory Embedding Classification**: Steering ("go on", cancel), quest-vs-conversation, difficulty tier, and plan verification are decided by nearest-example embeddings evaluated server-side via `POST /v1/classify` (~10–20 ms, SIMD dot products in C). If `axil-auren` is offline, `pi-quest` falls back to deterministic local heuristics (explicit trigger words, `/quest`, structural path counts) without invoking generative LLMs. Each move was measured on held-out English/Portuguese corpora and adopted with zero wrong state-changing verdicts. See [`docs/OPERATOR_GUIDE.md`](docs/OPERATOR_GUIDE.md#what-decides-what-embeddings-judge-or-neither).

### Diagnostic Command
```text
/quest doctor
```
Inspects live judge status, active model router matrix, core C engine versions, and evaluation policy.

---

## 6. The Agent's Tools

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `quest_update_state` | `objective`, `draftName`, `difficulty`, `plan`, `analysis`, `planRevision`, `claimComplete` | Primary write path: creates quests, authors plans, revises plans mid-flight, and claims completion. |
| `quest_subquest` | `goal`, `brief`, `allowedPaths`, `requiredTestCommands` | Spawns a sequential child quest on the stack for complex initiatives. |
| `quest_archive` | `outcome`, `summary` | Concludes and archives the active quest (`outcome: "completed"` requires validation PASS). |
| `quest_rebut` | `rebuttal` | Submits concrete evidence addressing reviewer findings, booting a fresh review. |
| `quest_ask_human` | `question`, `default`, `timeoutMs` | Asks the human with a recommended default, continuing autonomously on absence. |
| `quest_recover` | `qid` | Reconstructs quest state from the transcript after crashes or context resets. |

---

## 7. Slash Commands Reference

| Command | Shortcut | Description |
| :--- | :--- | :--- |
| `/quest` | `Ctrl+Q` | View active plan in scrollable overlay, resume paused drafts, or create new quest. |
| `/quests` | | List active branch quests, future drafts, and archived completions. |
| `/quest-policy` | | Inspect active model, effective review policy, and draft quality rules. |
| `/quest-router` | | Inspect phase $\times$ difficulty matrix cells, active routes, and cooldown timers. |
| `/quest-del` | | Archive the active quest as abandoned. |

---

## 8. Development & Testing

```bash
npm --prefix .pi/extensions/pi-quest test    # Run full test suite (500+ unit & integration tests)
npm --prefix .pi/extensions/pi-quest run zip # Package distribution bundle (pi-quest-bundle.zip)
```

## License

BSD 2-Clause License. Copyright (c) 2026, tty-pt. See `LICENSE`.
