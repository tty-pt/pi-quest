# Operator Guide to pi-quest

`pi-quest` provides autonomous, disciplined task workflows for the Pi coding agent. It organizes work into three clear phases:

```text
[ Drafting ] ──(Plan approved / "go")──► [ Implementing ] ──(claimComplete)──► [ Validating ] ──(Verified / "ship it")──► [ Completed ]
```

---

## The Three Phases & Natural Human Steering

You don't need to remember cryptic commands or rigid syntax. Speak naturally, in any language, at any time (the judge interprets your message; see *Judge-first understanding* below):

| Phase | What the Agent is Doing | Natural Operator Shortcuts |
| :--- | :--- | :--- |
| **Drafting** (Planning) | Researches the codebase, analyzes requirements, and drafts a plan in `.pi/quest/future/<qid>.md`. | Say **`go`** (or *proceed*, *start coding*, ...) to skip plan review and jump straight to implementation. |
| **Implementing** (Coding) | Edits code, runs builds, and executes unit/integration tests according to the approved plan. | Normal conversation. Refine requirements or report unexpected behavior at any time. |
| **Validating** (Review) | An adversarial subagent verifies the code diff and test receipts against acceptance criteria. | Say **`go`** (or *ship it*, *looks good*, *confirm*, ...) to accept completion and archive the quest immediately. |

---

## Automatic Safeguards & Circuit Breakers

1. **Two-Strike Circuit Breaker:**
   If the plan reviewer or completion validator rejects the work **2 consecutive times**, the automated review loop automatically **pauses**. The agent will stop retrying in a loop and ask you directly how you want to proceed.
2. **Human Supremacy:**
   The human operator is the ultimate authority. You can override the reviewer in drafting (with `go`) or the validator in completion (with `go` / *ship it*) at any time, even if a subagent reviewer is configured and active.
3. **Judge-first understanding (no word lists in code):**
   Every operator message is interpreted **once** by the judge (`src/domain/intent.ts`), in any language: *"looks good to me, wrap it up"*, *"pode seguir em frente"*, *"cancel"*, *"!rule must use UTF-8"* all become a typed intent that the phase handlers act on. The judge must answer with one of a closed set of labels; an unknown or failed answer is never guessed at.
   **When the judge is off or unreachable** the fallback contains exactly one built-in word, **`go`** (exact message, case/punctuation-insensitive), plus any words *you* list in `steeringPhrases`. Everything else degrades to a recorded refinement, which can never advance, abort or archive a quest. Explicit syntax always works without a judge: slash commands and the sigils `!rule`, `!sq`, `!later`, `!chat`, `? `.

   ```json
   { "pi-quest": { "steeringPhrases": ["avança", "vai em frente"] } }
   ```

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
- Set `"judgeMode": "off"` or `"difficultyMode": "heuristic"` to run 100% locally with zero network calls (steering then needs `go` / your `steeringPhrases`).
- `steeringPhrases`: exact messages (any language) that advance a quest when the judge is unavailable.
- `testCommands`: extra command prefixes that count as test/build evidence (built in: `make`, `npm|pnpm|yarn|bun|cargo|deno|go test`, `pytest`, `jest`, `vitest`, `tsc`, `./test`, `test.sh`).
- `lintRules`: repo-local diff lint rules `{id, message, linePattern, filePattern?, excludeFilePattern?, excludeLinePattern?}` checked at completion. None ship with the extension (except unresolved conflict markers); `{file}` / `{line}` expand in `message`.

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
At detection time the judge classifies the request (trivial / standard / complex) in any language. Without a judge the fallback is purely structural, with no keywords: **complex** if the request names four or more distinct file paths, otherwise **standard**.

A complex task worded plainly is therefore treated as standard when no judge is available and gets neither the strong planner nor a review. Use a trigger prefix, or have the agent call `quest_update_state` with `difficulty: "complex"` / `"trivial"`. Likewise, without a judge a free-form message never opens a quest by itself: use a trigger prefix (`quest:`, `fix:`, ...) or `/quest`.

### 2. Drafting
Research, reads and test runs are never blocked; the only writable file is the draft (`.pi/quest/future/<qid>.md`). Writing the plan before recording findings is refused with `RESEARCH_REQUIRED`. The plan must meet the thresholds for its difficulty (default standard: 2 requirements, 7 evidence items). The router picks the planning model per turn from the phase × difficulty matrix: `drafting.complex` uses the first available model in its chain (e.g. Sonnet 5.5 with `:high` thinking, then Flash); other difficulties use `drafting.*`. Multi-tool continuation turns keep the model they started on, so a difficulty change takes effect on the next turn.

### 3. Review
- **standard / trivial**: review is bypassed. Once the plan is authored and meets the bar, the quest promotes to implementing and the agent is told "Draft review bypassed under policy 'balanced'". No subagent runs. If the draft is below the bar (too few requirements/evidence, requirements not mapped into the plan, or an empty plan), nothing promotes, but the agent is woken with the draft profile listing what is missing; saving re-checks. Keep `## ` headings out of the plan body (use `###`).
- **complex**: a reviewer subagent runs on `roles.reviewer` (with its model chain as above). PASS promotes. FAIL returns findings; saving the revised plan boots a fresh review. A launch failure retries up to 3 times with exponential backoff (4s base); two consecutive FAIL verdicts pause the loop and ask the operator, who may reply `go`.
- `go` (or `go on`, `proceed`, ...) promotes at any time.

### 4. Implementing
Tools are unrestricted and the router uses the `implementing` cell (Flash in the sample config, for every difficulty). Repository rules (TDD, `make`, boundary scripts) come from `AGENTS.md`; pi-quest does not enforce them. A plan revision mid-way is re-reviewed and holds tools (`AWAITING_REVIEW: PLAN_REVISION_REVIEW`) until the verdict arrives. If that hold is ever stuck, `/quest-cancel-review` or a plain `go` clears it.

### 5. Validation
The validator (`roles.validator`, falling back through its model chain) checks the work against the plan. Under `balanced`, a standard quest whose tests pass auto-archives to `.pi/quest/archive/<qid>.zip`. A FAIL returns to implementing with findings. `go` (or *ship it* / *confirm* via the judge) archives immediately.

### Known limits
- Only the drafting phase uses the strong model by default; implementation and validation stay on the cheap model unless the matrix says otherwise.
- If the planner and the reviewer are the same model the review is not independent; prefer a different model for `roles.reviewer`.
- Provider auth and quota are not checked at config time; a bad key surfaces as a launch failure and walks the fallback chain.
