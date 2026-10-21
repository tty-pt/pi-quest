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
any setup. That makes it possible to hand a low-cost model a long, complex
task and get a supervised, verifiable result.

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
   a FAIL sends it back to implementing with findings.

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

Engine usage — commands for the user:

| Command | Effect |
|---------|--------|
| `/quest` | Pick a quest when idle, or show the active quest. No argument resumes the newest / presents known quests for selection. |
| `/quest <qid\|name>` | Resume a named quest or drafting phase directly. |
| `/quests` | List all quests with their phases and the active marker. |
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
| `askTimeoutMs` | number (ms) | `60000` | How long `quest_ask_human` waits before proceeding with its recommended default. |
| `depthCap` | number | `3` | How deep sub-quests may nest. |
| `draftThresholds.requirements` | number | `2` | Minimum requirements the draft reviewer demands before passing. |
| `draftThresholds.evidence` | number | `7` | Minimum evidence items (used when below the requirements bar). |
| `bindings.reviewRunner.tool` | tool name | `subagent` | Sub-agent tool that runs reviewers/validators isolated (falls back to the user path). |
| `statusStyle` | `icon` / `text` | `icon` | How the active quest renders in the status bar. |
| `autoArchive` | `true` / `false` | `true` | Whether a validation PASS concludes and archives the quest automatically; when `false`, the agent archives manually. |
| `judgeMode` | `"auto"` / `"systemone"` / `"heuristic"` / `"off"` | `"auto"` | How quest intent is evaluated on new user messages: `"auto"` / `"systemone"` queries Jev System One, `"heuristic"` uses pattern rules, `"off"` disables automatic quest initiation from prompt text. |
| `judgeUrl` | URL string | `http://127.0.0.1:4242` | Endpoint for Jev System One decisions (falls back to `PI_QUEST_JUDGE_URL` or `PI_MM_JUDGE_URL`). |
| `judgeModel` | model name | `"qwen"` | Model identifier submitted to the judge service (falls back to `PI_QUEST_JUDGE_MODEL` or `PI_MM_JUDGE_MODEL`). |
| `judgeKey` | token string | `undefined` | Optional Bearer authorization token for remote endpoints. |
| `judgeFallback` | `"heuristic"` / `"skip"` | `"heuristic"` | Fallback policy when the judge endpoint is unreachable or times out. |
| `judgeTimeoutMs` | number (ms) | `2000` | Network timeout for judge decision evaluations. |

### Intelligent Quest Intent Detection (Jev System One)

When idle, `pi-quest` listens for new user requests to start a quest automatically. Instead of relying solely on brittle regexes or opening quests unconditionally on casual dialogue (such as *"I spoke to my grandfather..."* or memory recall questions), `pi-quest` uses an intelligent decision judge:

- **Automatic Intent Classification**: In `"auto"` or `"systemone"` mode, the judge submits a typed choice question (`quest_intent`) to determine whether the user wants to initiate software engineering work (`quest`) versus casual conversation or questions (`conversation`).
- **Shared Infrastructure**: If you already use `pi-mm` paired with local [axil-auren](https://github.com/tty-pt/auren), `pi-quest` automatically shares the local judge endpoint and settings with zero additional configuration.
- **Fail-Open & Resilient**: If the inference service is offline or restarting, `pi-quest` never disrupts your conversation: it cleanly degrades to local heuristics or skips according to `judgeFallback`.

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

| Tool | What it does |
|------|--------------|
| `quest_update_state` | The write path: records findings, drafts, amendments, next action, completion claims. |
| `quest_subquest` | Spawns a linked sub-quest for a complex sub-task. |
| `quest_archive` | Finishes a quest as complete or failed. Abandoning is user-only (`/quest-del`). |
| `quest_recover` | Rebuilds quest state from the transcript, including earlier sessions. Runs automatically when state is missing. |
| `quest_rebut` | Answers a review with evidence; a successful rebuttal reopens the question. |
| `quest_ask_human` | Asks you with a recommended default and a timeout — never blocks. |

## Requirements

- The Pi coding agent.
- pi-vcc with its compaction override enabled, so compacting is deterministic
  and never touches the snapshots quest state lives in.
- A sub-agent extension is optional. Without one, reviews and validations
  degrade to asking you: the plan is presented, a `go` promotes, and
  completion is accepted on your confirmation — the quest never stalls for a
  missing extension.