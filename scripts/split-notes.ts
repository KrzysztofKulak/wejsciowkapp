/**
 * Shared helpers: split source/notes.md into books and chapters, slugify ids,
 * and hash chapter text. Used by `npm run outline` and by the quiz-bank skill.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");
export const config = JSON.parse(readFileSync(resolve(root, "quiz.config.json"), "utf8")) as {
  sources: (string | { url?: string; pdf?: string; title?: string; id?: string; chapter?: string })[];
  chapterPattern: string;
  bookAliases?: Record<string, string>;
  /** Visual grouping of books in the app (subject = przedmiot). Order here = display order. */
  subjects?: { id: string; title: string; books: string[] }[];
  /** Level above subjects. Order here = display order. */
  semesters?: { id: string; title: string; subjects: string[] }[];
  bookHeading?: string;
  language: string;
  questionsPer1000Words: number;
  optionsShown: number;
};

export type Chapter = { id: string; title: string; text: string; words: number; hash: string };
export type Book = { id: string; title: string; chapters: Chapter[] };

export function slugify(s: string): string {
  const map: Record<string, string> = {
    ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
    Ą: "a", Ć: "c", Ę: "e", Ł: "l", Ń: "n", Ó: "o", Ś: "s", Ź: "z", Ż: "z",
  };
  return s
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => map[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

const level = (h?: string) => parseInt((h ?? "h1").replace(/^h/, ""), 10);

/**
 * Splits markdown into books and chapters.
 * - Any heading (h1–h4) containing `chapterPattern` (e.g. "Rozdział 5", "Rozdz. 13", "Wykład 2") starts a chapter.
 *   Text before the match that ends with `.`, `:` or `,` is the book title ("“Book”, Author. Rozdział 2");
 *   other leading text (dates, bullets) is dropped. The chapter title is the heading from the match onward,
 *   so notes like "Rozdział 1, str. 12-19" or "Wykład 3 – Grupy" stay visible. The id comes from the match only.
 * - A heading at `bookHeading` level (default h1) without a match starts a book.
 * - The first heading of a file (page title) is skipped; chapters without a book fall back to it.
 * - Everything else, including deeper headings, is chapter text.
 */
export function splitNotes(md: string): Book[] {
  const bookLvl = level(config.bookHeading);
  const pattern = new RegExp(config.chapterPattern, "i");
  const lines = md.split("\n");
  // "<!-- chapters: hN -->" (written by fetch-notes for `chapterLevel` sources): every hN heading is a chapter
  const directive = md.match(/<!-- chapters: h(\d) -->/);
  const topicLevel = directive ? Number(directive[1]) : 0;
  const books: Book[] = [];
  let pageTitle = "Notatki";
  let book: Book | null = null;
  let chapter: Chapter | null = null;
  let buf: string[] = [];
  let seenTitle = false;

  const getBook = (title: string) => {
    const id = config.bookAliases?.[slugify(title)] ?? slugify(title);
    let b = books.find((x) => x.id === id);
    if (!b) { b = { id, title, chapters: [] }; books.push(b); }
    return b;
  };
  const flush = () => {
    if (chapter) {
      const text = buf.join("\n").trim();
      chapter.text = text;
      chapter.words = text.split(/\s+/).filter(Boolean).length;
      // image paths (<!-- img: ... -->) are not part of the content: keep hashes stable when images are (re)downloaded
      chapter.hash = sha1(text.split("\n").filter((l) => !/^\s*<!-- img: .* -->\s*$/.test(l)).join("\n"));
    }
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      const lvl = m[1].length;
      const title = m[2].trim();
      if (!seenTitle) { seenTitle = true; pageTitle = title; continue; }
      if (topicLevel && lvl === topicLevel) {
        flush();
        if (!book) book = getBook(pageTitle);
        chapter = { id: slugify(title), title: title.replace(/[\s.:;,–-]+$/, ""), text: "", words: 0, hash: "" };
        book.chapters.push(chapter);
        continue;
      }
      const cm = title.match(pattern);
      if (cm && cm.index !== undefined) {
        flush();
        const before = title.slice(0, cm.index).trim();
        const bookTitle = /[.:,]$/.test(before) ? before.replace(/[.:,]+$/, "").trim() : "";
        const chapterKey = cm[1];
        const chapterTitle = title.slice(cm.index).replace(/[\s.:;,–-]+$/, "").trim();
        if (bookTitle) book = getBook(bookTitle);
        if (!book) book = getBook(pageTitle);
        let chapterId = slugify(chapterKey.replace(/^Rozdz\.?\s+/i, "Rozdział "));
        let finalTitle = chapterTitle;
        // the same number twice in one book (e.g. two blocks of "Wykład 1" on one day) → "cz. 2", "cz. 3"
        const dupes = book.chapters.filter((c) => c.id === chapterId || c.id.startsWith(`${chapterId}-cz-`)).length;
        if (dupes > 0) {
          chapterId = `${chapterId}-cz-${dupes + 1}`;
          finalTitle = `${chapterTitle} (cz. ${dupes + 1})`;
        }
        chapter = { id: chapterId, title: finalTitle, text: "", words: 0, hash: "" };
        book.chapters.push(chapter);
        continue;
      }
      if (lvl === bookLvl) {
        flush();
        chapter = null;
        book = getBook(title);
        continue;
      }
    }
    if (chapter) buf.push(line);
  }
  flush();
  return books;
}

/** Splits every source file separately and merges books with the same id. */
export function splitAll(files: string[]): Book[] {
  const books: Book[] = [];
  for (const md of files)
    for (const b of splitNotes(md)) {
      if (!b.chapters.length) continue;
      const existing = books.find((x) => x.id === b.id);
      if (existing) existing.chapters.push(...b.chapters);
      else books.push(b);
    }
  return books;
}

/** Loads every markdown file in source/ (sorted by name), one string per file. */
export function loadNotes(): string[] {
  const dir = resolve(root, "source");
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => readFileSync(resolve(dir, f), "utf8"));
}
