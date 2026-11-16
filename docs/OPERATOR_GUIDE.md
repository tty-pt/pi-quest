# Operator Guide to pi-quest

`pi-quest` provides autonomous, disciplined task workflows for the Pi coding agent. It organizes work into three clear phases:

```text
[ Drafting ] ──(Plan approved / "go")──► [ Implementing ] ──(claimComplete)──► [ Validating ] ──(Verified / "ship it")──► [ Completed ]
```

---

## The Three Phases & Natural Human Steering

You don't need to remember cryptic commands or rigid syntax. Speak naturally, in any language, at any time (an embedding classifier interprets your message; see *Embedding-first understanding* below):

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
3. **Embedding-first understanding (no word lists in code):**
   Every operator message is interpreted **once** (`src/domain/intent.ts`), in any language, into a typed intent that the phase handlers act on: *"looks good to me, wrap it up"*, *"pode seguir em frente"*, *"cancel"*, *"the code must never write to var/"* all classify without any keyword list.
   - **How:** the message is embedded by the local axil-auren server (`POST /v1/embeddings`, default model `bge-base`, ~15 ms) and compared by cosine similarity with labelled exemplar sentences per intent (`advance`, `abort`, `question`, `ack`, `refinement`, `constraint`, `subquest_now`, `subquest_later`; shipped in `src/domain/intent-exemplars.ts`). The nearest kind wins. Exemplar vectors are computed once per server/model and cached.
   - **Safety gates:** a verdict that changes quest state (advance, abort, constraint, sub-quest) must reach `intentMinSimilarity` (0.6) **and** beat the runner-up kind by `intentMinMargin` (0.075). Anything weaker is recorded as a plain refinement, which can never advance, abort or archive a quest. On the held-out evaluation corpus this gives 43/48 correct with **zero** false state-changing verdicts; the misses are mostly non-English phrasings and all degrade to a refinement.
   - **Why embeddings and not the generative judge:** small local judges are strongly position-biased when asked to pick one of several options (the same message gets different answers when the options are reordered), and they need hundreds of milliseconds to seconds per call. Nearest-exemplar search is deterministic, order-free and fast, so the generative judge is **not** consulted for steering (it is still used for difficulty and plan-verification questions).
   - **Teach it your language or style** by adding exemplars; they extend the shipped ones:

   ```json
   { "pi-quest": { "intentExemplars": { "advance": ["bora lá", "manda ver"], "abort": ["deixa estar, cancela"] } } }
   ```

   - **When embeddings are off or unreachable** (`embedMode: "off"`, server down; a dead server is skipped for 10 s) the fallback contains exactly one built-in word, **`go`** (exact message, case/punctuation-insensitive), plus any words *you* list in `steeringPhrases`. A message ending in `?` is a question. Everything else is a recorded refinement. Explicit syntax always works: slash commands and the sigils `!rule`, `!sq`, `!later`, `!chat`, `? `.

   ```json
   { "pi-quest": { "steeringPhrases": ["avança", "vai em frente"] } }
   ```

   Measure it on your own phrasing with the opt-in live evaluation (never part of `npm test`):
   `PI_QUEST_EVAL_JUDGE=1 deno test --allow-all --sloppy-imports tests/eval/` (set `PI_QUEST_EVAL_URL` for a non-default server). It prints accuracy and every miss, and fails on any false state-changing verdict.

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
- Set `"judgeMode": "off"`, `"embedMode": "off"` and `"difficultyMode": "off"` to run with zero network calls (steering then needs `go` / your `steeringPhrases`).
- `steeringPhrases`: exact messages (any language) that advance a quest when embeddings are unavailable (they also win instantly, with no embedding request, when embeddings are available).
- Steering classification (all optional; the defaults work with a local axil-auren on :4242): `embedMode` (`"auto"` | `"off"`), `embedUrl` (defaults to `judgeUrl`, then `http://127.0.0.1:4242`), `embedModel` (`"bge-base"`; `"bge-small"` is faster, a multilingual embedding model improves non-English accuracy), `intentMinSimilarity` (0..1, default 0.6), `intentMinMargin` (0..1, default 0.075; raise it for stricter state changes, lower it to act on vaguer messages), `intentExemplars` (extra labelled sentences per intent).
- Quest detection and difficulty (embeddings first; both optional): `questMinMargin` (0..1, default 0.10; higher opens fewer quests from free text), `questExemplars` (`{ "quest": [...], "conversation": [...] }`, any language), `difficultyMinMargin` (0..1, default 0.075; higher sends more requests to `standard`), `difficultyExemplars` (`{ "trivial": [...], "standard": [...], "complex": [...] }`). They share `embedMode`, `embedUrl`, `embedModel` and `intentMinSimilarity` with steering. Env: `PI_QUEST_QUEST_MIN_MARGIN`, `PI_QUEST_DIFFICULTY_MIN_MARGIN`.
- In-memory semantic classification (`POST /v1/classify`) in `axil-auren`: Fast SIMD dot-product classification in C replaces bulky float JSON payloads over TCP. If `axil-auren` is offline, `pi-quest` requires explicit trigger commands (`quest:`, `fix:`, `/quest`) without guessing or fuzzy logic.
- `testCommands`: extra command prefixes that count as test/build evidence (built in: `make`, `npm|pnpm|yarn|bun|cargo|deno|go test`, `pytest`, `jest`, `vitest`, `tsc`, `./test`, `test.sh`).
- `lintRules`: repo-local diff lint rules `{id, message, linePattern, filePattern?, excludeFilePattern?, excludeLinePattern?}` checked at completion. None ship with the extension (except unresolved conflict markers); `{file}` / `{line}` expand in `message`.

