# pi-quest Architecture Map

Current architecture and module layout:

```
src/
  index.ts          composition root: lifecycle hooks in HIGH_LEVEL order
  domain/           pure state, transitions, contracts, stack frames, gates, qid (zero external dependencies)
    quest.ts        core QuestState interfaces, pure transitions, IDLE_STATE
    transitions.ts  pure state lifecycle transforms (createDraft, promote, demote, archive)
    contract.ts     sub-quest contracts, RTM coverage checking, allowed-paths verification
    stack.ts        hierarchical stack frames (pushStackFrame, popStackFrame, setback creation)
    gates.ts        phase-based tool access gating and scope enforcement
    quest-doc.ts    pure markdown status and reconciliation helpers
    qid.ts          alphanumeric base62 quest id generation and validation
    paths.ts        workspace and draft path helpers
  drafting/         draft proposal management and adversarial review loop
    detect.ts       intent detection and trigger prefix routing
    judge.ts        Jev System One neural quest intent classification
    plan-text.ts    markdown plan section extraction, RTM items, citation parsing
    reviews.ts      draft review booting, catch-all turn-end monitor, threshold enforcement
    draft-retry.ts  backoff retry dispatcher for transient reviewer launch failures
    gate.ts         turn termination during active review
    edits.ts        draft file edit tracking and content hashing
    promotion.ts    verdict evaluation, advisory attachments, phase advancement
    resume.ts       session startup review recovery
  implementing/     plan execution and adaptation
    plan-revision.ts re-reviewable in-flight plan revisions
    setbacks.ts     automatic test/build failure extraction
  validation/       verification and completion gates
    evidence-gate.ts deterministic pre-validation eligibility (diffstat, test receipts)
    semantic-lint.ts zero-token AST/regex boundary linter (UX purity, XY boundaries, conflict markers)
    flow.ts         validation review brief assembly and review runner dispatch
    index.ts        bash test execution result tracking and receipt recording
    conclude.ts     verdict handling, auto-archive, demote-on-fail
    confirm.ts      user confirmation fallback when reviewer runner is unavailable
  subquests/        hierarchical task execution
    foreman.ts      autonomous backlog parsing and sequential child mounting
    scope.ts        triage and routing helpers
    triage.ts       user message intent routing during active sub-quests
  durability/       state persistence and UI feedback
    snapshots.ts    transcript snapshot encoding, decoding, normalization, and recovery
    status.ts       status bar rendering (icon/text), blink cycle on draft update
    transcript.ts   session history extraction for review context
  surface/          agent and user interaction layer
    tools/          tools: quest_update_state, quest_subquest, quest_archive, quest_recover, quest_rebut, quest_ask_human
    commands/       user commands: /quest, /quests, /quest-del, /quest doctor
    plan.ts         full-screen terminal plan viewer overlay ([^Q])
scripts/            dag · complexity (<80 func, <350 file) · spec-map · zip
tests/              367 tests across 53 test suites covering all domain, drafting, validation, and UI systems
```

- Architectural invariants:
  - State mutations are pure reducers: `reduce(state, event) -> { state, effects[] }`.
  - Domain (`src/domain/`) imports only within `src/domain/`.
  - Strictly acyclic module DAG (81 modules, 0 cycles).
  - All functions $< 80$ LOC; all files $< 350$ LOC.
