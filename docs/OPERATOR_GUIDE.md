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

## Configuration
```json
{
  "pi-quest": {
    "difficultyMode": "auto",
    "defaultDifficulty": "standard",
    "judgeMode": "auto"
  }
}
```
Set `"judgeMode": "off"` or `"difficultyMode": "heuristic"` to run 100% locally with zero network calls.
