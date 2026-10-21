/**
 * Rebuilds app/public/data/index.json from the bank files, ordered like the
 * notes outline (books/chapters in source order; bank files without notes go last).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadNotes, splitAll, root } from "./split-notes.ts";

const bankDir = resolve(root, "app/public/data/bank");
type Entry = { bookId: string; chapterId: string; chapterTitle: string; count: number };
const entries: Entry[] = [];
for (const bookId of readdirSync(bankDir))
  for (const f of readdirSync(join(bankDir, bookId)).filter((f) => f.endsWith(".json"))) {
    const file = JSON.parse(readFileSync(join(bankDir, bookId, f), "utf8"));
    entries.push({ bookId, chapterId: file.chapterId, chapterTitle: file.chapterTitle, count: file.questions.filter((q: any) => q.status === "ok").length });
  }

const outline = splitAll(loadNotes());
const books: { id: string; title: string; chapters: { id: string; title: string; questionCount: number }[] }[] = [];
const used = new Set<Entry>();
for (const b of outline) {
  const chapters = [];
  for (const c of b.chapters) {
    const e = entries.find((x) => x.bookId === b.id && x.chapterId === c.id);
    if (!e || e.count === 0) continue;
    used.add(e);
    chapters.push({ id: c.id, title: e.chapterTitle || c.title, questionCount: e.count });
  }
  if (chapters.length) books.push({ id: b.id, title: b.title, chapters });
}
for (const e of entries) {
  if (used.has(e) || e.count === 0) continue;
  let b = books.find((x) => x.id === e.bookId);
  if (!b) { b = { id: e.bookId, title: e.bookId, chapters: [] }; books.push(b); }
  b.chapters.push({ id: e.chapterId, title: e.chapterTitle, questionCount: e.count });
}
writeFileSync(resolve(root, "app/public/data/index.json"), JSON.stringify({ books }, null, 2) + "\n");
console.log(`index.json: ${books.length} book(s), ${books.reduce((n, b) => n + b.chapters.length, 0)} chapter(s), ${books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.questionCount, 0), 0)} questions`);
