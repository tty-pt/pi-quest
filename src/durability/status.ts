// HIGH_LEVEL: #interfaces — status bar names the active quest, flashing bright on draft updates.
// Status text is derived, never stored; commands re-assert it after acting.
import { getState } from "../app/store";
import { DEFAULT_CONFIG, readQuestConfig, type StatusStyle } from "../config";
import type { Phase, QuestState } from "../domain/quest";
import type { PiCtx } from "../hooks/events";
import { hasInFlight } from "../review/tracker";

const PHASE_ICONS: Record<Phase, string> = {
  idle: "💤",
  provisional: "🔍",
  drafting: "📝",
  implementing: "🔨",
  validating: "🧪",
  archived: "📦",
};

const SUBSCRIPTS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPTS[Number(d)] ?? d)
    .join("");
}

export function formatDepthPrefix(depth: number, style: StatusStyle = "icon"): string {
  if (depth <= 0) return "";
  if (style === "text") return `:${depth}`;
  if (depth === 1) return "↳ ";
  return `↳${toSubscript(depth)} `;
}

export function questDisplayName(state: QuestState): string {
  const name = state.name?.trim() || state.draft?.name?.trim() || "";
  return name !== "" ? name : (state.qid ?? "");
}

export function extractSlotLabel(worktreePath?: string): string | null {
  if (!worktreePath) return null;
  const match = /(?:^|\/)slot-(\d+)$/.exec(worktreePath.replace(/\/+$/, ""));
  if (match) {
    return match[1];
  }
  return "wt";
}

function isReviewActive(state: QuestState): boolean {
  if (state.activeReview !== null) return true;
  if (state.qid !== null && hasInFlight(state.qid)) return true;
  return false;
}

export function questStatus(state: QuestState, style: StatusStyle = "icon"): string {
  const label = questDisplayName(state);
  const slot = extractSlotLabel(state.worktreePath ?? state.contract?.worktreePath);
  const hasPassingTest = Boolean(state.lastPassingTestReceipt && state.lastPassingTestReceipt.exitCode === 0);

  if (state.disabled === true) {
    if (state.qid === null) {
      return style === "text" ? "off" : "⏸️ off";
    }
    const idPart = style === "text"
      ? `${label}${formatDepthPrefix(state.depth, "text")}`
      : `${formatDepthPrefix(state.depth, "icon")}${label}`;
    const slotPart = slot ? ` (${slot})` : "";
    return style === "text" ? `paused ${idPart}${slotPart}` : `⏸️ ${idPart}${slotPart}`;
  }

  if (state.qid === null) {
    return style === "text" ? "idle" : `${PHASE_ICONS.idle} idle`;
  }

  const reviewing = isReviewActive(state);
  const phaseToken = style === "text"
    ? (reviewing ? "reviewing" : state.phase)
    : (reviewing ? "👀" : PHASE_ICONS[state.phase]);

  const namePart = style === "text"
    ? `${label}${formatDepthPrefix(state.depth, "text")}`
    : `${formatDepthPrefix(state.depth, "icon")}${label}`;

  const parts: string[] = [`${phaseToken} ${namePart}`];
  if (slot) parts.push(`(${slot})`);
  if (hasPassingTest) parts.push("✓");

  return parts.join(" ");
}

let statusStyle: StatusStyle = DEFAULT_CONFIG.statusStyle;

export async function refreshStyle(cwd: string): Promise<void> {
  try {
    statusStyle = (await readQuestConfig(cwd)).statusStyle;
  } catch {
    // Style falls back to default; the bar stays best-effort.
  }
}

export function refreshStatus(ctx: PiCtx): void {
  try {
    ctx.ui.setStatus("pi-quest", renderStatus(getState(), statusStyle));
  } catch {
    // Status bar is best-effort.
  }
}

const BLINK_INTERVAL_MS = 500;
const BLINK_WINDOW_MS = 6000;

// SGR styling only (\x1b escapes, never raw control bytes): faint for the
// steady state like native footer text, bright white for blink-on frames.
const DIM = "\x1b[2m";
const BRIGHT = "\x1b[97m";
const RESET = "\x1b[0m";

export interface BlinkCadence {
  intervalMs: number;
  windowMs: number;
}

let brightPhase = false;
let blinkUi: PiCtx["ui"] | undefined;
let blinkInterval: ReturnType<typeof setInterval> | undefined;
let blinkStop: ReturnType<typeof setTimeout> | undefined;

function renderStatus(state: QuestState, style: StatusStyle): string {
  const base = questStatus(state, style);
  return (brightPhase && state.qid !== null) ? `${BRIGHT}${base}${RESET}` : `${DIM}${base}${RESET}`;
}

// Exported for test isolation: pending blink timers outlive a single test.
export function stopBlink(): void {
  if (blinkInterval !== undefined) clearInterval(blinkInterval);
  if (blinkStop !== undefined) clearTimeout(blinkStop);
  blinkInterval = undefined;
  blinkStop = undefined;
  brightPhase = false;
}

function assertStatus(ui: PiCtx["ui"]): void {
  ui.setStatus("pi-quest", renderStatus(getState(), statusStyle));
}

// Bright-white flash for one window after a content-changing draft
// save, relaxing back to dim. Rapid saves restart the window; timers
// always self-clear.
export function noteDraftUpdated(
  ctx: PiCtx,
  cadence: BlinkCadence = { intervalMs: BLINK_INTERVAL_MS, windowMs: BLINK_WINDOW_MS },
): void {
  try {
    stopBlink();
    blinkUi = ctx.ui;
    brightPhase = true;
    refreshStatus(ctx);
    blinkInterval = setInterval(() => {
      try {
        brightPhase = !brightPhase;
        if (blinkUi !== undefined) assertStatus(blinkUi);
      } catch {
        // Status bar is best-effort.
      }
    }, cadence.intervalMs);
    blinkStop = setTimeout(() => {
      const ui = blinkUi;
      stopBlink();
      if (ui === undefined) return;
      try {
        assertStatus(ui);
      } catch {
        // Status bar is best-effort.
      }
    }, cadence.windowMs);
  } catch {
    // Draft feedback is passive; never break the agent.
  }
}
