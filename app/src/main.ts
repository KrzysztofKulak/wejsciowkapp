import "./style.css";
import type { Answered, ChapterFile, Index, IndexBook, Question, Rendered } from "./types";
import { LABELS, assembleOptions, mulberry32, randomSeed, sampleQuestions } from "./quiz";

const BASE = import.meta.env.BASE_URL;
const app = document.getElementById("app")!;

// ---------- persistence (localStorage, always guarded) ----------
const LS_SEL = "wejsciowka.selection";
const LS_MISS = "wejsciowka.misses";
type Selection = { chapters: string[]; count: number; weak: boolean };
type MissStats = Record<string, { seen: number; missed: number }>;

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// ---------- data ----------
const chapterCache = new Map<string, Promise<ChapterFile>>();
async function loadIndex(): Promise<Index> {
  const r = await fetch(`${BASE}data/index.json`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`index.json: HTTP ${r.status}`);
  return r.json();
}
function loadChapter(bookId: string, chapterId: string): Promise<ChapterFile> {
  const key = `${bookId}/${chapterId}`;
  if (!chapterCache.has(key)) {
    chapterCache.set(
      key,
      fetch(`${BASE}data/bank/${bookId}/${chapterId}.json`, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`${key}: HTTP ${r.status}`);
        return r.json();
      }),
    );
  }
  return chapterCache.get(key)!;
}

