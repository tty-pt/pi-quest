import { getState } from "../../../app/store";
import type { ArchivedOutcome, QuestState } from "../../../domain/quest";
import { implementationFingerprint } from "../../../review/flow";
import type { Pi } from "../../../hooks/events";

export function hasValidationPass(): boolean {
  const state = getState();
  if (state.qid === null) return false;
  return state.lastReview?.verdict === "PASS" &&
    state.lastReview.target === implementationFingerprint(state);
}

export function assertArchiveAllowed(
  state: QuestState,
  outcome: ArchivedOutcome,
  summary: string | null,
  opts?: { confirmDiscard?: boolean },
): void {
  const validated = hasValidationPass();
  if (outcome === "COMPLETED" && !validated) {
    throw new Error(
      "COMPLETED requires a current validation PASS — run quest_update_state {claimComplete:true} to enter validating, await the validation PASS (or reply CONFIRM when no validator is available), then archive again",
    );
  }
  if (outcome === "FAILED") {
    const target = implementationFingerprint(state);
    const review = state.lastReview;
    if (review === null || review.target !== target || review.verdict !== "FAIL") {
      throw new Error(
        "FAILED needs a validation FAIL on the current work — keep implementing (continueWork:true returns from validating), claim completion to validate, or hold for the user to reply CONFIRM when no validator is available",
      );
    }
  }
  if (outcome === "ABANDONED" && !validated) {
    const confirmed = opts?.confirmDiscard === true;
    const noted = typeof summary === "string" && summary.trim() !== "";
    if (!confirmed || !noted) {
      throw new Error(
        `archiving as ${outcome} discards unvalidated work — pass confirmDiscard:true with a summary describing what was discarded and why, or run quest_update_state {claimComplete:true} to validate first`,
      );
    }
  }
}

export async function getModifiedFiles(
  pi: Pi,
  cwd: string,
  baseCommit?: string | null,
  touchedFiles?: string[],
): Promise<string[]> {
  const files = new Set<string>();
  if (touchedFiles) {
    for (const f of touchedFiles) {
      if (f && !f.startsWith(".pi/quest/")) {
        const rel = f.startsWith(cwd) ? f.slice(cwd.length).replace(/^[/\\]+/, "") : f;
        if (rel && !rel.startsWith(".pi/quest/")) files.add(rel);
      }
    }
  }
  try {
    const res = (await pi.exec("git", ["status", "--porcelain"], { cwd })) as
      | { code?: number; exitCode?: number; stdout?: string; output?: string } | undefined;
    const stdout = res?.stdout ?? res?.output ?? "";
    if ((res?.code ?? res?.exitCode) === 0 && stdout) {
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 3) {
          const file = trimmed.slice(3).trim();
          if (file && !file.startsWith(".pi/quest/")) files.add(file);
        }
      }
    }
  } catch { /* ignore */ }

  if (baseCommit) {
    try {
      const verifyRes = (await pi.exec("git", ["rev-parse", "--verify", `${baseCommit}^{commit}`], { cwd })) as
        | { code?: number; exitCode?: number } | undefined;
      if ((verifyRes?.code ?? verifyRes?.exitCode) === 0) {
        const diffRes = (await pi.exec("git", ["diff", "--name-only", `${baseCommit}..HEAD`], { cwd })) as
          | { code?: number; exitCode?: number; stdout?: string; output?: string } | undefined;
        const diffOut = diffRes?.stdout ?? diffRes?.output ?? "";
        if ((diffRes?.code ?? diffRes?.exitCode) === 0 && diffOut) {
          for (const line of diffOut.split("\n")) {
            const f = line.trim();
            if (f && !f.startsWith(".pi/quest/")) files.add(f);
          }
        }
        return Array.from(files);
      }
    } catch { /* ignore */ }
  }

  for (const ref of ["HEAD~1", "HEAD"]) {
    try {
      const diffRes = (await pi.exec("git", ["diff", "--name-only", ref], { cwd })) as
        | { code?: number; exitCode?: number; stdout?: string; output?: string } | undefined;
      const diffOut = diffRes?.stdout ?? diffRes?.output ?? "";
      if ((diffRes?.code ?? diffRes?.exitCode) === 0 && diffOut) {
        for (const line of diffOut.split("\n")) {
          const f = line.trim();
          if (f && !f.startsWith(".pi/quest/")) files.add(f);
        }
        break;
      }
    } catch { /* ignore */ }
  }
  return Array.from(files);
}