---

## What Decides What: In-Memory Embeddings vs Documented Commands

Every automatic decision in `pi-quest` and `pi-mm` was **measured** on labelled English/Portuguese corpora, comparing the generative judge (`systemone` / `olmoe`) with nearest-exemplar embeddings (`bge-base`), before it was moved. The rule: embeddings take a decision only if they **match or beat the judge's accuracy with zero wrong state-changing verdicts on a held-out corpus**. Zero fuzzy guessing: either a decision is resolved via the embeddings judge, or an explicit documented keyword / trigger is required.

| Decision | Decided by | If server is unavailable | With no servers at all | Measured (held-out) |
| :--- | :--- | :--- | :--- | :--- |
| **Steering**: "go on", cancel, a constraint, a sub-task | Embeddings via `/v1/classify` (`intentMinSimilarity` 0.6, `intentMinMargin` 0.075). | n/a | The exact word `go`, your `steeringPhrases`; a trailing `?` is a question; everything else is a plain refinement | 43/48 (90%), **0 false actions**. The judge recognised 1 of 7 approvals. |
| **Quest or conversation** (free text, no trigger prefix) | Embeddings via `/v1/classify` (`questMinMargin` 0.10) | Structural fallback | A trigger prefix (`quest:`, `fix:` ...), `/quest`, or a pasted `# Quest` header | 37/48 (77.1%), **0 false quests**. The judge scored 36/48 but opened 9 false quests (greetings, thanks, "what day is it?"). |
| **Bug reports & corrective directives** ("You shouldn't draw X as Y, draw Z", "It shouldn't do X, do Y instead", "Don't do X, do Y") | Embeddings via `/v1/classify` against bilingual exemplars (`questMinMargin` 0.05) | Skip (triggers or /quest required) | Trigger prefix (`fix:`, `bug:`, `quest:`) or `/quest` | 25/25 (100.0%) accuracy, **15/15 (100.0%) quest recall**, 10/10 (100.0%) conversation specificity with **0 false quests**, p50 23 ms, p95 40 ms. Classified automatically as `kind: "bugfix"`. |
| **Difficulty** (trivial / standard / complex) | Embeddings via `/v1/classify` (`difficultyMinMargin` 0.075) | Configured default (`standard`) | `standard` by default; explicit parameter or `/quest` override | 135 requests over three corpora: 73 correct (54%), **0 wrong "trivial"**. The judge got 59 (44%) with 52 wrong "trivial" (which would drop plan review). Anything unsure becomes `standard`. |
| **Does the plan include a verification step** | Decomposed embeddings via `/v1/classify` | Advisory skip (never blocks) | Not checked (advisory only) | Decomposed categories achieve 0 false blocks and 86.4% gap detection on held-out corpus B. |
| **pi-mm: store this turn?** (`captureMode: "judge"`) | Embeddings via `/v1/classify` | Deterministic `judgeFallback` (`skip` or `capture`) | `judgeFallback`; explicit `@remember` / `remember:` / `note:` always store | 26/44 (59%), **0 false "remember"**. The judge scored 24/44 with 20 false "remember" (it stores almost every turn). Remember recall is low: 4/22. |

How to read this honestly:

