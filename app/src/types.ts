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

/** `cheatsheet`: a markdown note exists at data/cheatsheets/<bookId>/<chapterId>.md */
export type IndexChapter = { id: string; title: string; questionCount: number; cheatsheet?: boolean };
export type IndexBook = { id: string; title: string; chapters: IndexChapter[] };
export type IndexExamSource = { bookId: string; chapterId: string; questionCount: number };
/** `cheatsheet`: a markdown note exists at data/cheatsheets/_zaliczenia/<id>.md */
export type IndexExam = { id: string; title: string; tag: string; questionCount: number; sources: IndexExamSource[]; cheatsheet?: boolean };
export type IndexSubject = { id: string; title: string; books: string[] };
export type IndexSemester = { id: string; title: string; subjects: string[] };
export type Index = { books: IndexBook[]; exams?: IndexExam[]; subjects?: IndexSubject[]; semesters?: IndexSemester[] };

export type Rng = () => number;

export type Option = { text: string; correct: boolean };
export type Rendered = { question: Question; stem: string; options: Option[]; correctIndex: number };
export type Answered = Rendered & { chosen: number; correctAnswer: boolean };
