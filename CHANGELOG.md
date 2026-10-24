# Changelog

All notable changes to the `pi-quest` extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-10-24

### Added
- **Autonomous Foreman Sub-Quest Dispatcher (`src/subquests/foreman.ts`)**:
  - Automatically parses markdown backlog tasks (`- [ ] SQ1: Goal [paths: ...] [test: ...] [req: ...]`).
  - Automatically binds contracts and mounts the next pending sub-quest onto `questStack` upon previous sub-quest completion.
  - Automatically halts sequencing if a sub-quest fails, waking the coordinator with a structured failure setback.
- **Deterministic Zero-Token Semantic Linters (`src/validation/semantic-lint.ts`)**:
  - Pre-validation regex linter evaluating git patches in `<15ms` before expensive LLM reviewer calls.
  - Rules: `no-ux-compile-branch` (forbidding `#if`/`#ifdef` in isomorphic pure-C UX with sanctioned macro exemptions), `no-ux-engine-symbols` (forbidding backend symbols in UX), `no-cross-module-c-include` (preserving XY modular boundaries), and `no-conflict-markers` (forbidding unresolved git conflict markers).
- **Persistent Test Receipts (`src/domain/quest.ts`, `src/durability/snapshots.ts`)**:
  - Defined pure `VerificationReceipt` and `lastTestReceipt` field on `QuestState`.
  - Persisted test outcomes across transcript snapshot encoding/decoding and `/reload` restarts.
- **State & Disk Dual-Reconciliation on Stack Pop (`src/domain/quest-doc.ts`, `src/quest-doc.ts`)**:
  - Implemented `reconcileDocContent` and best-effort `reconcileParentDocOnReturn`.
  - Automatically checks off satisfied parent requirements (`- [ ] R1:` → `- [x] R1:`) and appends sub-quest execution logs into `## Sub-Quests` on child completion.

### Fixed
- **Zero-Path Lockout Trap on Emergent Sub-Quests (`src/domain/contract.ts`, `src/domain/gates.ts`)**:
  - Updated `isPathAllowedByContract` to treat empty `allowedPaths: []` or omitted paths as unrestricted worker mode instead of rejecting all edits.
  - Enhanced gate reason text with actionable guidance when explicit paths are locked.
- **First-Turn Scaffold Review Bypass (`src/drafting/reviews.ts`)**:
  - Updated `onTurnEndCatchAll` to inspect deliverable body content on turn 1 when `contentHash === null`.
  - Authored plans written on turn 1 now immediately boot draft review without requiring dummy edits on turn 2.
- **Structured Failure Recovery (`src/domain/stack.ts`)**:
  - Pop on `FAILED` receipts synthesizes structured `Setback` items with test commands, exit logs, and assigned requirements, steering the coordinator with actionable recovery guidance.

## [1.1.0] - 2026-10-21

### Added
- **Jev System One Quest Intent Judge (`src/drafting/judge.ts`)**:
  - Local neural judging for incoming prompt classification.
  - Offline fail-closed safety with deterministic trigger prefixes (`quest:`, `task:`, `feat:`, `fix:`).
- **Diagnostic Command (`src/surface/commands/doctor.ts`)**:
  - `/quest doctor` health inspection reporting judge connectivity, latency, and active policies.
- **Standalone Distribution Packaging (`scripts/zip_bundle.ts`)**:
  - Bundles extension code, diagnostics, and manifests into `pi-quest-bundle.zip`.

## [1.0.0] - 2026-10-20

- Initial layered rebuild of `pi-quest`:
  - 3-phase epistemic state machine (`drafting`, `implementing`, `validating`).
  - Pure domain reducers and strictly acyclic module DAG.
  - Transcript snapshot durability and auto-recovery.
  - Non-blocking human asks with default timeouts.
  - Full-screen terminal plan overlay (`[^Q]`).
