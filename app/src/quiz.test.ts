import { describe, it, expect } from "vitest";
import { assembleOptions, mulberry32, sampleQuestions } from "./quiz";
import type { Question } from "./types";

const q: Question = {
  id: "b-c-01",
  bookId: "b",
  chapterId: "c",
  stems: ["Stem one?", "Stem two?"],
  correct: ["right 1", "right 2", "right 3"],
  distractors: ["wrong 1", "wrong 2", "wrong 3", "wrong 4", "wrong 5", "wrong 6", "wrong 7"],
  explanation: "e",
  sourceExcerpt: "s",
  difficulty: 1,
  status: "ok",
};

describe("assembleOptions", () => {
  it("always yields exactly 4 unique options with exactly 1 correct", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 10_000; i++) {
      const r = assembleOptions(q, rng);
      expect(r.options).toHaveLength(4);
      expect(new Set(r.options.map((o) => o.text)).size).toBe(4);
      expect(r.options.filter((o) => o.correct)).toHaveLength(1);
      expect(r.options[r.correctIndex].correct).toBe(true);
      expect(q.correct).toContain(r.options[r.correctIndex].text);
      expect(q.stems).toContain(r.stem);
    }
  });

  it("places the correct answer roughly uniformly over 10k runs", () => {
    const rng = mulberry32(7);
    const counts = [0, 0, 0, 0];
    const N = 10_000;
    for (let i = 0; i < N; i++) counts[assembleOptions(q, rng).correctIndex]++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(N / 4 - 250);
      expect(c).toBeLessThan(N / 4 + 250);
    }
  });

  it("is reproducible for the same seed", () => {
    const a = assembleOptions(q, mulberry32(123));
    const b = assembleOptions(q, mulberry32(123));
    expect(a).toEqual(b);
  });
});

describe("sampleQuestions", () => {
  const pool = Array.from({ length: 20 }, (_, i) => ({ ...q, id: `b-c-${i}` }));
  it("samples without replacement and caps at pool size", () => {
    const s = sampleQuestions(pool, 50, mulberry32(1));
    expect(s).toHaveLength(20);
    expect(new Set(s.map((x) => x.id)).size).toBe(20);
    expect(sampleQuestions(pool, 5, mulberry32(1))).toHaveLength(5);
  });
  it("prefers heavier questions when weighted", () => {
    const rng = mulberry32(9);
    let heavyFirst = 0;
    for (let i = 0; i < 2000; i++) {
      const s = sampleQuestions(pool, 1, rng, (x) => (x.id === "b-c-3" ? 50 : 1));
      if (s[0].id === "b-c-3") heavyFirst++;
    }
    expect(heavyFirst).toBeGreaterThan(1000);
  });
});
