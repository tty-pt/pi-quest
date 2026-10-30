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

### 2. Drafting
Research, reads and test runs are never blocked; the only writable file is the draft (`.pi/quest/future/<qid>.md`). Writing the plan before recording findings is refused with `RESEARCH_REQUIRED`. The plan must meet the thresholds for its difficulty (default standard: 2 requirements, 7 evidence items). The router picks the planning model per turn from the phase × difficulty matrix: `drafting.complex` uses the first available model in its chain (e.g. Sonnet 5.5 with `:high` thinking, then Flash); other difficulties use `drafting.*`. Multi-tool continuation turns keep the model they started on, so a difficulty change takes effect on the next turn.

### 3. Review
- **standard / trivial**: review is bypassed. Once the plan is authored and meets the bar, the quest promotes to implementing and the agent is told "Draft review bypassed under policy 'balanced'". No subagent runs. If the draft is below the bar (too few requirements/evidence, requirements not mapped into the plan, or an empty plan), nothing promotes, but the agent is woken with the draft profile listing what is missing; saving re-checks. Keep `## ` headings out of the plan body (use `###`).
- **complex**: a reviewer subagent runs on `roles.reviewer` (with its model chain as above). PASS promotes. FAIL returns findings; saving the revised plan boots a fresh review. A launch failure retries up to 3 times with exponential backoff (4s base); two consecutive FAIL verdicts pause the loop and ask the operator, who may reply `go`.
- **Rate-limit failover & provider cooldowns**: If any reviewer model encounters HTTP `429`, quota exhaustion, or capacity errors (`isRateLimitOrQuotaError`), `pi-quest` places a 15-minute cooldown on the model, its base variant, and its provider namespace (`provider:<prov>`). Subsequent candidates belonging to that provider are immediately skipped, failing over seamlessly across the chain: target model $\rightarrow$ `roles.reviewer` $\rightarrow$ router default (`config.router.default`) $\rightarrow$ session model $\rightarrow$ `{ label: "inherit" }`.
- `go` (or `go on`, `proceed`, ...) promotes at any time.

### 4. Implementing
Tools are unrestricted and the router uses the `implementing` cell (Flash in the sample config, for every difficulty). Repository rules (TDD, `make`, boundary scripts) come from `AGENTS.md`; pi-quest does not enforce them. A plan revision mid-way is re-reviewed and holds tools (`AWAITING_REVIEW: PLAN_REVISION_REVIEW`) until the verdict arrives. If that hold is ever stuck, `/quest-cancel-review` or a plain `go` clears it.

### 5. Validation
The validator (`roles.validator`, falling back through its model chain) checks the work against the plan. Under `balanced`, a standard quest whose tests pass auto-archives to `.pi/quest/archive/<qid>.zip`. A FAIL returns to implementing with findings. `go` (or *ship it* / *confirm*, classified by embeddings) archives immediately.

### Known limits
- Only the drafting phase uses the strong model by default; implementation and validation stay on the cheap model unless the matrix says otherwise.
- If the planner and the reviewer are the same model the review is not independent; prefer a different model for `roles.reviewer`.
- Provider auth and quota are not checked at config time; a bad key surfaces as a launch failure and walks the fallback chain.