- **Embeddings are high-precision and low-recall on purpose.** A state-changing verdict (open a quest, drop plan review, write a memory) needs a similarity floor *and* a margin over the runner-up; anything weaker takes the harmless outcome (conversation, `standard`, skip). A miss costs you one `go`, `/quest` or `@remember`; a wrong state change costs more.
- **The default judge model is biased on these questions**, in a different direction for each: it never answers "standard" for difficulty, always answers "remember" for capture, and always answers "yes" for plan verification. That is why accuracy alone is misleading on balanced sets: always-yes scores about 50%. Re-measure before switching `judgeModel`.
- **`bge-base` is English-only.** Portuguese phrasings that miss simply degrade to the harmless outcome. Add your own sentences with the `*Exemplars` settings, or use a multilingual embedding model.
- **Measure your own phrasing** (opt-in live evaluations, never part of `npm test`; set `PI_QUEST_EVAL_URL` for a non-default server). Each prints accuracy, wrong state-changing verdicts, p50/p95 latency and every miss, for the judge and for embeddings:
  `PI_QUEST_EVAL_JUDGE=1 deno test --allow-all --sloppy-imports tests/eval/` (pi-mm: `PI_MM_EVAL_JUDGE=1 deno test --allow-all --sloppy-imports tests/eval/`).
  If the local server hangs (requests stall, `session close queue full` in its log), restart it before re-measuring: a saturated server makes the judge look unavailable.

---

## Essential Slash Commands (`/quest`)

All commands are unified under `/quest` with tab-completion:

| Command | Function |
| :--- | :--- |
| `/quest` | Show self-explaining status card (active quest, phase, plan path, next action, and subcommand list), or auto-resume a lone draft when idle. |
| `/quest <name\|qid>` | Switch to or resume a quest by its readable draft name or QID (`/quest pick` to choose interactively). |
| `/quest new [goal]` | Retire the current quest while keeping its scratch slot (`.pi/scratch/slot-N`) and branch intact, re-enable `pi-quest`, and start a new quest on top of that slot's work (`/quest chain` / `/quest next`; infers `[goal]` from prior conversation when referential/omitted). |
| `/quest finish [--keep-slot]` | Complete and integrate the active quest, or squash-merge a retained scratch slot (`.pi/scratch/slot-N`) into `main` after manual testing (`/quest merge` / `/quest integrate`; `--keep-slot` keeps the slot attached after merging). |
| `/quest edit` (or `/quest plan`) | Open the active quest plan file (`.pi/quest/future/<qid>.md`) in `$EDITOR`. |
| `/quest list` | Display all active and draft quests with triage verdicts (`active`, `fresh`, `stale`, `orphan`, `empty-shell`), age, requirement progress, and active worktree slot. |
| `/quest pause` / `/quest on [goal]` | Pause, re-enable, or toggle (`Alt+J` / `/quest toggle`) `pi-quest` for the current session (`⏸️` in status bar; starts disabled by default unless `"enabled": true` is set in `.pi/settings.json`). `/quest on [goal]` starts a quest immediately using prior conversation context. |
| `/quest cancel` | Cancel any currently running in-flight review or validation and unblock tool execution. |
| `/quest del [qid\|flags]` | Delete/abandon the active quest (`--keep-slot` / `-s`, `--integrate` / `-i`, `--keep` / `-k`, `--discard` / `-d`), a named draft quest, or batch-prune drafts (`--all`, `--stale`, `--empty`, `--orphans`, `--days N`, `--dry-run`) with fail-safe branch integration options. |
| `/quest handoff [qid]` | Write and show an honest handoff (verbatim request, every directive, asked-vs-accomplished with UNVERIFIED rows, plan, diff stat, last test/review, blockers, next action) to `.pi/quest/handoffs/`. Also written automatically before every compaction. Saying "give me a handoff" (or `!handoff`) mid-quest does the same and is never recorded as a requirement. |
| `/quest slots` | Inspect active scratch workspace slots (`.pi/scratch/slot-N`), assigned quests, worker process health, and working tree modifications. |
| `/quest doctor` | Test live health of decision judge, latency, models, and word families. |
| `/quest policy` | Show the effective review policy for the active model, the matching `policyByModel` rule, the draft quality tiers, and config warnings. |
| `/quest router` | Show the `quest/auto` router cell, models and cooldowns. |
| `/quest ratings` | Show model accuracy ratings, learned Beta distributions, and autonomy levels. |

---

## Common Operator Workflows

1. **Brainstorm with Argon first, then activate a quest (`/quest on`, `"quest: Go for it."`, `/quest new`)**:
   - Sessions start in `idle` (or paused `⏸️`) routed to **`antigravity-acp/gemini-4-argon:high`** so you can discuss the problem, explore files, and refine the plan conversationally before locking anything.
   - Once you are happy with the understanding/plan, activate a quest with `"quest: Go for it."`, `/quest on`, `/quest on [goal]`, or `/quest new [goal]`.
   - `pi-quest` pulls the substantive objective and context from the prior conversation (`extractPriorConversationObjective`), writes `.pi/quest/future/<qid>.md` immediately, and runs the `[Drafter–Reviewer Dialogue]` in the background while you continue chatting.