// ---------- helpers ----------
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string | null | undefined | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== "string") (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
function render(...nodes: (Node | string)[]) {
  app.replaceChildren(...nodes);
  window.scrollTo({ top: 0 });
}
const seedParam = new URLSearchParams(location.search).get("seed");
function makeRng() {
  const seed = seedParam && /^\d+$/.test(seedParam) ? Number(seedParam) >>> 0 : randomSeed();
  return { seed, rng: mulberry32(seed) };
}
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
function setKeys(fn: ((e: KeyboardEvent) => void) | null) {
  if (keyHandler) window.removeEventListener("keydown", keyHandler);
  keyHandler = fn;
  if (fn) window.addEventListener("keydown", fn);
}

// ---------- state ----------
let index: Index;
const titles = new Map<string, { book: string; chapter: string }>();

// ---------- views ----------
function setupView(error?: string) {
  setKeys(null);
  const saved = lsGet<Selection>(LS_SEL, { chapters: [], count: 10, weak: false });
  const available = new Set(index.books.flatMap((b) => b.chapters.map((c) => `${b.id}/${c.id}`)));
  const selected = new Set(saved.chapters.filter((k) => available.has(k)));
  const misses = lsGet<MissStats>(LS_MISS, {});
  const hasStats = Object.keys(misses).length > 0;

  const countOut = h("output", {}, "0");
  const range = h("input", { type: "range", min: 1, max: 1, value: saved.count }) as HTMLInputElement;
  const startBtn = h("button", { class: "primary", onClick: () => start() }, "Start") as HTMLButtonElement;
  const weakChk = h("input", { type: "checkbox", checked: saved.weak && hasStats, disabled: !hasStats }) as HTMLInputElement;

  const chapterInputs = new Map<string, HTMLInputElement>();
  const bookInputs = new Map<string, HTMLInputElement>();

  function availableCount() {
    let n = 0;
    for (const b of index.books) for (const c of b.chapters) if (selected.has(`${b.id}/${c.id}`)) n += c.questionCount;
    return n;
  }
  function refresh() {
    const max = availableCount();
    range.max = String(Math.max(max, 1));
    range.disabled = max === 0;
    const want = Number(range.value) || saved.count;
    range.value = String(Math.min(Math.max(1, want), Math.max(max, 1)));
    if (max > 0 && !userTouchedRange && want < saved.count) range.value = String(Math.min(saved.count, max));
    countOut.textContent = max === 0 ? "0" : range.value;
    startBtn.disabled = max === 0;
    for (const b of index.books) {
      const all = b.chapters.every((c) => selected.has(`${b.id}/${c.id}`));
      const some = b.chapters.some((c) => selected.has(`${b.id}/${c.id}`));
      const inp = bookInputs.get(b.id)!;
      inp.checked = all;
      inp.indeterminate = !all && some;
    }
  }
  let userTouchedRange = false;
  range.addEventListener("input", () => { userTouchedRange = true; refresh(); });

  function bookNode(b: IndexBook) {
    const bookChk = h("input", { type: "checkbox", onClick: (e: Event) => e.stopPropagation() }) as HTMLInputElement;
    bookChk.addEventListener("change", () => {
      for (const c of b.chapters) {
        const k = `${b.id}/${c.id}`;
        if (bookChk.checked) selected.add(k);
        else selected.delete(k);
        chapterInputs.get(k)!.checked = bookChk.checked;
      }
      refresh();
    });
    bookInputs.set(b.id, bookChk);
    const chapters = b.chapters.map((c) => {
      const k = `${b.id}/${c.id}`;
      const inp = h("input", { type: "checkbox", checked: selected.has(k) }) as HTMLInputElement;
      inp.addEventListener("change", () => {
        if (inp.checked) selected.add(k);
        else selected.delete(k);
        refresh();
      });
      chapterInputs.set(k, inp);
      return h("label", { class: "chk" }, inp, h("span", {}, c.title), h("span", { class: "count" }, `${c.questionCount} pyt.`));
    });
    const open = b.chapters.some((c) => selected.has(`${b.id}/${c.id}`)) || index.books.length === 1;
    return h(
      "details",
      { class: "book", open },
      h("summary", {}, h("span", { class: "chev" }, "▸"), h("label", { class: "chk", style: "padding:0", onClick: (e: Event) => e.stopPropagation() }, bookChk, h("span", {}, b.title)), h("span", { class: "muted" }, `(cała książka)`)),
      h("div", { class: "chapters" }, ...chapters),
    );
  }

  async function start() {
    const chapters = [...selected];
    const sel: Selection = { chapters, count: Number(range.value), weak: weakChk.checked };
    lsSet(LS_SEL, sel);
    startBtn.disabled = true;
    startBtn.textContent = "Ładowanie…";
    try {
      const files = await Promise.all(chapters.map((k) => loadChapter(...(k.split("/") as [string, string]))));
      const pool = files.flatMap((f) => f.questions.filter((q) => q.status === "ok"));
      const { seed, rng } = makeRng();
      const weight = sel.weak ? (q: Question) => 1 + 3 * (misses[q.id]?.missed ?? 0) + (misses[q.id] ? 0 : 1) : undefined;
      const qs = sampleQuestions(pool, sel.count, rng, weight);
      quizView(qs, rng, seed);
    } catch (e) {
      setupView(`Nie udało się wczytać pytań: ${(e as Error).message}`);
    }
  }

  render(
    h("div", { class: "topbar" }, h("span", { class: "title" }, "🧠 Wejściówka"), h("span", { class: "muted" }, `${index.books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.questionCount, 0), 0)} pytań w bazie`)),
    error ? h("p", { class: "error" }, error) : "",
    h("div", { class: "card" }, h("h2", { style: "margin-top:0" }, "Zakres"), ...index.books.map(bookNode)),
    h(
      "div",
      { class: "card" },
      h("h2", { style: "margin-top:0" }, "Liczba pytań"),
      h("div", { class: "count-picker" }, range, countOut),
      h("label", { class: "chk", style: "margin-top:8px" }, weakChk, h("span", {}, "Skup się na słabych", h("span", { class: "muted" }, hasStats ? " (częściej pytania, które mylisz)" : " (brak statystyk, zagraj najpierw)"))),
    ),
    startBtn,
    h("footer", { class: "muted" }, "Klawisze: 1–4 / A–D wybierają odpowiedź, Enter idzie dalej."),
  );
  refresh();
}

function quizView(questions: Question[], rng: () => number, seed: number) {
  const answers: Answered[] = [];
  let i = 0;

  function showQuestion() {
    const q = questions[i];
    const r: Rendered = assembleOptions(q, rng, 4);
    let answered = false;
    const t = titles.get(`${q.bookId}/${q.chapterId}`);

    const buttons = r.options.map((o, idx) =>
      h("button", { class: "opt", onClick: () => answer(idx) }, h("span", { class: "lbl" }, LABELS[idx]), h("span", {}, o.text)),
    ) as HTMLButtonElement[];
    const feedback = h("div", { class: "feedback" });
    const nextBtn = h("button", { class: "primary next", style: "display:none", onClick: () => next() }, i + 1 < questions.length ? "Dalej" : "Podsumowanie");

    function answer(idx: number) {
      if (answered) return;
      answered = true;
      const ok = r.options[idx].correct;
      answers.push({ ...r, chosen: idx, correctAnswer: ok });
      const stats = lsGet<MissStats>(LS_MISS, {});
      const s = (stats[q.id] ??= { seen: 0, missed: 0 });
      s.seen++;
      if (!ok) s.missed++;
      lsSet(LS_MISS, stats);
      buttons.forEach((b, j) => {
        b.disabled = true;
        if (j === r.correctIndex) b.classList.add("correct");
        else if (j === idx) b.classList.add("wrong");
      });
      feedback.replaceChildren(
        h("p", { class: `verdict ${ok ? "ok" : "bad"}` }, ok ? "✓ Dobrze" : `✗ Źle — prawidłowa: ${LABELS[r.correctIndex]}`),
        h("p", {}, q.explanation),
        h(
          "details",
          { class: "source" },
          h("summary", {}, "Źródło w notatkach"),
          h("blockquote", {}, q.sourceExcerpt),
          h("p", { class: "muted" }, `${t?.book ?? q.bookId} → ${t?.chapter ?? q.chapterId}`),
        ),
      );
      nextBtn.style.display = "";
      nextBtn.focus();
    }
    function next() {
      i++;
      if (i < questions.length) showQuestion();
      else summaryView(questions, answers, seed);
    }
    setKeys((e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      const idx = /^[1-4]$/.test(k) ? Number(k) - 1 : LABELS.indexOf(k as any);
      if (idx >= 0 && idx < 4 && !answered) {
        e.preventDefault();
        answer(idx);
      } else if ((e.key === "Enter" || e.key === " ") && answered) {
        e.preventDefault();
        next();
      }
    });

    render(
      h("div", { class: "topbar" }, h("span", { class: "muted" }, `Pytanie ${i + 1} / ${questions.length}`), h("span", { class: "muted" }, `${answers.filter((a) => a.correctAnswer).length} ✓`)),
      h("div", { class: "progress" }, h("div", { style: `width:${(i / questions.length) * 100}%` })),
      h("div", { class: "card" }, h("p", { class: "muted", style: "margin-top:0" }, t?.chapter ?? q.chapterId), h("p", { class: "stem" }, r.stem), h("div", { class: "options" }, ...buttons), feedback, nextBtn),
      h("footer", {}, h("button", { class: "ghost muted", onClick: () => { if (confirm("Przerwać quiz?")) setupView(); } }, "Przerwij")),
    );
  }
  showQuestion();
}

function summaryView(questions: Question[], answers: Answered[], seed: number) {
  setKeys(null);
  const correct = answers.filter((a) => a.correctAnswer).length;
  const pct = answers.length ? Math.round((100 * correct) / answers.length) : 0;
  const perChapter = new Map<string, { ok: number; n: number }>();
  for (const a of answers) {
    const k = `${a.question.bookId}/${a.question.chapterId}`;
    const s = perChapter.get(k) ?? { ok: 0, n: 0 };
    s.n++;
    if (a.correctAnswer) s.ok++;
    perChapter.set(k, s);
  }
  const missed = answers.filter((a) => !a.correctAnswer);

  render(
    h("div", { class: "card" },
      h("p", { class: "muted", style: "margin-top:0" }, "Wynik"),
      h("p", { class: "score" }, `${correct} / ${answers.length}`, h("span", { class: "muted", style: "font-size:1rem;font-weight:500" }, ` (${pct}%)`)),
      h("div", { class: "bar" }, h("div", { style: `width:${pct}%` })),
    ),
    h("div", { class: "card" },
      h("h2", { style: "margin-top:0" }, "Według rozdziałów"),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Rozdział"), h("th", { class: "num" }, "Wynik"))),
        h("tbody", {}, ...[...perChapter].map(([k, s]) => h("tr", {}, h("td", {}, titles.get(k)?.chapter ?? k), h("td", { class: "num" }, `${s.ok} / ${s.n}`))))),
    ),
    missed.length
      ? h("div", { class: "card" },
          h("h2", { style: "margin-top:0" }, `Pomyłki (${missed.length})`),
          ...missed.map((a) =>
            h("div", { class: "miss" },
              h("p", { class: "q" }, a.stem),
              h("p", { class: "a" }, h("span", { class: "badtxt" }, a.options[a.chosen].text), " → ", h("span", { class: "good" }, a.options[a.correctIndex].text)),
              h("p", { class: "muted", style: "font-size:0.88rem" }, a.question.explanation),
            ),
          ),
        )
      : h("div", { class: "card" }, h("p", { style: "margin:0" }, "Bezbłędnie! 🎉")),
    h("div", { class: "actions" },
      missed.length ? h("button", { class: "primary", onClick: () => retryMissed() }, `Powtórz pomyłki (${missed.length})`) : "",
      h("button", { onClick: () => { const { rng, seed: s } = makeRng(); quizView(sampleQuestions(questions, questions.length, rng), rng, s); } }, "Jeszcze raz ten sam zestaw"),
      h("button", { onClick: () => setupView() }, "Nowy quiz"),
    ),
    h("footer", { class: "muted" }, `seed: ${seed}`),
  );

  function retryMissed() {
    const { rng, seed: s } = makeRng();
    const qs = sampleQuestions(missed.map((a) => a.question), missed.length, rng);
    quizView(qs, rng, s);
  }
}

// ---------- boot ----------
(async () => {
  render(h("p", { class: "muted" }, "Ładowanie…"));
  try {
    index = await loadIndex();
    for (const b of index.books) for (const c of b.chapters) titles.set(`${b.id}/${c.id}`, { book: b.title, chapter: c.title });
    setupView();
  } catch (e) {
    render(h("p", { class: "error" }, `Nie udało się wczytać bazy pytań: ${(e as Error).message}`));
  }
})();
