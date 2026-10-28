# Operator Guide to pi-quest

`pi-quest` provides autonomous, disciplined task workflows for the Pi coding agent. It organizes work into three clear phases:

```text
[ Drafting ] ──(Plan approved / "go")──► [ Implementing ] ──(claimComplete)──► [ Validating ] ──(Verified / "ship it")──► [ Completed ]
```

---

## The Three Phases & Natural Human Steering

You don't need to remember cryptic commands or rigid syntax. Speak naturally at any time:

| Phase | What the Agent is Doing | Natural Operator Shortcuts |
| :--- | :--- | :--- |
| **Drafting** (Planning) | Researches the codebase, analyzes requirements, and drafts a plan in `.pi/quest/future/<qid>.md`. | Say **`go`**, **`proceed`**, **`advance`**, or **`start coding`** to skip plan review and jump straight to implementation. |
| **Implementing** (Coding) | Edits code, runs builds, and executes unit/integration tests according to the approved plan. | Normal conversation. Refine requirements or report unexpected behavior at any time. |
| **Validating** (Review) | An adversarial subagent verifies the code diff and test receipts against acceptance criteria. | Say **`ship it`**, **`looks good`**, **`confirm`**, or **`done`** to accept completion and archive the quest immediately. |

---

## Automatic Safeguards & Circuit Breakers

1. **Two-Strike Circuit Breaker:**
   If the plan reviewer or completion validator rejects the work **2 consecutive times**, the automated review loop automatically **pauses**. The agent will stop retrying in a loop and ask you directly how you want to proceed.
2. **Human Supremacy:**
   The human operator is the ultimate authority. You can override the reviewer in drafting (with `go`) or the validator in completion (with `ship it`) at any time, even if a subagent reviewer is configured and active.
3. **Intent-Based Language Understanding:**
   You don't have to match exact words. Sentences like *"looks good to me, wrap it up"* or *"let's proceed with coding"* are automatically recognized by semantic intent analysis.
4. **Abandoning a Quest:**
   If you change your mind or want to cancel a quest, run `/quest-del` (or tell the agent to abort/cancel).

---

## Helpful Keyboard Shortcuts & Commands

| Key / Command | What It Does |
| :--- | :--- |
| **`Ctrl+Q`** | Opens a floating full-screen viewer of the active quest's plan and progress. |
| **`/quests`** | Lists all active and recent quests with their current phases. |
| **`/quest`** | Shows detailed status, difficulty, and links for the current quest. |
| **`/quest-del`** | Aborts and archives the active quest, unlocking files immediately. |

---

## Difficulty Tiers & Autonomous Sub-Quests

`pi-quest` automatically assesses task difficulty so simple fixes stay fast while massive overhauls stay organized:

- **`trivial`** (e.g. typos, renames, one-liners, minor config tweaks):
  Needs only 1 requirement and 2 evidence items. Zero sub-quests.
- **`standard`** (default feature work and bug fixes):
  Needs 2 requirements and 7 evidence items. Single-lane execution by default.
- **`complex`** (major refactors, architecture overhauls, multi-file migrations):
  Needs 3 requirements and 10 evidence items. Automatically triggers the **Foreman Sub-Quest Pipeline**.

### The Foreman Sub-Quest Pipeline (for Complex Tasks)
When a task is classified as `complex`:
1. The draft scaffold pre-populates structured backlog items under `## Sub-Quests`:
   ```markdown
   ## Sub-Quests
   - [ ] SQ1: Core architecture & contracts [paths: src/core] [tests: npm test] [req: R1]
   - [ ] SQ2: Feature implementation & integration [paths: src/feat] [tests: npm test] [req: R2]
   - [ ] SQ3: End-to-end verification [paths: tests/] [tests: npm test] [req: R3]
   ```
