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
    dedupe.ts       pure directive, requirement, and amendment deduplication
    handoff.ts      deterministic asked-vs-accomplished handoff renderer with UNVERIFIED checking
    garden.ts       pure quest triage (active/fresh/stale/orphan/empty-shell) and prune selection
    qid.ts          alphanumeric base62 quest id generation and validation
    paths.ts        workspace, draft, handoff, and archive path helpers
  drafting/         draft proposal management and adversarial review loop
    detect.ts       intent detection and trigger prefix routing
    judge.ts        Jev System One neural quest intent classification
    plan-text.ts    markdown plan section extraction, RTM items, citation parsing
    citations.ts    resolves cited file:line locations against the working tree
    quality-config.ts draftQuality settings: types, per-tier defaults, forgiving parser
    quality.ts      draftQuality assessor: resolvable citations, plan steps, verification step
    bypass.ts       balanced/off policy bypass: promote at the bar, otherwise wake the agent with what is missing
    reviews.ts      draft review booting, catch-all turn-end monitor, threshold enforcement
    draft-retry.ts  backoff retry dispatcher for transient reviewer launch failures
    gate.ts         turn termination during active review
    edits.ts        draft file edit tracking and content hashing
    promotion.ts    verdict evaluation, advisory attachments, phase advancement
    resume.ts       session startup review recovery
  policy/           model-aware review policy
    effective.ts    policyByModel rules (glob → policy), active-model resolution, withEffectivePolicy
    warnings.ts     collectConfigWarnings: readable warnings for ignored policy/quality settings
  router/           quest/auto virtual model: phase × difficulty routing
    last-route.ts   remembers the physical model last routed to (feeds policyByModel)
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
    handoff-io.ts   atomic handoff disk persistence (.pi/quest/handoffs/) with git diffstat
    compaction-handoff.ts zero-loss pre-compaction handoff and post-compaction turn injection
  surface/          agent and user interaction layer
    tools/          tools: quest_update_state, quest_subquest, quest_archive, quest_recover, quest_rebut, quest_ask_human, quest_handoff, quest_run_test, quest_scratches
    commands/       unified /quest command (status card, edit, list, pick, pause/on, cancel, del, handoff, slots, doctor, policy, router, ratings)
      continuity.ts continuity subcommands (/quest handoff, draft triage & prune helpers)
      plan.ts       plan file resolution and $EDITOR launcher (/quest edit)
  utils/            git and subprocess infrastructure
    git/
      pool.ts       pre-warmed scratch workspace pool manager (.pi/scratch/slot-N)
      pool-inspect.ts scratch slot status, process health, and working-tree activity telemetry
      worktree.ts   isolated git worktree environment setup and management
      submodules.ts canonical submodule synchronization (syncWorktreeSubmodulesToPrimary, JIT branch)
      squash.ts     interactive squash-merge with dirty workspace stashing and conflict safety
      diff.ts       unified diff resolution across worktrees and submodules
      exec.ts       robust git execution helpers and head commit resolution
      workspace-lock.ts mutual exclusion workspace locking
      workspace-runner.ts isolated primary-repo test execution
scripts/            dag · complexity (<80 func, <350 file) · spec-map · zip
tests/              ~770+ tests across 75+ test suites covering all domain, drafting, validation, continuity, worktree, and UI systems
```

- Architectural invariants:
  - State mutations are pure reducers: `reduce(state, event) -> { state, effects[] }`.
  - Domain (`src/domain/`) imports only within `src/domain/`.
  - Strictly acyclic module DAG (123 modules, 0 cycles).
  - All functions $< 80$ LOC; all files $< 350$ LOC.
