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

## Difficulty Tiers

`pi-quest` automatically assesses task difficulty so simple fixes don't get burdened with bureaucratic paperwork:

- **`trivial`** (e.g. typos, renames, one-liners, minor config tweaks):
  Needs only 1 requirement and 2 evidence items.
- **`standard`** (default feature work and bug fixes):
  Needs 2 requirements and 7 evidence items.
- **`complex`** (major refactors, architecture overhauls, multi-file migrations):
  Needs 3 requirements and 10 evidence items.

To customize or disable the automated difficulty judge, configure `.pi/settings.json`:
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
