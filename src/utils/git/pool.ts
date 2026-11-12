// HIGH_LEVEL: #storage — warm scratch workspace pool manager.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Pi } from "../../hooks/events";
import { runGit } from "./exec";
import { setupWorktreeEnvironment } from "./worktree";
import { initWorktreeSubmodules, pruneSubmoduleWorktrees, restoreSubmoduleWorktrees } from "./submodules";
import { rescueDirtySlotIfNeeded, squashSubmoduleCommits } from "./pool-rescue";
import type { GitWorkflowConfig } from "../../config/schema";

export { rescueDirtySlotIfNeeded, squashSubmoduleCommits };

export interface SanitizeSlotOptions { deleteBranch?: boolean; rescueDirty?: boolean; rescueQid?: string | null; }
export interface ReleaseSlotOptions { deleteBranch?: boolean; }
export interface SlotLease {
  slotId: string; status: "idle" | "leased"; leasedToQid: string | null;
  leasedAt: number | null; pid: number | null; branch: string | null; baseCommit: string | null;
}
export interface PoolAcquireResult { ok: boolean; slotPath?: string; slotBranch?: string; slotId?: string; error?: string; }
export interface PoolProgressNotifier {
  notify?: (message: string, level?: "info" | "warning" | "error") => void;
  setStatus?: (key: string, text: string | undefined) => void;
}