2. Upon plan approval (via reviewer PASS or operator `go`), the Foreman automatically mounts `SQ1` onto `questStack` with bounded file access (`allowedPaths`) and assigned requirements.
3. When `SQ1` completes and passes tests, it archives, checks off `- [x] SQ1` on the parent plan doc, and automatically mounts `SQ2`.
4. When all sub-quests finish, control returns to the parent coordinator for final root integration validation and archive.

---

## Review Policies & Role Models

`pi-quest` allows you to customize review intensity and delegate roles to different models, balancing speed, cost, and discipline:

### Review Policies (`reviewPolicy`)
- **`balanced` (Frontier Mode - Recommended for Grok / Claude 3.5)**:
  - Bypasses plan review for `trivial` and `standard` tasks so your model can start coding immediately.
  - Skips validator subagent when tests pass cleanly (`exitCode 0`).
  - Automatically activates full adversarial review on `complex` tasks or when test verification fails.
- **`strict` (Default / Flash Mode)**:
  - Adversarial subagents audit every plan and every validation milestone, keeping cheaper/faster models strictly grounded.
- **`off` (Speedrun Mode)**:
  - Zero subagent review calls. You retain full quest journal benefits (checklists, git tracking, test receipts, status overlay) without subagent latency or cost.

### Model-aware policy (`policyByModel`)
Instead of one global `reviewPolicy`, map the model that is actually working to a policy. Rules are ordered; the first glob matching `provider/id` wins (`*` wildcard, case-insensitive, anchored; thinking suffixes like `:high` are ignored). No match falls back to `reviewPolicy`.

```json
"reviewPolicy": "strict",
"policyByModel": {
  "anthropic/claude-sonnet-5*": "balanced",
  "*flash*": "strict"
}
```

- The model is read live from pi (`ctx.model`), so a `/model` switch takes effect at the next review decision; the launch env (`PI_PROVIDER`/`PI_MODEL`) is only a fallback.
- On the `quest/auto` router the physical model it last routed to is matched, not the virtual `quest/auto` id. Before the first routed request, `router.default` is used.
- Applies to draft review, plan-revision review and validation. The draft profile and bypass wake messages say which rule applied (`review policy: balanced (… matched policyByModel "…")`).
- Unlisted models use `reviewPolicy` (default `strict`), so an unfamiliar model is never silently trusted.

