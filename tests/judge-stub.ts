// Test helper: replace global fetch with a deterministic judge so no test ever
// talks to a live auren server.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** `options` are the declared label keys in the order sent (reveals option ordering). */
export type JudgeAnswer = (questionId: string, state: string, options: string[]) => string | null;

/** Install a fake judge; returns restore(). `null` answer => HTTP failure. */
export function stubJudgeFetch(answer: JudgeAnswer): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { state?: string; questions?: Record<string, unknown> };
    const id = Object.keys(body.questions ?? {})[0] ?? "";
    const q = (body.questions ?? {})[id] as { criteria?: Record<string, string> } | undefined;
    const choice = answer(id, body.state ?? "", Object.keys(q?.criteria ?? {}));
    if (choice === null) return Promise.resolve(new Response("down", { status: 503 }));
    return Promise.resolve(new Response(JSON.stringify({ answers: { [id]: { choice } } }), { status: 200 }));
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

/** Write .pi/settings.json under cwd with the given pi-quest keys. */
export function writeQuestSettings(cwd: string, settings: Record<string, unknown>): void {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi/settings.json"), JSON.stringify({ "pi-quest": settings }), "utf8");
}

export const JUDGE_ON = { judgeMode: "auto", judgeUrl: "http://judge.test", judgeProtocol: "systemone" };
export const JUDGE_OFF = { judgeMode: "off" };