2. **Toggle or pause quest enforcement (`Alt+J` / `/quest off` / `/quest on`)**:
   - Press **`Alt+J`** (or run `/quest off` / `/quest pause`) to pause `pi-quest` for the current session and work freely without draft gates (keeping the router on the `idle` Argon rule).
   - Press **`Alt+J`** again (or run `/quest on`) to resume the paused quest.
3. **Test in the scratch worktree before or after merging (`keep-slot`, `squash-keep-slot`, `/quest finish`)**:
   - When completing a quest (`quest_archive` or interactive prompt), select:
     - **`Leave in worktree slot for manual testing before merge`** (`keep-slot`): leaves `quest/<qid>` unmerged in `.pi/scratch/slot-N` so you can manually test or inspect the changes before merging into `main`.
     - **`Squash-merge into main AND keep worktree slot alive`** (`squash-keep-slot`): squash-merges into `main` while keeping `slot-N` checked out at the new `main` HEAD.
   - After manual testing in a retained slot, run **`/quest finish`** (or `/quest merge` / `/quest integrate`, optionally with `--keep-slot`) to squash-merge into `main` and release the slot.
4. **Continue work in the same scratch slot under a new quest (`/quest new`)**:
   - To start a new quest with a fresh plan directly on top of the current `slot-N` worktree (even if the current quest was paused with `/quest off`), run:
     ```text
     /quest new <new objective>
     ```
   - Or run bare `/quest new` (or `/quest del --keep-slot`) to retire the old quest while keeping `slot-N` attached, then type your next request.
5. **Delete a quest without freeing or resetting its slot (`/quest del --keep-slot`)**:
   - Run `/quest del --keep-slot` (or `/quest del -s`, or choose `"Keep work in slot (do not reset or free slot)"` in `/quest del`) to delete the quest record while keeping `slot-N` and its uncommitted/committed work intact.
   - Run `/quest del --discard` while idle to release and reset a retained slot.
6. **Stay in-quest during validation or archive (`decline` / `Cancel archive`)**:
   - Reply **`decline`** (or give corrective instructions) during `validating`, or select **`"Cancel archive (stay in quest)"`** (or press `Escape`) at the branch integration prompt to demote back to `implementing` with tools unlocked.


---

## What to Expect: A Quest End to End

This section describes the end-to-end flow across classification, drafting, peer review, implementation, and validation.

### 1. Classification decides the path
At detection time the judge classifies the request (trivial / standard / complex) in any language. Without a judge the fallback is purely structural, with no keywords: **complex** if the request names four or more distinct file paths, otherwise **standard**.

#### Bug Reports, Negative Directives & Corrective Intent Detection
When the operator reports a defect or expresses a negative constraint/corrective requirement:
- *"You shouldn't draw as an ephemeral item something that's supposed to be a stone or a rock. If it is a stone or a rock or a stone, just draw that."*
- *"It shouldn't do X when Y happens, it should do Z instead."*
- *"Don't write raw SQL in handlers, use the query builder instead."*
- *"The items are showing up as ephemeral objects instead of stones, please fix that."*
- Portuguese equivalents (*"Não devias desenhar pedras como itens efémeros. Se for uma pedra ou rocha, desenha isso."*, *"Não faças X quando Y, faz Z em vez disso."*)

`pi-quest` evaluates the prompt using nearest-exemplar embeddings (`POST /v1/classify`, `bge-base`). The prompt matches quest intent with high similarity ($\ge 0.99$) and wide margin ($\ge 0.28$) over casual conversation. It is automatically classified into **`kind: "bugfix"`**, and a provisional quest draft is opened without requiring explicit `/quest` commands or trigger prefixes.

When the classifier service is offline, explicit documented trigger prefixes (`fix:`, `bug:`, `quest:`) or `/quest` are required.

A complex task worded plainly is therefore treated as standard when no judge is available and gets neither the strong planner nor a review. Use a trigger prefix, or have the agent call `quest_update_state` with `difficulty: "complex"` / `"trivial"`. Likewise, without a judge a free-form message never opens a quest by itself unless it matches explicit triggers (`quest:`, `fix:`, ...) or `/quest`.

