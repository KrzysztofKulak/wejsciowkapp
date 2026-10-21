/**
 * Shared helpers: split source/notes.md into books and chapters, slugify ids,
 * and hash chapter text. Used by `npm run outline` and by the quiz-bank skill.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");
export const config = JSON.parse(readFileSync(resolve(root, "quiz.config.json"), "utf8")) as {
  notionUrl: string;
  bookHeading: string;
  chapterHeading: string;
  chapterPattern?: string;
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

const level = (h: string) => parseInt(h.replace(/^h/, ""), 10);

/**
 * Splits markdown into books and chapters.
 * - A heading at `bookHeading` level starts a book, unless it matches `chapterPattern`.
 * - A heading at `chapterHeading` level starts a chapter. If `chapterPattern` is set,
 *   only headings matching it start chapters; other headings become part of the chapter text.
 * - The very first heading (the page title) is ignored.
 */
export function splitNotes(md: string): Book[] {
  const bookLvl = level(config.bookHeading);
  const chapLvl = level(config.chapterHeading);
  const pattern = config.chapterPattern ? new RegExp(config.chapterPattern, "i") : null;
  const lines = md.split("\n");
  const books: Book[] = [];
  let book: Book | null = null;
  let chapter: Chapter | null = null;
  let buf: string[] = [];
  let seenTitle = false;

  const flush = () => {
    if (chapter) {
      const text = buf.join("\n").trim();
      chapter.text = text;
      chapter.words = text.split(/\s+/).filter(Boolean).length;
      chapter.hash = sha1(text);
    }
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const lvl = m[1].length;
      const title = m[2].trim();
      if (!seenTitle) { seenTitle = true; continue; }
      const isChapter = lvl === chapLvl && (!pattern || pattern.test(title));
      const isBook = lvl === bookLvl && !isChapter && !(pattern && pattern.test(title));
      if (isBook && (bookLvl !== chapLvl || !pattern || !pattern.test(title))) {
        flush();
        chapter = null;
        book = { id: slugify(title), title, chapters: [] };
        books.push(book);
        continue;
      }
      if (isChapter) {
        flush();
        if (!book) { book = { id: "notatki", title: "Notatki", chapters: [] }; books.push(book); }
        chapter = { id: slugify(title), title, text: "", words: 0, hash: "" };
        book.chapters.push(chapter);
        continue;
      }
    }
    if (chapter) buf.push(line);
  }
  flush();
  return books;
}

export function loadNotes(): string {
  return readFileSync(resolve(root, "source/notes.md"), "utf8");
}
