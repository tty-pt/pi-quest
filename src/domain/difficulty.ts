export type QuestDifficulty = "trivial" | "minor" | "standard" | "major" | "complex";

export const DIFFICULTY_LEVELS: Record<QuestDifficulty, number> = {
  trivial: 1,
  minor: 2,
  standard: 3,
  major: 4,
  complex: 5,
};

export const DIFFICULTY_BY_LEVEL: Record<number, QuestDifficulty> = {
  1: "trivial",
  2: "minor",
  3: "standard",
  4: "major",
  5: "complex",
};

/** Convert a difficulty tier (string name or number 1..5) to its canonical numeric rank (1..5). */
export function difficultyLevel(d?: QuestDifficulty | number | string): number {
  if (typeof d === "number") {
    if (d <= 1) return 1;
    if (d >= 5) return 5;
    return Math.round(d);
  }
  if (typeof d === "string") {
    const norm = d.trim().toLowerCase();
    if (norm === "1" || norm === "trivial") return 1;
    if (norm === "2" || norm === "minor") return 2;
    if (norm === "3" || norm === "standard") return 3;
    if (norm === "4" || norm === "major") return 4;
    if (norm === "5" || norm === "complex") return 5;
    const num = Number(norm);
    if (!isNaN(num) && num > 0) return difficultyLevel(num);
  }
  return 3;
}

/** Convert a numeric level (1..5) or alias string to the canonical difficulty name. */
export function difficultyName(d?: QuestDifficulty | number | string): QuestDifficulty {
  const lvl = difficultyLevel(d);
  return DIFFICULTY_BY_LEVEL[lvl] ?? "standard";
}

/** Check if difficulty is at least a specified numeric threshold. */
export function isDifficultyAtLeast(d: QuestDifficulty | number | string | undefined, minLevel: number): boolean {
  return difficultyLevel(d) >= minLevel;
}
