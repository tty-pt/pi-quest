import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sleep } from "./exec";

export interface WorkspaceLockInfo {
  pid: number;
  qid: string;
  acquiredAt: number;
  expiresAt: number;
}

export const DEFAULT_LOCK_TIMEOUT_MS = 30000;
export const DEFAULT_LOCK_TTL_MS = 120000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getLockFilePath(primaryRoot: string): string {
  return join(primaryRoot, ".pi", "workspace-test.lock");
}

function readLock(lockPath: string): WorkspaceLockInfo | null {
  try {
    const raw = readFileSync(lockPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.pid === "number" && typeof obj.qid === "string") {
        return {
          pid: obj.pid,
          qid: obj.qid,
          acquiredAt: typeof obj.acquiredAt === "number" ? obj.acquiredAt : Date.now(),
          expiresAt: typeof obj.expiresAt === "number" ? obj.expiresAt : Date.now() + DEFAULT_LOCK_TTL_MS,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Acquires an exclusive advisory lock on the primary workspace.
 * Automatically clears stale locks if the owning process is no longer alive or TTL expired.
 */
export async function acquireWorkspaceLock(
  primaryRoot: string,
  qid: string,
  options?: { timeoutMs?: number; lockTtlMs?: number },
): Promise<{ ok: boolean; lock?: WorkspaceLockInfo; error?: string }> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const ttlMs = options?.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const lockPath = getLockFilePath(primaryRoot);
  const parentDir = dirname(lockPath);
  if (!existsSync(parentDir)) {
    try { mkdirSync(parentDir, { recursive: true }); } catch { /* ignore */ }
  }
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(lockPath)) {
      const existing = readLock(lockPath);
      const isStale = !existing || Date.now() > existing.expiresAt || !isProcessAlive(existing.pid);
      if (isStale) {
        try { unlinkSync(lockPath); } catch { /* ignore race */ }
      }
    }

    try {
      const lock: WorkspaceLockInfo = {
        pid: process.pid,
        qid,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + ttlMs,
      };
      writeFileSync(lockPath, JSON.stringify(lock, null, 2), { flag: "wx", encoding: "utf8" });
      return { ok: true, lock };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code && code !== "EEXIST") {
        return { ok: false, error: `Failed to write lockfile at ${lockPath}: ${(err as Error).message}` };
      }
      // Lock is held by another active process; back off and retry
      await sleep(100);
    }
  }

  return { ok: false, error: `Failed to acquire workspace lock after ${timeoutMs}ms (lock held at ${lockPath})` };
}

/**
 * Releases the exclusive workspace lock.
 */
export async function releaseWorkspaceLock(
  primaryRoot: string,
  qid?: string,
): Promise<{ ok: boolean; error?: string }> {
  const lockPath = getLockFilePath(primaryRoot);
  if (!existsSync(lockPath)) return { ok: true };

  try {
    if (qid) {
      const existing = readLock(lockPath);
      if (existing && existing.qid !== qid) {
        // Lock owned by another quest, do not force remove
        return { ok: true };
      }
    }
    unlinkSync(lockPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Executes an async task while holding the exclusive workspace lock,
 * guaranteeing release in a finally block.
 */
export async function withWorkspaceLock<T>(
  primaryRoot: string,
  qid: string,
  fn: () => Promise<T>,
  options?: { timeoutMs?: number; lockTtlMs?: number },
): Promise<T> {
  const acq = await acquireWorkspaceLock(primaryRoot, qid, options);
  if (!acq.ok) {
    throw new Error(`workspace lock acquisition failed: ${acq.error}`);
  }
  try {
    return await fn();
  } finally {
    await releaseWorkspaceLock(primaryRoot, qid);
  }
}