### 2. Drafting & Earlier Plan Authoring
Research, reads and test runs are never blocked; the only writable file is the draft (`.pi/quest/future/<qid>.md`). Editing `.pi/quest/future/<qid>.md` while in `provisional` automatically transitions the quest to `drafting` and sets `planAuthored: true`. The plan must meet the thresholds for its current difficulty (default standard: 2 requirements, 7 evidence items) — threshold checks run *before* recalibrating difficulty upward so a 2-requirement standard plan is never prematurely fast-failed against complex thresholds. The router picks the planning model per turn from the phase × difficulty matrix (`idle`, `provisional`, and `drafting.standard` route to `antigravity-acp/gemini-4-argon:high`; `drafting.complex` uses the first available model in its chain). Multi-tool continuation turns keep the model they started on, so a difficulty change takes effect on the next turn.

### 3. Review & `[Drafter–Reviewer Dialogue]`
- **Turn-coalesced review launches**: Passive file edits (`write`/`edit`) to `.pi/quest/future/<qid>.md` mark the draft dirty during the turn and coalesce into a single reviewer launch at `turn_end` (unless `quest_update_state({ plan })` already launched it), preventing mid-turn self-aborts. Any fast-fail cleans up `inFlightReviews` via `cancelReview(qid)`.
- **`strict` vs. `balanced` policy**: Under `reviewPolicy: "strict"`, an independent reviewer subagent runs on every draft (`roles.reviewer`). Under `reviewPolicy: "balanced"`, standard/trivial quests that meet the `draftQuality` bar auto-promote, while complex quests run the reviewer subagent.
- **`[Drafter–Reviewer Dialogue]`**: PASS promotes to implementing. FAIL returns findings, records the resolved turn in `reviewHistory`, and injects a structured `[Drafter–Reviewer Dialogue]` block into context; saving the revised plan boots the next review round while you can continue chatting concurrently. Two consecutive FAIL verdicts pause the loop and ask the operator, who may reply `go`.
- **Rate-limit failover & provider cooldowns**: If any reviewer model encounters HTTP `429`, quota exhaustion, or capacity errors (`isRateLimitOrQuotaError`), `pi-quest` places a 15-minute cooldown on the model, its base variant, and its provider namespace (`provider:<prov>`). Subsequent candidates belonging to that provider are immediately skipped, failing over seamlessly across the chain: target model $\rightarrow$ `roles.reviewer` $\rightarrow$ router default (`config.router.default`) $\rightarrow$ session model $\rightarrow$ `{ label: "inherit" }`.
- `go` (or `go on`, `proceed`, ...) promotes at any time.

### 4. Implementing
Implementation work runs isolated in dedicated git worktrees (allocated from the pre-warmed pool in `.pi/scratch/slot-N`). Tools are automatically jailed to the worktree path (`interception.ts`), protecting the primary repository workspace from accidental mutation. The status bar reflects the active quest name, sub-quest depth (`↳ `, `↳₂ `), slot badge (`(1)`, `(2)`, `(wt)`), and passing test checkmark (`✓`), e.g. `🔨 fix-seams (1) ✓`. The router uses the `implementing` cell (Flash in the sample config, for every difficulty). Repository rules (TDD, `make`, boundary scripts) come from `AGENTS.md`. A plan revision mid-way is re-reviewed and holds tools (`AWAITING_REVIEW: PLAN_REVISION_REVIEW`) until the verdict arrives. If that hold is ever stuck, `/quest cancel` or a plain `go` clears it. On completion or abandonment (`/quest del`), worktree edits and submodule commits are committed and safely integrated or preserved.

### 5. Validation & Worktree Integration (`/quest finish`)
The validator (`roles.validator`, falling back through its model chain) checks the work against the plan. When validation passes (or when you reply `go` / *ship it* / *confirm*), the quest archives and offers worktree disposition options (`integrate` to squash-merge and release `slot-N`, `keep-slot` to leave the branch unmerged in `.pi/scratch/slot-N` for manual testing before merge, or `squash-keep-slot` to squash-merge into `main` while keeping `slot-N` alive). Once manual testing in a retained slot is complete, `/quest finish` (or `/quest merge` / `/quest integrate`) squash-merges the branch into `main` and releases the slot. Replying `decline` / giving corrective feedback during validation, or choosing `"Cancel archive (stay in quest)"` (or pressing `Escape`) at the branch-integration prompt, cancels validation/archiving and demotes the quest back to `implementing` with tools unlocked.

### Known limits
- Only the drafting/idle phases use Argon (`gemini-4-argon:high`) or the strong planner by default; implementation and validation use their configured matrix cells.
- If the planner and the reviewer are the same model the review is not independent; prefer a different model for `roles.reviewer`.
- Provider auth and quota are not checked at config time; a bad key surfaces as a launch failure and walks the fallback chain.
