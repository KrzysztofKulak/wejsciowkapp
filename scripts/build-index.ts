/**
 * Rebuilds app/public/data/index.json from the bank files, ordered like the
 * notes outline (books/chapters in source order; bank files without notes go last).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadNotes, splitAll, root, slugify, config } from "./split-notes.ts";

const bankDir = resolve(root, "app/public/data/bank");
type Entry = { bookId: string; bookTitle?: string; chapterId: string; chapterTitle: string; count: number; tags: Map<string, number> };
const entries: Entry[] = [];
for (const bookId of readdirSync(bankDir))
  for (const f of readdirSync(join(bankDir, bookId)).filter((f) => f.endsWith(".json"))) {
    const file = JSON.parse(readFileSync(join(bankDir, bookId, f), "utf8"));
    const ok = file.questions.filter((q: any) => q.status === "ok");
    const tags = new Map<string, number>();
    for (const q of ok) for (const t of q.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
    entries.push({ bookId, bookTitle: file.bookTitle, chapterId: file.chapterId, chapterTitle: file.chapterTitle, count: ok.length, tags });
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
    chapters.push({ id: c.id, title: c.title, questionCount: e.count }); // outline title wins: it carries notes like "str. 12-19"
  }
  if (chapters.length) books.push({ id: b.id, title: b.title, chapters });
}
for (const e of entries) {
  if (used.has(e) || e.count === 0) continue;
  let b = books.find((x) => x.id === e.bookId);
  if (!b) { b = { id: e.bookId, title: e.bookTitle ?? e.bookId, chapters: [] }; books.push(b); }
  b.chapters.push({ id: e.chapterId, title: e.chapterTitle, questionCount: e.count });
}
// Display order: by subject (config order), then within a subject: books from notes, slide presentations, lectures.
const group = (id: string) => (id.startsWith("wyklady") ? 2 : id.startsWith("prezentacja") ? 1 : 0);
// subjects ordered by semester (config order), subjects without a semester last
const semestersCfg = config.semesters ?? [];
const semOf = new Map<string, number>();
semestersCfg.forEach((sem, i) => sem.subjects.forEach((id) => semOf.set(id, i)));
const subjectsCfg = [...(config.subjects ?? [])].sort((a, b) => (semOf.get(a.id) ?? 1e9) - (semOf.get(b.id) ?? 1e9));
const subjectOf = new Map<string, number>();
subjectsCfg.forEach((s, i) => s.books.forEach((id) => subjectOf.set(id, i)));
const sIdx = (id: string) => subjectOf.get(id) ?? subjectsCfg.length; // unassigned books go last
books.sort((a, b) => sIdx(a.id) - sIdx(b.id) || group(a.id) - group(b.id));
const subjects = subjectsCfg
  .map((s) => ({ id: s.id, title: s.title, books: books.filter((b) => subjectOf.get(b.id) === subjectsCfg.indexOf(s)).map((b) => b.id) }))
  .filter((s) => s.books.length);
for (const b of books) if (!subjectOf.has(b.id)) console.warn(`WARN book "${b.id}" has no subject in quiz.config.json → shown under „Inne”`);
for (const s of subjectsCfg) for (const id of s.books) if (!books.some((b) => b.id === id)) console.warn(`WARN subject "${s.id}" lists unknown book "${id}"`);
const semesters = semestersCfg
  .map((sem) => ({ id: sem.id, title: sem.title, subjects: sem.subjects.filter((id) => subjects.some((s) => s.id === id)) }))
  .filter((sem) => sem.subjects.length);
for (const s of subjects) if (!semOf.has(s.id)) console.warn(`WARN subject "${s.id}" has no semester in quiz.config.json → shown under „Inne”`);

// "Zaliczenia": questions grouped by tag across all sources.
const exams: { id: string; title: string; tag: string; questionCount: number; sources: { bookId: string; chapterId: string; questionCount: number }[] }[] = [];
for (const e of entries)
  for (const [tag, n] of e.tags) {
    let ex = exams.find((x) => x.tag === tag);
    if (!ex) { ex = { id: slugify(tag), title: tag, tag, questionCount: 0, sources: [] }; exams.push(ex); }
    ex.questionCount += n;
    ex.sources.push({ bookId: e.bookId, chapterId: e.chapterId, questionCount: n });
  }
exams.sort((a, b) => a.title.localeCompare(b.title, "pl"));
writeFileSync(resolve(root, "app/public/data/index.json"), JSON.stringify({ semesters, subjects, books, exams }, null, 2) + "\n");
console.log(`index.json: ${books.length} book(s), ${books.reduce((n, b) => n + b.chapters.length, 0)} chapter(s), ${books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.questionCount, 0), 0)} questions, ${semesters.length} semester(s), ${subjects.length} subject(s), ${exams.length} exam tag(s)`);
