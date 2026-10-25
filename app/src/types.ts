export type Question = {
  id: string;
  bookId: string;
  chapterId: string;
  stems: string[];
  correct: string[];
  distractors: string[];
  explanation: string;
  sourceExcerpt: string;
  difficulty: 1 | 2 | 3;
  status: "ok" | "flagged";
  /** Free-form tags, e.g. "wejściówka 1: historia i współczesność". Exams in index.json group by tag. */
  tags?: string[];
};

export type ChapterFile = {
  bookId: string;
  chapterId: string;
  chapterTitle: string;
  sourceHash: string;
  questions: Question[];
};

export type IndexChapter = { id: string; title: string; questionCount: number };
export type IndexBook = { id: string; title: string; chapters: IndexChapter[] };
export type IndexExamSource = { bookId: string; chapterId: string; questionCount: number };
export type IndexExam = { id: string; title: string; tag: string; questionCount: number; sources: IndexExamSource[] };
export type Index = { books: IndexBook[]; exams?: IndexExam[] };

export type Rng = () => number;

export type Option = { text: string; correct: boolean };
export type Rendered = { question: Question; stem: string; options: Option[]; correctIndex: number };
export type Answered = Rendered & { chosen: number; correctAnswer: boolean };
