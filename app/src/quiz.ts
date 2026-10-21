import type { Question, Rendered, Rng } from "./types";

/** mulberry32: small, fast seeded PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickOne<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function pickN<T>(arr: readonly T[], n: number, rng: Rng): T[] {
  return shuffle(arr, rng).slice(0, n);
}

/**
 * Builds one A–D rendering: a random stem, 1 random correct phrasing,
 * (shown-1) random distractors, shuffled.
 */
export function assembleOptions(q: Question, rng: Rng, shown = 4): Rendered {
  const stem = pickOne(q.stems, rng);
  const correct = pickOne(q.correct, rng);
  const wrong = pickN(q.distractors, shown - 1, rng);
  const options = shuffle([{ text: correct, correct: true }, ...wrong.map((text) => ({ text, correct: false }))], rng);
  return { question: q, stem, options, correctIndex: options.findIndex((o) => o.correct) };
}

/**
 * Samples `n` questions without replacement. With `weight`, questions with a
 * higher weight are more likely to be picked first (used by "focus on weak").
 */
export function sampleQuestions(pool: readonly Question[], n: number, rng: Rng, weight?: (q: Question) => number): Question[] {
  const count = Math.min(n, pool.length);
  if (!weight) return pickN(pool, count, rng);
  const remaining = pool.slice();
  const out: Question[] = [];
  while (out.length < count && remaining.length) {
    const weights = remaining.map((q) => Math.max(weight(q), 0.0001));
    let r = rng() * weights.reduce((a, b) => a + b, 0);
    let idx = 0;
    for (; idx < weights.length - 1; idx++) {
      r -= weights[idx];
      if (r <= 0) break;
    }
    out.push(remaining.splice(idx, 1)[0]);
  }
  return out;
}

export const LABELS = ["A", "B", "C", "D", "E", "F"] as const;