#### Checking and troubleshooting
Run `/quest-policy` to see the active model, the configured vs effective policy, the rule that matched, and the quality tiers (the current quest's tier is marked). Invalid settings are not fatal — they fall back to defaults — but `/quest-policy` lists them under **Config Warnings** (bad policy names, unknown tiers, negative numbers, and rules that can never match because an earlier, broader rule shadows them). Put specific rules before general ones.

For one-off overrides without editing settings, use env vars: `PI_QUEST_POLICY_BY_MODEL="anthropic/*=balanced,*flash*=strict"` and `PI_QUEST_DRAFT_QUALITY=warn`. Settings take precedence over env.

### Draft quality bar (`draftQuality`)
Under `balanced`/`off` no reviewer reads the plan, so a deterministic depth bar stands in. In addition to the requirement/evidence counts, a draft needs, per difficulty tier:

| Tier | `citations` (resolve on disk) | `steps` (list items) | `requireVerification` |
|------|------|------|------|
| trivial | 0 | 1 | no |
| standard | 2 | 3 | yes |
| complex | 4 | 5 | yes |

- A *citation* is a `file:line` or `file:start-end` reference (in evidence or the plan) whose file exists and whose line is in range; invented or out-of-range ones do not count.
- A *step* is a numbered/bulleted/checkbox list item in the plan. A *verification step* is any mention of testing/verifying/validating/linting.
- Analysis quests only need the citation count.
- `mode`: `"enforce"` (default) holds a bypassed draft in drafting and wakes the agent with exactly what is missing; `"warn"` promotes but attaches an advisory; `"off"` disables the check. Under `strict` the findings are passed to the reviewer as advisory context and never block.
- The draft profile (`checkPlan` / on every save) always shows the quality line, so the agent can build up to the bar before saving.

```json
"draftQuality": {
  "mode": "enforce",
  "tiers": { "standard": { "citations": 3, "steps": 4 }, "complex": { "requireVerification": true } }
}
```

Shorthands: `"draftQuality": "warn"` sets just the mode; `"draftQuality": false` disables the check. Omitted tier fields keep their defaults.

### Role-Based Model Customization (`roles`)
If you use a premium reasoning model (like Grok or Claude 3.5 Sonnet) as your primary agent, you don't need to burn expensive tokens on reviewing. Delegate review and validation roles to fast, economical models:

```json
{
  "pi-quest": {
    "reviewPolicy": "balanced",
    "roles": {
      "reviewer": "google/gemini-2.5-flash",
      "validator": "google/gemini-2.5-flash",
      "judge": "qwen"
    }
  }
}
```

#### Reviewer / validator model chains

`roles.reviewer` and `roles.validator` accept a model string or an ordered list. The first entry is the primary; the remaining entries form the fallback chain, tried in order when the primary fails to launch with a provider/model/rate-limit error: model not found, unknown provider, rate limit / `429`, quota, `503` / `504` / `529`, `overloaded`, or `capacity`, and auth/permission errors (`401`, `403`, `permission_error`, `oauth_not_allowed`). Provider-auth failures now advance the chain instead of failing the review outright.

The chain is tried in order: the primary (verbatim, e.g. with a `:low` suffix), its suffix-stripped variant, then each chain entry (verbatim, then suffix-stripped), then the `PI_CRITICAL_REVIEW_MODEL_FALLBACK` env model if set. A string value has no chain; an array `"reviewer": ["a/x:low", "b/y"]` is equivalent to a primary of `a/x:low` with a fallback of `b/y`.

```json
"roles": {
  "reviewer": ["anthropic/claude-sonnet-5-5:low", "antigravity/claude-sonnet-5-5"],
  "validator": "antigravity/gemini-3.8-flash"
}
```

## Phase × Difficulty Model Router (`quest/auto`)

When using a subscription with rolling rate limits (such as Anthropic Claude Pro), coding loops (reading files, `make`, compiler iterations) can quickly deplete quotas. `pi-quest` registers a virtual model (`quest/auto`) that routes each request to an optimal physical model based on the current quest **phase** (`idle`, `provisional`, `drafting`, `implementing`, `validating`) and **difficulty** (`trivial`, `standard`, `complex`).

> **Selecting the router:** `quest/auto` is a normal model entry in pi. Pick it with `/model quest/auto` or set `"defaultModel": "quest/auto"`. If you select a concrete model (e.g. `anthropic/claude-sonnet-5-5`) the router never runs, even with `router.enabled: true`.

### Matrix Configuration (`router`)
Configure the routing matrix in `.pi/settings.json` under `pi-quest.router`:

```json
{
  "pi-quest": {
    "router": {
      "enabled": true,
      "provider": "quest",
      "id": "auto",
      "default": "antigravity/gemini-3.8-flash",
      "direct": "antigravity/gemini-3.8-flash:low",
      "cooldownMs": 900000,
      "matrix": {
        "drafting": {
          "complex": [
            "anthropic/claude-sonnet-5-5:high",
            "antigravity/gemini-3.8-flash"
          ],
          "*": "antigravity/gemini-3.8-flash"
        },
        "implementing": "antigravity/gemini-3.8-flash",
        "validating": "antigravity/gemini-3.8-flash"
      }
    }
  }
}
```

### Key Router Behaviors
- **Activation**: Switch in the interactive TUI with `/model quest/auto` or set `"defaultModel": "quest/auto"` in `settings.json`.
- **Wildcards (`*`) & Defaults**: Use `*` to cover all difficulties under a phase, or all phases. Unmatched cells fall back to `router.default`.
- **Fallback Chains**: Specify an array of models per cell. The router selects the first available model with configured credentials.
- **Quota & Rate-Limit Cooldown**: When a model encounters a `429`, quota exceeded, or capacity failure, it enters a temporary cooldown (default: 15 min / 900s) and automatically shifts requests to the next fallback model.
- **Prompt-Cache Friendliness**: Multi-tool continuation turns remain sticky on the current model to preserve prefix caching. Compaction summaries route to `router.direct`.
- **Inspection Command**: Run `/quest-router` to display the active quest cell, resolved candidate models, cooldown timers, and matrix overview.

---

## Mid-Quest Directives & Sub-Quest Control

When you speak to the agent mid-quest, `pi-quest` guarantees your instructions are never forgotten. You do not need to memorize any special commands or syntax — simply speak in plain English:

### Natural Conversational Interaction (Default)
`pi-quest` understands your intent directly:
- **Constraints & Rules** (*"Don't touch db.c"*, *"Port must be 8080"*, *"Make sure tests pass"*):
  Automatically recorded into `## Requirements` and `## Amendments`. The agent adopts the constraint immediately.
- **Separable Tasks & Sub-Quests** (*"Let's do the migration in a subquest"*, *"Can we spin up a subtask for auth?"*, *"While you're here, add an export feature"*):
  Automatically routed to the sub-quest engine. The task is queued into the parent plan's `## Sub-Quests` backlog for automated Foreman execution, or mounted immediately if urgent.
- **Concise Constraints**:
  Inputs as short as 3 characters are preserved without arbitrary length filtering.
- **Agent-Directed Triage**:
  The agent is reminded of active directives on every turn and uses its native tools (`quest_subquest` for separable sub-tasks, plan amendments for constraints) to organize the work.

### Optional Fast-Paths (Power Users & Scripts)
If you prefer explicit, deterministic 1-step routing without relying on natural language parsing, you can optionally prefix your message:
- **`!sq <goal>`** or **`subquest: <goal>`**: Immediately pauses the current task and spawns a child sub-quest (`switchNow: true`).
- **`!later <goal>`** or **`backlog: <goal>`**: Appends a new sub-quest (`- [ ] SQ<next>: ...`) to the parent plan backlog.
- **`!rule <req>`** or **`must: <req>`**: Immediately amends `## Requirements` (`R<next>`).
- **`!chat <text>`** or **`? <question>`**: Pure conversation bypass — answers your question without modifying quest documents or plans.

### Anti-Amnesia Engine
- Every active mid-quest directive is injected into the model's active attention window on **every single turn** via `before_agent_start`.
- Even after 30 tool calls, lengthy terminal outputs, or automatic conversation compactions, the model **always** sees your pending directives right above its tools.
- Validation is strictly gated: the completion validator verifies all user directives as acceptance criteria before the quest can be archived as completed.

---

## Configuration
```json
{
  "pi-quest": {
    "difficultyMode": "auto",
    "defaultDifficulty": "standard",
    "judgeMode": "auto",
    "midQuest": {
      "mode": "hybrid",
      "subquestAction": "queue_backlog",
      "autoAmendRequirements": true,
      "turnInjection": true,
      "promptTimeoutMs": 10000
    }
  }
}
```
- `midQuest.mode`: `"hybrid"` (default: auto-amends constraints, queues sub-quests), `"autonomous"` (full auto), `"interactive"` (prompts user), or `"off"`.
- `midQuest.subquestAction`: `"queue_backlog"` (adds to Foreman backlog), `"preempt_now"` (switches immediately), or `"ask_human"`.
- Set `"judgeMode": "off"` or `"difficultyMode": "heuristic"` to run 100% locally with zero network calls.

---

## Essential Slash Commands & Shortcuts

| Command / Key | Function |
| :--- | :--- |
| `Ctrl + Q` | Open the floating plan viewer overlay at any time. |
| `/quest` | Pick an idle quest, resume a previous quest, or view active status. |
| `/quest doctor` / `/quest-doctor` | Test live health of decision judge, latency, models, and word families. |
| `/quest-policy` | Show the effective review policy for the active model, the matching `policyByModel` rule, the draft quality tiers, and config warnings. |
| `/quest-router` | Show the `quest/auto` router cell, models and cooldowns. |
| `/quests` | Display all active, draft, and archived quests in a widget. |
| `/quest-del` | Abandon and archive the active quest or pop a child sub-quest. |


---

## What to Expect: A Quest End to End (balanced policy)

This section describes the behaviour with `reviewPolicy: "balanced"`, the router matrix above, and `roles.reviewer` set to a stronger model than the implementer.

### 1. Classification decides the path
At detection time the request text is classified. With no `judgeUrl` configured (and `judgeFallback: "heuristic"`) this is a regex heuristic:
- **complex**: words such as architecture, migration, rewrite, redesign, overhaul, cross-module, breaking change, concurrency, protocol change; or four or more distinct file paths in the request.
- **trivial**: a short request (< 500 chars, at most 2 paths) about a typo, rename, docs/readme, lint, version bump, etc.
- **standard**: everything else, which includes most feature requests.

The heuristic is crude: a complex task worded plainly is treated as standard and gets neither the strong planner nor a review. Put a trigger word in the request, or have the agent call `quest_update_state` with `difficulty: "complex"`.

### 2. Drafting
Research, reads and test runs are never blocked; the only writable file is the draft (`.pi/quest/future/<qid>.md`). Writing the plan before recording findings is refused with `RESEARCH_REQUIRED`. The plan must meet the thresholds for its difficulty (default standard: 2 requirements, 7 evidence items). The router picks the planning model per turn from the phase × difficulty matrix: `drafting.complex` uses the first available model in its chain (e.g. Sonnet 5.5 with `:high` thinking, then Flash); other difficulties use `drafting.*`. Multi-tool continuation turns keep the model they started on, so a difficulty change takes effect on the next turn.

### 3. Review
- **standard / trivial**: review is bypassed. Once the plan is authored and meets the bar, the quest promotes to implementing and the agent is told "Draft review bypassed under policy 'balanced'". No subagent runs. If the draft is below the bar (too few requirements/evidence, requirements not mapped into the plan, or an empty plan), nothing promotes, but the agent is woken with the draft profile listing what is missing; saving re-checks. Keep `## ` headings out of the plan body (use `###`).
- **complex**: a reviewer subagent runs on `roles.reviewer` (with its model chain as above). PASS promotes. FAIL returns findings; saving the revised plan boots a fresh review. A launch failure retries up to 3 times with exponential backoff (4s base); two consecutive FAIL verdicts pause the loop and ask the operator, who may reply `go`.
- `go` (or `go on`, `proceed`, ...) promotes at any time.

### 4. Implementing
Tools are unrestricted and the router uses the `implementing` cell (Flash in the sample config, for every difficulty). Repository rules (TDD, `make`, boundary scripts) come from `AGENTS.md`; pi-quest does not enforce them. A plan revision mid-way is re-reviewed and holds tools (`AWAITING_REVIEW: PLAN_REVISION_REVIEW`) until the verdict arrives. If that hold is ever stuck, `/quest-cancel-review` or a plain `APPROVE` clears it.

### 5. Validation
The validator (`roles.validator`, falling back through its model chain) checks the work against the plan. Under `balanced`, a standard quest whose tests pass auto-archives to `.pi/quest/archive/<qid>.zip`. A FAIL returns to implementing with findings. `ship it` / `confirm` archives immediately.

### Known limits
- Only the drafting phase uses the strong model by default; implementation and validation stay on the cheap model unless the matrix says otherwise.
- If the planner and the reviewer are the same model the review is not independent; prefer a different model for `roles.reviewer`.
- Provider auth and quota are not checked at config time; a bad key surfaces as a launch failure and walks the fallback chain.