function createIdleLease(slotId: string): SlotLease {
  return { slotId, status: "idle", leasedToQid: null, leasedAt: null, pid: null, branch: null, baseCommit: null };
}
export function readSlotLease(slotDir: string): SlotLease | null {
  const file = join(slotDir, ".lease.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as SlotLease;
    return (parsed && parsed.slotId) ? parsed : null;
  } catch { return null; }
}
export function writeSlotLease(slotDir: string, lease: SlotLease): void {
  writeFileSync(join(slotDir, ".lease.json"), JSON.stringify(lease, null, 2) + "\n", "utf8");
}
export function isPidAlive(pid: number | null): boolean {
  if (pid === null || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (err: unknown) { return (err as { code?: string })?.code === "EPERM"; }
}

export async function initializeSlot(
  primaryRoot: string,
  slotDir: string,
  slotId: string,
  pi?: Pi,
  notifier?: PoolProgressNotifier,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await runGit(["worktree", "prune", "--expire=now"], primaryRoot, pi);
    await pruneSubmoduleWorktrees(primaryRoot, pi);
    mkdirSync(resolve(slotDir, ".."), { recursive: true });
    notifier?.notify?.(`[Scratch Pool] Provisioning ${slotId}...`, "info");

    if (!existsSync(join(slotDir, ".git"))) {
      const res = await runGit(["worktree", "add", "--detach", "-f", relative(primaryRoot, slotDir), "HEAD"], primaryRoot, pi);
      if (res.exitCode !== 0) return { ok: false, error: res.stdout || "git worktree add failed for slot" };
      mkdirSync(slotDir, { recursive: true });
    }

    setupWorktreeEnvironment(primaryRoot, slotDir);
    notifier?.notify?.(`[Scratch Pool] Linking submodules for ${slotId}...`, "info");
    const subRes = await initWorktreeSubmodules(primaryRoot, slotDir, pi);
    if (!subRes.ok) {
      notifier?.notify?.(`[Scratch Pool] Warning: Submodule linking had issues in ${slotId}: ${subRes.error}`, "warning");
    }

    writeSlotLease(slotDir, createIdleLease(slotId));
    notifier?.notify?.(`[Scratch Pool] ${slotId} is warm and ready.`, "info");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sanitizeSlot(
  primaryRoot: string,
  slotDir: string,
  slotId: string,
  pi?: Pi,
  notifier?: PoolProgressNotifier,
  targetCommit?: string,
  oldBranch?: string,
  options?: SanitizeSlotOptions,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!existsSync(join(slotDir, ".git"))) {
      const initRes = await initializeSlot(primaryRoot, slotDir, slotId, pi, notifier);
      if (!initRes.ok) return initRes;
    }

    const existingLease = readSlotLease(slotDir);
    if (options?.rescueDirty) {
      await rescueDirtySlotIfNeeded(
        primaryRoot,
        slotDir,
        options.rescueQid ?? existingLease?.leasedToQid ?? null,
        oldBranch ?? existingLease?.branch ?? null,
        pi,
        notifier,
      );
    }

    notifier?.notify?.(`[Scratch Pool] Resetting ${slotId} to clean state...`, "info");
    let alignSha = targetCommit;
    if (!alignSha) {
      const headRes = await runGit(["rev-parse", "HEAD"], primaryRoot, pi);
      if (headRes.exitCode === 0 && headRes.stdout.trim()) alignSha = headRes.stdout.trim();
    }

    await runGit(["checkout", "-f", "--detach", "HEAD"], slotDir, pi);
    if (alignSha) {
      await runGit(["fetch", relative(slotDir, primaryRoot), alignSha], slotDir, pi);
      await runGit(["checkout", "-f", "--detach", "FETCH_HEAD"], slotDir, pi);
      await runGit(["reset", "--hard", "FETCH_HEAD"], slotDir, pi);
    } else {
      await runGit(["reset", "--hard", "HEAD"], slotDir, pi);
    }

    if (oldBranch && options?.deleteBranch === true) {
      try { await runGit(["branch", "-D", oldBranch], slotDir, pi); } catch { /* ignore */ }
    }

    await runGit(["clean", "-ffd", "-e", "node_modules", "-e", ".lease.json", "-e", "var/chroot"], slotDir, pi);
    const nestedScratch = join(slotDir, ".pi", "scratch");
    if (existsSync(nestedScratch)) {
      try { rmSync(nestedScratch, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    try {
      await pruneSubmoduleWorktrees(primaryRoot, pi);
      await initWorktreeSubmodules(primaryRoot, slotDir, pi);
      await runGit(["submodule", "update", "--init", "--recursive", "--no-fetch", "--force"], slotDir, pi);
      await runGit(["submodule", "foreach", "--recursive", "git checkout --detach HEAD 2>/dev/null; git reset --hard HEAD 2>/dev/null; git clean -ffd -e var/chroot 2>/dev/null || true"], slotDir, pi);
      await restoreSubmoduleWorktrees(primaryRoot, pi);
    } catch { /* best-effort submodule reset */ }
    setupWorktreeEnvironment(primaryRoot, slotDir);
    await pruneSubmoduleWorktrees(primaryRoot, pi);

    writeSlotLease(slotDir, createIdleLease(slotId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function auditAndReclaimPool(
  primaryRoot: string,
  poolDir: string,
  activeQids: Set<string>,
  pi?: Pi,
  notifier?: PoolProgressNotifier,
): Promise<string[]> {
  const fullPoolDir = resolve(primaryRoot, poolDir);
  if (!existsSync(fullPoolDir)) return [];

  const reclaimed: string[] = [];
  try {
    for (const entry of readdirSync(fullPoolDir)) {
      if (!entry.startsWith("slot-")) continue;
      const slotDir = join(fullPoolDir, entry);
      const lease = readSlotLease(slotDir);
      if (!lease) {
        const initRes = await sanitizeSlot(primaryRoot, slotDir, entry, pi, notifier);
        if (initRes.ok) reclaimed.push(entry);
        continue;
      }
      if (lease.status !== "leased") continue;

      const pidAlive = lease.pid !== null && isPidAlive(lease.pid);
      const deadPid = lease.pid !== null && !pidAlive;
      const ownedByThisProcess = lease.pid === null || lease.pid === process.pid;
      const inactiveInThisProcess = ownedByThisProcess && lease.leasedToQid !== null && !activeQids.has(lease.leasedToQid);

      if (deadPid || inactiveInThisProcess) {
        notifier?.notify?.(`[Scratch Pool] Reclaiming ${lease.slotId} (${deadPid ? "dead pid" : "inactive"})...`, "info");
        const resetRes = await sanitizeSlot(
          primaryRoot,
          slotDir,
          lease.slotId,
          pi,
          notifier,
          undefined,
          lease.branch ?? undefined,
          { deleteBranch: false, rescueDirty: true, rescueQid: lease.leasedToQid },
        );
        if (resetRes.ok) reclaimed.push(lease.slotId);
      }
    }
  } catch { /* best-effort audit */ }
  return reclaimed;
}

interface SlotCandidate { id: string; num: number; dir: string; lease: SlotLease | null; }
function scanPoolSlots(poolDir: string): SlotCandidate[] {
  if (!existsSync(poolDir)) return [];
  return readdirSync(poolDir).map((name) => {
    const match = /^slot-(\d+)$/.exec(name);
    return match ? { id: name, num: parseInt(match[1], 10), dir: join(poolDir, name), lease: readSlotLease(join(poolDir, name)) } : null;
  }).filter((s): s is SlotCandidate => s !== null).sort((a, b) => a.num - b.num);
}
async function findOrReclaimCandidate(slots: SlotCandidate[], primaryRoot: string, pi?: Pi, notifier?: PoolProgressNotifier): Promise<SlotCandidate | undefined> {
  const idle = slots.find((s) => !s.lease || s.lease.status === "idle");
  if (idle) return idle;
  for (const s of slots) {
    if (s.lease?.status === "leased" && s.lease.pid !== null && !isPidAlive(s.lease.pid)) {
      notifier?.notify?.(`[Scratch Pool] Auto-reclaiming ${s.id} (owner PID ${s.lease.pid} dead)...`, "info");
      await sanitizeSlot(primaryRoot, s.dir, s.id, pi, notifier, undefined, s.lease.branch ?? undefined, { deleteBranch: false, rescueDirty: true, rescueQid: s.lease.leasedToQid });
      return s;
    }
  }
  return undefined;
}

async function checkoutAndLeaseSlot(
  candidate: SlotCandidate,
  primaryRoot: string,
  qid: string,
  branchName: string,
  targetBase: string,
  pi?: Pi,
  notifier?: PoolProgressNotifier,
): Promise<PoolAcquireResult> {
  notifier?.notify?.(`[Scratch Pool] Leasing ${candidate.id} for Quest ${qid}...`, "info");
  await sanitizeSlot(primaryRoot, candidate.dir, candidate.id, pi, notifier);

  const branchCheck = await runGit(["rev-parse", "--verify", `refs/heads/${branchName}`], primaryRoot, pi);
  const checkoutArgs = branchCheck.exitCode === 0 ? ["checkout", branchName] : ["checkout", "-B", branchName, targetBase];
  const checkoutRes = await runGit(checkoutArgs, candidate.dir, pi);
  if (checkoutRes.exitCode !== 0) {
    return { ok: false, error: `Checkout of ${branchName} in ${candidate.id} failed: ${checkoutRes.stdout}` };
  }

  writeSlotLease(candidate.dir, {
    slotId: candidate.id, status: "leased", leasedToQid: qid, leasedAt: Date.now(),
    pid: process.pid, branch: branchName, baseCommit: targetBase,
  });

  notifier?.notify?.(`[Scratch Pool] Quest ${qid} active in ${candidate.id} (branch: ${branchName}).`, "info");
  return { ok: true, slotId: candidate.id, slotPath: candidate.dir, slotBranch: branchName };
}

export async function acquireWarmSlot(
  primaryRoot: string,
  qid: string,
  baseCommit: string | null,
  config: GitWorkflowConfig,
  pi?: Pi,
  notifier?: PoolProgressNotifier,
): Promise<PoolAcquireResult> {
  const poolDir = resolve(primaryRoot, config.worktreePoolDir || ".pi/scratch");
  mkdirSync(poolDir, { recursive: true });

  const branchName = `${config.featureBranchPrefix || "quest/"}${qid}`;
  const targetBase = baseCommit || "HEAD";
  const slots = scanPoolSlots(poolDir);
  const alreadyLeased = slots.find((s) => s.lease?.leasedToQid === qid && s.lease?.status === "leased");
  if (alreadyLeased) {
    const targetBranch = alreadyLeased.lease?.branch || branchName;
    const refRes = await runGit(["symbolic-ref", "--short", "HEAD"], alreadyLeased.dir, pi);
    if (refRes.exitCode !== 0 || refRes.stdout.trim() !== targetBranch) {
      const verify = await runGit(["rev-parse", "--verify", `refs/heads/${targetBranch}`], primaryRoot, pi);
      const args = verify.exitCode === 0 ? ["checkout", targetBranch] : ["checkout", "-B", targetBranch, targetBase];
      await runGit(args, alreadyLeased.dir, pi);
    }
    if (alreadyLeased.lease && alreadyLeased.lease.pid !== process.pid) {
      writeSlotLease(alreadyLeased.dir, { ...alreadyLeased.lease, pid: process.pid });
    }
    return { ok: true, slotId: alreadyLeased.id, slotPath: alreadyLeased.dir, slotBranch: targetBranch };
  }

  let candidate = await findOrReclaimCandidate(slots, primaryRoot, pi, notifier);
  const maxSlots = Math.max(config.worktreePoolSize, config.worktreePoolMaxSize || 8);

  if (!candidate && slots.length < maxSlots) {
    const nextNum = slots.length > 0 ? Math.max(...slots.map((s) => s.num)) + 1 : 1;
    const nextId = `slot-${nextNum}`;
    const nextDir = join(poolDir, nextId);
    notifier?.notify?.(`[Scratch Pool] All workspaces busy. Allocating dynamic workspace ${nextId} (${nextNum}/${maxSlots})...`, "info");
    const initRes = await initializeSlot(primaryRoot, nextDir, nextId, pi, notifier);
    if (!initRes.ok) return { ok: false, error: `Failed to allocate dynamic slot ${nextId}: ${initRes.error}` };
    candidate = { id: nextId, num: nextNum, dir: nextDir, lease: readSlotLease(nextDir) };
  }

  if (!candidate) {
    return { ok: false, error: `All ${slots.length} scratch workspace slots are actively leased (max capacity ${maxSlots} reached). Release or wait for a slot to free.` };
  }

  return await checkoutAndLeaseSlot(candidate, primaryRoot, qid, branchName, targetBase, pi, notifier);
}

export async function releaseWarmSlot(
  primaryRoot: string,
  slotPath: string,
  qid: string,
  pi?: Pi,
  notifier?: PoolProgressNotifier,
  options?: ReleaseSlotOptions,
): Promise<{ ok: boolean; error?: string }> {
  const lease = readSlotLease(slotPath);
  if (!lease) return { ok: true };
  if (lease.leasedToQid !== qid && lease.status === "leased") {
    return { ok: false, error: `Slot ${lease.slotId} is leased to ${lease.leasedToQid}, not ${qid}` };
  }
  return await sanitizeSlot(
    primaryRoot,
    slotPath,
    lease.slotId,
    pi,
    notifier,
    undefined,
    lease.branch ?? undefined,
    { deleteBranch: options?.deleteBranch === true },
  );
}

export async function ensureQuestWorktreeAttached(
  primaryRoot: string,
  qid: string,
  baseCommit: string | null | undefined,
  currentWorktreePath: string | undefined,
  currentWorktreeBranch: string | undefined,
  config: GitWorkflowConfig,
  pi?: Pi,
  notifier?: PoolProgressNotifier,
  ownerQids?: ReadonlyArray<string>,
): Promise<PoolAcquireResult> {
  const validOwners = new Set<string>([qid, ...(ownerQids ?? []).filter(Boolean)]);
  const rootOwnerQid = (ownerQids && ownerQids.length > 0 ? ownerQids[0] : undefined) || qid;
  if (currentWorktreePath && existsSync(join(currentWorktreePath, ".git"))) {
    const lease = readSlotLease(currentWorktreePath);
    const expectedBranch = currentWorktreeBranch || `${config.featureBranchPrefix || "quest/"}${rootOwnerQid}`;
    if (!lease || (lease.status === "leased" && lease.leasedToQid !== null && validOwners.has(lease.leasedToQid))) {
      const refRes = await runGit(["symbolic-ref", "--short", "HEAD"], currentWorktreePath, pi);
      if (refRes.exitCode === 0 && refRes.stdout.trim() === expectedBranch) {
        if (lease && (lease.pid !== process.pid || lease.leasedToQid !== rootOwnerQid)) {
          writeSlotLease(currentWorktreePath, { ...lease, leasedToQid: rootOwnerQid, pid: process.pid });
        }
        return { ok: true, slotId: lease?.slotId, slotPath: currentWorktreePath, slotBranch: expectedBranch };
      }
    }
  }
  return await acquireWarmSlot(primaryRoot, rootOwnerQid, baseCommit ?? null, config, pi, notifier);
}

