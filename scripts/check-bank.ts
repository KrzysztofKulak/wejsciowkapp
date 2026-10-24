/**
 * Validates app/public/data: schema, duplicate options, correct-vs-distractor
 * overlap, minimum counts and index.json consistency. Exit 1 on errors.
 */
import { z } from "zod";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataDir = resolve(root, "app/public/data");
const bankDir = join(dataDir, "bank");

const Question = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  bookId: z.string(),
  chapterId: z.string(),
  stems: z.array(z.string().min(10)).min(1).max(3),
  correct: z.array(z.string().min(1)).min(1).max(4),
  distractors: z.array(z.string().min(1)).min(6).max(12),
  explanation: z.string().min(1),
  sourceExcerpt: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  status: z.enum(["ok", "flagged"]),
});
const ChapterFile = z.object({
  bookId: z.string(),
  chapterId: z.string(),
  chapterTitle: z.string(),
  sourceHash: z.string(),
  questions: z.array(Question),
});
const Index = z.object({
  books: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      chapters: z.array(z.object({ id: z.string(), title: z.string(), questionCount: z.number().int() })),
    }),
  ),
});

const errors: string[] = [];
const warnings: string[] = [];
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.。]$/, "");
const seenIds = new Set<string>();
const counts = new Map<string, number>(); // `${bookId}/${chapterId}` -> ok questions

if (!existsSync(bankDir)) {
  console.error("No bank directory:", bankDir);
  process.exit(1);
}

for (const bookId of readdirSync(bankDir)) {
  const bdir = join(bankDir, bookId);
  for (const f of readdirSync(bdir).filter((f) => f.endsWith(".json"))) {
    const path = join(bdir, f);
    const where = `${bookId}/${f}`;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      errors.push(`${where}: invalid JSON (${(e as Error).message})`);
      continue;
    }
    const parsed = ChapterFile.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${where}: ${issue.path.join(".")}: ${issue.message}`);
      continue;
    }
    const file = parsed.data;
    if (file.bookId !== bookId) errors.push(`${where}: bookId "${file.bookId}" != directory "${bookId}"`);
    if (file.chapterId !== f.replace(/\.json$/, "")) errors.push(`${where}: chapterId "${file.chapterId}" != filename`);
    let ok = 0;
    for (const q of file.questions) {
      const w = `${where} ${q.id}`;
      if (seenIds.has(q.id)) errors.push(`${w}: duplicate id`);
      seenIds.add(q.id);
      if (q.bookId !== file.bookId || q.chapterId !== file.chapterId) errors.push(`${w}: bookId/chapterId mismatch`);
      if (!q.id.startsWith(`${q.bookId}-${q.chapterId}-`)) errors.push(`${w}: id must start with <bookId>-<chapterId>-`);
      const all = [...q.correct, ...q.distractors].map(norm);
      const dup = all.filter((o, i) => all.indexOf(o) !== i);
      if (dup.length) errors.push(`${w}: duplicate options: ${[...new Set(dup)].join(" | ")}`);
      const corr = new Set(q.correct.map(norm));
      for (const d of q.distractors) if (corr.has(norm(d))) errors.push(`${w}: distractor equals a correct answer: "${d}"`);
      const stems = q.stems.map(norm);
      if (new Set(stems).size !== stems.length) errors.push(`${w}: duplicate stems`);
      const avg = (a: string[]) => a.reduce((s, x) => s + x.length, 0) / a.length;
      const ratio = avg(q.correct) / avg(q.distractors);
      // very short answers ("id", "ego") make the ratio meaningless, so skip them
      if (q.status === "ok" && avg(q.correct) >= 6 && (ratio > 1.6 || ratio < 0.6))
        warnings.push(`${w}: length tell (correct avg ${avg(q.correct).toFixed(0)} vs distractors ${avg(q.distractors).toFixed(0)})`);
      if (q.status === "ok") ok++;
    }
    counts.set(`${bookId}/${file.chapterId}`, ok);
  }
}

const indexPath = join(dataDir, "index.json");
if (!existsSync(indexPath)) errors.push("index.json missing");
else {
  const parsed = Index.safeParse(JSON.parse(readFileSync(indexPath, "utf8")));
  if (!parsed.success) for (const issue of parsed.error.issues) errors.push(`index.json: ${issue.path.join(".")}: ${issue.message}`);
  else {
    const listed = new Set<string>();
    for (const b of parsed.data.books)
      for (const c of b.chapters) {
        const key = `${b.id}/${c.id}`;
        listed.add(key);
        if (!counts.has(key)) errors.push(`index.json lists ${key} but no bank file exists`);
        else if (counts.get(key) !== c.questionCount) errors.push(`index.json ${key}: questionCount ${c.questionCount} != ${counts.get(key)} ok questions`);
      }
    for (const key of counts.keys()) if (!listed.has(key)) errors.push(`bank file ${key} not listed in index.json`);
  }
}

for (const w of warnings) console.warn("WARN", w);
for (const e of errors) console.error("ERROR", e);
const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(`${counts.size} chapter file(s), ${total} ok question(s), ${seenIds.size} total, ${warnings.length} warning(s), ${errors.length} error(s)`);
process.exit(errors.length ? 1 : 0);
