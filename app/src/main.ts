import "./style.css";
import { marked } from "marked";
import type { Answered, ChapterFile, Index, IndexBook, IndexExam, Question, Rendered } from "./types";
import { LABELS, assembleOptions, mulberry32, randomSeed, sampleQuestions } from "./quiz";
import { DEFAULT_ORAL_MODEL, ORAL_MODELS, isOralModel, type OralModel } from "./oral-models";

const BASE = import.meta.env.BASE_URL;
const app = document.getElementById("app")!;

// ---------- persistence (localStorage, always guarded) ----------
const LS_SEL = "wejsciowka.selection";
const LS_MISS = "wejsciowka.misses";
const LS_API_KEY = "wejsciowka.apiKey"; // only when the user ticks "remember the key on this device"
const LS_ORAL_N = "wejsciowka.oralCount";
const LS_ORAL_MODEL = "wejsciowka.oralModel";
type Selection = { chapters: string[]; exams?: string[]; count: number; weak: boolean; fun?: boolean };

// "Wzmocnione metody nauki": reaction media shown after each answer.
const SAD_MEDIA = [
  "https://media1.tenor.com/m/JSsbgbr81NIAAAAd/disappointed-cat.gif",
  "https://media1.tenor.com/m/f74SroHPjVEAAAAC/sad-cat-cat-with-hat.gif",
  "https://media1.tenor.com/m/t9PLz06a24wAAAAC/sad-cat.gif",
  "https://media1.tenor.com/m/WFVIGNx9dxIAAAAC/crying.gif",
  "https://media1.tenor.com/m/sQf0cT8G5soAAAAC/cat.gif",
  "https://media.tenor.com/IpBYhJKqym4AAAP1/high-cat.mp4",
  "https://media.tenor.com/vB-w7iKKQsMAAAAM/ohno.gif",
  "https://media.tenor.com/zmtGT15b_5sAAAP1/middle-finger-flip-off.mp4",
  "https://media.tenor.com/6IKOpbGWD_QAAAP1/cat-with-wiered-and-cute-reactions-cat.mp4",
  "https://media.tenor.com/xqghrtvGNC8AAAP1/cat-cat-meme.mp4",
  "https://media.tenor.com/va65e03ETmYAAAP1/orange-cat-cat-hitting-cat.mp4",
  "https://media.tenor.com/kWkFDCo5zWYAAAP1/cat-rollin-cat.mp4",
  "https://media.tenor.com/vtafMdD8sMsAAAP1/cat-kitty.mp4",
  "https://media.tenor.com/SXySZvYzlPUAAAAM/cat.gif",
  "https://media.tenor.com/YlWsJmNCxAMAAAP1/scoobert-mad-cat.mp4",
];
const HAPPY_MEDIA = [
  "https://media.tenor.com/WsWej1C3ePYAAAP1/yippee-cat-kitty.mp4",
  "https://media.tenor.com/28qJp9li1WQAAAP1/lumedoallumenaria-dancing-cat-ai.mp4",
  "https://media.tenor.com/i_rMKdLlNlYAAAP1/cat-smiling-cat-cute.mp4",
  "https://media.tenor.com/ECATiSXWwm8AAAAm/dancing-cat-cat.webp",
  "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExZzd6ejhtbGx1NzJjc3kxd3B3cjd2bG02dWwzeXE5bmYxNTk3amFzdCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/TbRkubcqlgBksEqMv4/200w.webp",
  "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExZzd6ejhtbGx1NzJjc3kxd3B3cjd2bG02dWwzeXE5bmYxNTk3amFzdCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/E98InhHHr5LfgU5KkU/giphy.webp",
  "https://media.tenor.com/LzESVERU1OAAAAAm/chat-pouce.webp",
  "https://media.tenor.com/aNKgtdT5ymEAAAP1/cat-dance-cat.mp4",
  "https://media.tenor.com/8dTA0WCA99AAAAP1/cats-cat.mp4",
  "https://media.tenor.com/ZXPCRT8wKXgAAAP1/cat-scuba-cat.mp4",
  "https://media.tenor.com/Km11GYbvYY0AAAP1/good-morning.mp4",
  "https://media.tenor.com/Cbgs3WHCq_AAAAAm/kitty-dance.webp",
  "https://media.tenor.com/DimrKSoVMfoAAAP1/cat-cat-memes.mp4",
  "https://media.tenor.com/3gE520j0eiwAAAAm/meow-zhe.webp",
  "https://media.tenor.com/E1E7Sv8n-kAAAAAm/cat-dance.webp",
];
function reactionMedia(ok: boolean): HTMLElement {
  const list = ok ? HAPPY_MEDIA : SAD_MEDIA;
  const url = list[Math.floor(Math.random() * list.length)];
  const el = url.endsWith(".mp4")
    ? h("video", { src: url, autoplay: true, muted: true, loop: true, playsInline: true, "aria-hidden": "true" })
    : h("img", { src: url, alt: "", "aria-hidden": "true" });
  const wrap = h("div", { class: "reaction" }, el);
  el.addEventListener("error", () => wrap.remove());
  return wrap;
}
type MissStats = Record<string, { seen: number; missed: number }>;

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsDel(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
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

/** Markdown cheatsheets: data/cheatsheets/<bookId>/<chapterId>.md, exams under _zaliczenia/<examId>.md. */
const cheatCache = new Map<string, Promise<string>>();
function loadCheatsheet(path: string): Promise<string> {
  if (!cheatCache.has(path)) {
    cheatCache.set(
      path,
      fetch(`${BASE}data/cheatsheets/${path}.md`, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`${path}.md: HTTP ${r.status}`);
        return r.text();
      }),
    );
  }
  return cheatCache.get(path)!;
}
type CheatItem = { path: string; book: string; title: string };

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

// Cheatsheet and oral-quiz views get their own history entry, so the browser/phone back button returns to the setup.
const SUBVIEW_HASHES = ["#cheatsheet", "#przepytka"];
let inSubview = false;
window.addEventListener("popstate", () => {
  if (inSubview) setupView();
});
function enterSubview(hash: string) {
  if (!inSubview) history.pushState({ view: hash }, "", hash);
  else history.replaceState({ view: hash }, "", hash);
  inSubview = true;
}
const leaveSubview = () => (SUBVIEW_HASHES.includes(location.hash) ? history.back() : setupView());

// ---------- views ----------
function setupView(error?: string) {
  setKeys(null);
  inSubview = false;
  const saved = lsGet<Selection>(LS_SEL, { chapters: [], count: 10, weak: false, fun: true });
  const available = new Set(index.books.flatMap((b) => b.chapters.map((c) => `${b.id}/${c.id}`)));
  const selected = new Set(saved.chapters.filter((k) => available.has(k)));
  const exams: IndexExam[] = index.exams ?? [];
  const selectedExams = new Set((saved.exams ?? []).filter((id) => exams.some((e) => e.id === id)));
  const misses = lsGet<MissStats>(LS_MISS, {});
  const hasStats = Object.keys(misses).length > 0;

  const countOut = h("output", {}, "0");
  const range = h("input", { type: "range", min: 1, max: 1, value: saved.count }) as HTMLInputElement;
  const startBtn = h("button", { class: "primary", onClick: () => start() }, "Start") as HTMLButtonElement;
  const cheatBtn = h("button", { class: "secondary", onClick: () => openCheatsheet() }, "📄 Cheatsheet") as HTMLButtonElement;
  // "Przepytaj mnie": the button turns into a small form (API key, number of questions) in place.
  const oralBtn = h("button", { class: "secondary", onClick: () => showOralForm() }, "🎓 Przepytaj mnie") as HTMLButtonElement;
  const oralSlot = h("div", { class: "oral-slot" }, oralBtn);
  const weakChk = h("input", { type: "checkbox", checked: saved.weak && hasStats, disabled: !hasStats }) as HTMLInputElement;
  const funChk = h("input", { type: "checkbox", checked: saved.fun !== false }) as HTMLInputElement;

  const chapterInputs = new Map<string, HTMLInputElement>();
  const bookInputs = new Map<string, HTMLInputElement>();

  function availableCount() {
    let n = 0;
    for (const b of index.books) for (const c of b.chapters) if (selected.has(`${b.id}/${c.id}`)) n += c.questionCount;
    // exam questions that live in an already selected chapter are the same questions: count them once
    for (const e of exams)
      if (selectedExams.has(e.id))
        for (const src of e.sources) if (!selected.has(`${src.bookId}/${src.chapterId}`)) n += src.questionCount;
    return n;
  }
  const maxLabel = h("p", { class: "muted max-label" });
  function refresh() {
    const max = availableCount();
    range.max = String(Math.max(max, 1));
    range.disabled = max === 0;
    const want = Number(range.value) || saved.count;
    range.value = String(Math.min(Math.max(1, want), Math.max(max, 1)));
    if (max > 0 && !userTouchedRange && want < saved.count) range.value = String(Math.min(saved.count, max));
    countOut.textContent = max === 0 ? "0" : range.value;
    maxLabel.textContent = max === 0 ? "Maksymalnie: 0 – zaznacz zakres" : `Maksymalnie: ${max}`;
    startBtn.disabled = max === 0;
    const cheats = cheatItems().items.length;
    cheatBtn.disabled = cheats === 0;
    cheatBtn.textContent = cheats ? `📄 Cheatsheet (${cheats})` : "📄 Cheatsheet";
    cheatBtn.title = cheats ? "" : "Zaznacz zakres, który ma ściągawkę";
    oralBtn.disabled = cheats === 0;
    oralBtn.title = cheats ? "Claude zada pytania otwarte z zaznaczonego materiału" : "Zaznacz zakres, który ma ściągawkę";
    for (const b of index.books) {
      const all = b.chapters.every((c) => selected.has(`${b.id}/${c.id}`));
      const some = b.chapters.some((c) => selected.has(`${b.id}/${c.id}`));
      const inp = bookInputs.get(b.id)!;
      inp.checked = all;
      inp.indeterminate = !all && some;
    }
    for (const g of groups) {
      const n = g.books.reduce((acc, b) => acc + b.chapters.filter((c) => selected.has(`${b.id}/${c.id}`)).length, 0);
      const total = g.books.reduce((acc, b) => acc + b.chapters.length, 0);
      g.badge.textContent = n ? `${n} zazn.` : "";
      g.chk.checked = n > 0 && n === total;
      g.chk.indeterminate = n > 0 && n < total;
    }
    for (const sem of semesterGroups) {
      const n = sem.groups.reduce((acc, g) => acc + g.books.reduce((a, b) => a + b.chapters.filter((c) => selected.has(`${b.id}/${c.id}`)).length, 0), 0);
      sem.badge.textContent = n ? `${n} zazn.` : "";
    }
    persist();
  }
  let userTouchedRange = false;
  range.addEventListener("input", () => { userTouchedRange = true; refresh(); });

  // Remember the setup locally on every change (not only on Start), so a reload restores exactly what was picked.
  // The question count is stored only once the user moves the slider, so a small pool doesn't shrink the default.
  let lastCount = saved.count;
  function persist() {
    if (userTouchedRange && !range.disabled) lastCount = Number(range.value);
    lsSet(LS_SEL, { chapters: [...selected], exams: [...selectedExams], count: lastCount, weak: weakChk.checked, fun: funChk.checked });
  }
  weakChk.addEventListener("change", persist);
  funChk.addEventListener("change", persist);

  // Subject search: every typed word must be the beginning of some word in the subject title
  // (case- and diacritics-insensitive), so "b" → "Biologiczne…", "spol" → "…społecznej".
  const norm = (s: string) => s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
  type Group = { el: HTMLDetailsElement; words: string[]; badge: HTMLElement; books: IndexBook[]; userOpen: boolean; chk: HTMLInputElement };
  const groups: Group[] = [];
  type Semester = { el: HTMLDetailsElement; groups: Group[]; badge: HTMLElement; userOpen: boolean };
  const semesterGroups: Semester[] = [];
  let searching = false;
  const search = h("input", { type: "search", class: "search", placeholder: "Szukaj przedmiotu…", "aria-label": "Szukaj przedmiotu", autocomplete: "off" }) as HTMLInputElement;
  const noMatch = h("p", { class: "muted", style: "display:none;margin:0" });
  search.addEventListener("input", () => {
    const qWords = words(search.value);
    searching = qWords.length > 0;
    let shown = 0;
    for (const g of groups) {
      const ok = qWords.every((qw) => g.words.some((w) => w.startsWith(qw)));
      g.el.style.display = ok ? "" : "none";
      // while searching, matches are expanded; clearing the field restores what the user opened by hand
      g.el.open = searching ? ok : g.userOpen;
      if (ok) shown++;
    }
    for (const sem of semesterGroups) {
      const any = sem.groups.some((g) => g.el.style.display !== "none");
      sem.el.style.display = any ? "" : "none";
      sem.el.open = searching ? any : sem.userOpen;
    }
    noMatch.textContent = `Brak przedmiotów pasujących do „${search.value.trim()}”.`;
    noMatch.style.display = shown ? "none" : "";
  });

  /** Books grouped under subject headers (visual only: any books can still be selected together). */
  function scopeNodes(): Node[] {
    const subjects = index.subjects ?? [];
    if (!subjects.length) return index.books.map(bookNode);
    const byId = new Map(index.books.map((b) => [b.id, b] as const));
    const used = new Set<string>();
    // Subjects are collapsible and start collapsed; the badge shows how many chapters are selected inside.
    const group = (title: string, books: IndexBook[]) => {
      const badge = h("span", { class: "subject-count" });
      // whole-subject checkbox: selects/clears every chapter of every book in the subject (tri-state like books)
      const chk = h("input", { type: "checkbox", title: "Cały przedmiot", "aria-label": `Cały przedmiot: ${title}` }) as HTMLInputElement;
      chk.addEventListener("click", (e) => e.stopPropagation());
      const el = h(
        "details",
        { class: "subject" },
        h("summary", { class: "subject-title" }, h("span", { class: "chev" }, "▸"), chk, h("span", {}, title), badge),
        ...books.map(bookNode),
      ) as HTMLDetailsElement;
      chk.addEventListener("change", () => {
        for (const b of books)
          for (const c of b.chapters) {
            const k = `${b.id}/${c.id}`;
            if (chk.checked) selected.add(k);
            else selected.delete(k);
            chapterInputs.get(k)!.checked = chk.checked;
          }
        refresh();
      });
      const g: Group = { el, words: words(title), badge, books, userOpen: false, chk };
      el.addEventListener("toggle", () => { if (!searching) g.userOpen = el.open; });
      groups.push(g);
      return el;
    };
    const subjectEls = new Map<string, HTMLDetailsElement>();
    for (const sub of subjects) {
      const books = sub.books.map((id) => byId.get(id)).filter((b): b is IndexBook => !!b);
      books.forEach((b) => used.add(b.id));
      if (books.length) subjectEls.set(sub.id, group(sub.title, books));
    }
    const rest = index.books.filter((b) => !used.has(b.id));
    const restEl = rest.length ? group("Inne", rest) : null;
    const semesters = index.semesters ?? [];
    if (!semesters.length) return [...subjectEls.values(), ...(restEl ? [restEl] : [])];

    // Semesters: level above subjects, collapsible, open by default (subjects inside start collapsed).
    const semesterNode = (title: string, els: HTMLDetailsElement[]) => {
      const badge = h("span", { class: "subject-count" });
      const el = h(
        "details",
        { class: "semester", open: true },
        h("summary", { class: "semester-title" }, h("span", { class: "chev" }, "▸"), h("span", {}, title), badge),
        h("div", { class: "semester-body" }, ...els),
      ) as HTMLDetailsElement;
      const sem: Semester = { el, groups: groups.filter((g) => els.includes(g.el)), badge, userOpen: true };
      el.addEventListener("toggle", () => { if (!searching) sem.userOpen = el.open; });
      semesterGroups.push(sem);
      return el;
    };
    const out: Node[] = [];
    const placed = new Set<string>();
    for (const sem of semesters) {
      const els = sem.subjects.map((id) => subjectEls.get(id)).filter((e): e is HTMLDetailsElement => !!e);
      sem.subjects.forEach((id) => placed.add(id));
      if (els.length) out.push(semesterNode(sem.title, els));
    }
    const loose = [...subjectEls].filter(([id]) => !placed.has(id)).map(([, el]) => el);
    if (restEl) loose.push(restEl);
    if (loose.length) out.push(semesterNode("Inne", loose));
    return out;
  }

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

  /** Cheatsheets for the current selection: exams first, then chapters in index order; chapters without one are listed as missing. */
  function cheatItems() {
    const items: CheatItem[] = [];
    const missing: string[] = [];
    for (const e of exams)
      if (selectedExams.has(e.id)) {
        if (e.cheatsheet) items.push({ path: `_zaliczenia/${e.id}`, book: "Zaliczenie", title: e.title });
        else missing.push(e.title);
      }
    for (const b of index.books)
      for (const c of b.chapters)
        if (selected.has(`${b.id}/${c.id}`)) {
          if (c.cheatsheet) items.push({ path: `${b.id}/${c.id}`, book: b.title, title: c.title });
          else missing.push(`${b.title} · ${c.title}`);
        }
    return { items, missing };
  }
  function openCheatsheet() {
    const { items, missing } = cheatItems();
    if (items.length) cheatsheetView(items, missing);
  }

  function showOralForm() {
    const savedKey = lsGet<string>(LS_API_KEY, "");
    const keyInp = h("input", { type: "password", class: "field", placeholder: "sk-ant-…", autocomplete: "off", spellcheck: false, value: savedKey, "aria-label": "Klucz API Claude" }) as HTMLInputElement;
    const nInp = h("input", { type: "number", class: "field num", min: 1, max: 30, value: lsGet<number>(LS_ORAL_N, 5), "aria-label": "Liczba pytań" }) as HTMLInputElement;
    const remember = h("input", { type: "checkbox", checked: !!savedKey }) as HTMLInputElement;
    const savedModel = lsGet<string>(LS_ORAL_MODEL, DEFAULT_ORAL_MODEL);
    const modelSel = h("select", { class: "field", "aria-label": "Model" },
      ...ORAL_MODELS.map((m) => h("option", { value: m.id, selected: m.id === savedModel }, m.label)),
    ) as HTMLSelectElement;
    const err = h("p", { class: "error", style: "display:none;margin:4px 0" });
    const sendBtn = h("button", { class: "primary", type: "submit" }, "Wyślij") as HTMLButtonElement;
    const cancel = () => oralSlot.replaceChildren(oralBtn);
    const form = h(
      "form",
      { class: "card oral-form", onSubmit: (e: Event) => { e.preventDefault(); go(); } },
      h("h2", { style: "margin-top:0" }, "🎓 Przepytaj mnie"),
      h("p", { class: "muted", style: "margin-top:-4px" }, `Claude zada pytania otwarte z zaznaczonego materiału (${cheatItems().items.length} ściąg.), oceni każdą odpowiedź i krótko to uzasadni.`),
      h("label", { class: "field-label" }, "Klucz API Claude", keyInp),
      h("label", { class: "field-label" }, "Liczba pytań", nInp),
      h("label", { class: "field-label" }, "Model", modelSel),
      h("label", { class: "chk", style: "padding:4px 0" }, remember, h("span", {}, "Zapamiętaj klucz na tym urządzeniu")),
      h("p", { class: "muted", style: "font-size:0.8rem" }, "Klucz trafia tylko z Twojej przeglądarki do api.anthropic.com, a koszt zapytań idzie na Twoje konto Anthropic. Klucz założysz na console.anthropic.com."),
      err,
      h("div", { class: "oral-actions" }, h("button", { type: "button", onClick: cancel }, "Cofnij"), sendBtn),
    );
    oralSlot.replaceChildren(form);
    keyInp.focus();
    function go() {
      const key = keyInp.value.trim();
      if (!key) {
        err.textContent = "Wklej klucz API.";
        err.style.display = "";
        keyInp.focus();
        return;
      }
      const n = Math.min(30, Math.max(1, Math.round(Number(nInp.value) || 5)));
      lsSet(LS_ORAL_N, n);
      const model: OralModel = isOralModel(modelSel.value) ? modelSel.value : DEFAULT_ORAL_MODEL;
      lsSet(LS_ORAL_MODEL, model);
      if (remember.checked) lsSet(LS_API_KEY, key);
      else lsDel(LS_API_KEY);
      oralView(key, n, model, cheatItems().items, funChk.checked);
    }
  }

  async function start() {
    const chapters = [...selected];
    const chosenExams = exams.filter((e) => selectedExams.has(e.id));
    const sel: Selection = { chapters, exams: chosenExams.map((e) => e.id), count: Number(range.value), weak: weakChk.checked, fun: funChk.checked };
    lsSet(LS_SEL, sel);
    startBtn.disabled = true;
    startBtn.textContent = "Ładowanie…";
    try {
      const files = await Promise.all(chapters.map((k) => loadChapter(...(k.split("/") as [string, string]))));
      const poolMap = new Map<string, Question>();
      for (const q of files.flatMap((f) => f.questions)) if (q.status === "ok") poolMap.set(q.id, q);
      // "Zaliczenia": questions grouped by tag across sources
      for (const e of chosenExams) {
        const srcFiles = await Promise.all(e.sources.map((src) => loadChapter(src.bookId, src.chapterId)));
        for (const q of srcFiles.flatMap((f) => f.questions)) if (q.status === "ok" && q.tags?.includes(e.tag)) poolMap.set(q.id, q);
      }
      const pool = [...poolMap.values()];
      const { seed, rng } = makeRng();
      const weight = sel.weak ? (q: Question) => 1 + 3 * (misses[q.id]?.missed ?? 0) + (misses[q.id] ? 0 : 1) : undefined;
      const qs = sampleQuestions(pool, sel.count, rng, weight);
      quizView(qs, rng, seed, sel.fun);
    } catch (e) {
      setupView(`Nie udało się wczytać pytań: ${(e as Error).message}`);
    }
  }

  function examNode(e: IndexExam) {
    const inp = h("input", { type: "checkbox", checked: selectedExams.has(e.id) }) as HTMLInputElement;
    inp.addEventListener("change", () => {
      if (inp.checked) selectedExams.add(e.id);
      else selectedExams.delete(e.id);
      refresh();
    });
    return h("label", { class: "chk" }, inp, h("span", {}, e.title), h("span", { class: "count" }, `${e.questionCount} pyt.`));
  }

  render(
    h("div", { class: "topbar" }, h("span", { class: "title" }, "🧠 Wejściówka"), h("span", { class: "muted" }, `${index.books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.questionCount, 0), 0)} pytań w bazie`)),
    error ? h("p", { class: "error" }, error) : "",
    h("div", { class: "searchbar" }, search),
    h("div", { class: "card" }, h("h2", { style: "margin-top:0" }, "Zakres"), h("div", { class: "subjects" }, ...scopeNodes(), noMatch)),
    exams.length
      ? h("div", { class: "card" }, h("h2", { style: "margin-top:0" }, "Zaliczenia"), h("p", { class: "muted", style: "margin-top:-4px" }, "Pytania zebrane pod kątem konkretnego zaliczenia, niezależnie od źródła."), ...exams.map(examNode))
      : "",
    h(
      "div",
      { class: "card" },
      h("h2", { style: "margin-top:0" }, "Liczba pytań"),
      maxLabel,
      h("div", { class: "count-picker" }, range, countOut),
      h("label", { class: "chk", style: "margin-top:8px" }, weakChk, h("span", {}, "Skup się na słabych", h("span", { class: "muted" }, hasStats ? " (częściej pytania, które mylisz)" : " (brak statystyk, zagraj najpierw)"))),
      h("label", { class: "chk" }, funChk, h("span", {}, "Enhanced learning techniques", h("span", { class: "muted" }, " (koty reagują na odpowiedzi)"))),
    ),
    startBtn,
    cheatBtn,
    oralSlot,
    h("footer", { class: "muted" }, "Klawisze: 1–4 / A–D wybierają odpowiedź, Enter idzie dalej."),
  );
  refresh();
}

async function cheatsheetView(items: CheatItem[], missing: string[]) {
  setKeys(null);
  enterSubview("#cheatsheet");
  const back = leaveSubview;
  const topbar = h(
    "div",
    { class: "topbar cs-topbar" },
    h("button", { class: "ghost", onClick: back }, "← Zakres"),
    h("span", { class: "title" }, "📄 Ściągawka"),
    h("button", { class: "ghost", onClick: () => window.print() }, "Drukuj"),
  );
  render(topbar, h("p", { class: "muted" }, "Ładowanie…"));
  const texts = await Promise.allSettled(items.map((it) => loadCheatsheet(it.path)));
  if (!inSubview) return; // user went back while loading
  const anchor = (i: number) => `cs-${i}`;
  const toc =
    items.length > 1
      ? h("nav", { class: "card cs-toc" }, h("p", { class: "muted", style: "margin-top:0" }, "Spis treści"),
          h("ol", {}, ...items.map((it, i) => h("li", {}, h("a", { href: `#${anchor(i)}`, onClick: (e: Event) => { e.preventDefault(); document.getElementById(anchor(i))?.scrollIntoView({ behavior: "smooth" }); } }, it.title), h("span", { class: "muted" }, ` · ${it.book}`)))))
      : "";
  const sections = items.map((it, i) => {
    const body = h("div", { class: "cs-body" });
    const t = texts[i];
    if (t.status === "fulfilled") body.innerHTML = marked.parse(t.value, { async: false }) as string;
    else body.append(h("p", { class: "error" }, `Nie udało się wczytać ściągawki: ${(t.reason as Error).message}`));
    return h("section", { class: "card cs-section", id: anchor(i) }, h("p", { class: "muted cs-book" }, it.book), h("h1", { class: "cs-title" }, it.title), body);
  });
  render(
    topbar,
    toc,
    ...sections,
    missing.length ? h("div", { class: "card cs-missing" }, h("p", { class: "muted", style: "margin:0" }, `Bez ściągawki (${missing.length}): ${missing.join("; ")}`)) : "",
    h("footer", {}, h("button", { class: "ghost muted", onClick: back }, "← Wróć do wyboru zakresu")),
  );
}

const VERDICT_UI: Record<string, { label: string; cls: string }> = {
  dobrze: { label: "✅ Dobrze", cls: "ok" },
  częściowo: { label: "🟡 Częściowo", cls: "part" },
  źle: { label: "❌ Źle", cls: "bad" },
};

/** Oral open-question quiz with Claude: one card per question, graded with a 1–3 sentence justification. */
async function oralView(apiKey: string, total: number, model: OralModel, items: CheatItem[], fun: boolean) {
  setKeys(null);
  enterSubview("#przepytka");
  const results: { verdict: string }[] = [];
  let finished = false;
  const back = () => {
    if (!finished && results.length && !confirm("Zakończyć przepytkę?")) return;
    leaveSubview();
  };
  const counter = h("span", { class: "muted" }, "");
  const log = h("div", { class: "oral-log" });
  const status = h("div", { class: "oral-status" });
  render(
    h("div", { class: "topbar cs-topbar" }, h("button", { class: "ghost", onClick: back }, "← Zakres"), h("span", { class: "title" }, "🎓 Przepytka"), counter),
    log,
    status,
  );
  const setCounter = () => (counter.textContent = `${results.length} / ${total}`);
  setCounter();

  /** Runs one Claude call with a "thinking" line; on failure shows the error and a retry button. */
  async function call<T>(fn: () => Promise<T>): Promise<T> {
    for (;;) {
      status.replaceChildren(h("p", { class: "muted oral-thinking" }, "Claude myśli…"));
      try {
        const out = await fn();
        status.replaceChildren();
        return out;
      } catch (e) {
        if (!inSubview) throw e;
        await new Promise<void>((resolve) =>
          status.replaceChildren(
            h("div", { class: "card" }, h("p", { class: "error", style: "margin-top:0" }, (e as Error).message),
              h("div", { class: "oral-actions" }, h("button", { onClick: back }, "Zakończ"), h("button", { class: "primary", onClick: () => resolve() }, "Spróbuj ponownie"))),
          ),
        );
      }
    }
  }

  let exam;
  try {
    const texts = await Promise.all(items.map((it) => loadCheatsheet(it.path)));
    const { OralExam } = await import("./oral");
    exam = new OralExam(apiKey, items.map((it, i) => ({ title: `${it.book} · ${it.title}`, markdown: texts[i] })), total, model);
  } catch (e) {
    status.replaceChildren(h("p", { class: "error" }, `Nie udało się przygotować materiału: ${(e as Error).message}`));
    return;
  }
  const ex = exam;
  const first = await call(() => ex.start());
  if (!inSubview) return;
  if (first.question) askQuestion(1, first.question);

  function askQuestion(i: number, question: string) {
    const answer = h("textarea", { class: "field oral-answer", rows: 4, placeholder: "Twoja odpowiedź… (Ctrl/⌘+Enter wysyła)" }) as HTMLTextAreaElement;
    const sendBtn = h("button", { class: "primary", onClick: () => submit(answer.value) }, "Odpowiedz") as HTMLButtonElement;
    const dunno = h("button", { onClick: () => submit("nie wiem") }, "Nie wiem") as HTMLButtonElement;
    const controls = h("div", { class: "oral-actions" }, dunno, sendBtn);
    const card = h("div", { class: "card oral-q" }, h("p", { class: "muted", style: "margin-top:0" }, `Pytanie ${i} / ${total}`), h("p", { class: "stem" }, question), answer, controls);
    log.append(card);
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    answer.focus({ preventScroll: true });
    answer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit(answer.value);
      }
    });
    let busy = false;
    async function submit(text: string) {
      if (busy) return;
      if (!text.trim()) {
        answer.focus();
        return;
      }
      busy = true;
      answer.readOnly = true;
      sendBtn.disabled = dunno.disabled = true;
      const turn = await call(() => ex.answer(i, text));
      if (!inSubview) return;
      const v = VERDICT_UI[turn.verdict ?? ""] ?? { label: "Ocena", cls: "part" };
      results.push({ verdict: turn.verdict ?? "" });
      setCounter();
      controls.replaceWith(
        h("div", { class: `oral-verdict ${v.cls}` },
          h("div", { class: "feedback-row" },
            h("div", { class: "feedback-text" }, h("p", { class: "oral-badge" }, v.label), h("p", {}, turn.justification ?? "")),
            fun && v.cls !== "part" ? reactionMedia(v.cls === "ok") : "",
          ),
        ),
      );
      if (turn.question && i < total) askQuestion(i + 1, turn.question);
      else summary();
    }
  }

  function summary() {
    finished = true;
    const n = (v: string) => results.filter((r) => r.verdict === v).length;
    const score = results.length ? Math.round((100 * (n("dobrze") + 0.5 * n("częściowo"))) / results.length) : 0;
    const card = h("div", { class: "card" },
      h("p", { class: "muted", style: "margin-top:0" }, "Wynik przepytki"),
      h("p", { class: "score" }, `${score}%`),
      h("div", { class: "bar" }, h("div", { style: `width:${score}%` })),
      h("p", {}, `✅ ${n("dobrze")} · 🟡 ${n("częściowo")} · ❌ ${n("źle")}`),
      h("div", { class: "actions" },
        h("button", { class: "primary", onClick: () => oralView(apiKey, total, model, items, fun) }, "Jeszcze raz"),
        h("button", { onClick: () => leaveSubview() }, "Wróć do wyboru zakresu"),
      ),
    );
    log.append(card);
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function quizView(questions: Question[], rng: () => number, seed: number, fun = true) {
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
        h("div", { class: "feedback-row" },
          h("div", { class: "feedback-text" },
            h("p", { class: `verdict ${ok ? "ok" : "bad"}` }, ok ? "✓ Dobrze" : `✗ Źle — prawidłowa: ${LABELS[r.correctIndex]}`),
            h("p", {}, q.explanation),
          ),
          fun ? reactionMedia(ok) : "",
        ),
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
      else summaryView(questions, answers, seed, fun);
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
      h("div", { class: "card" }, h("p", { class: "muted", style: "margin-top:0" }, t ? `${t.book} · ${t.chapter}` : q.chapterId), h("p", { class: "stem" }, r.stem), h("div", { class: "options" }, ...buttons), feedback, nextBtn),
      h("footer", {}, h("button", { class: "ghost muted", onClick: () => { if (confirm("Przerwać quiz?")) setupView(); } }, "Przerwij")),
    );
  }
  showQuestion();
}

function summaryView(questions: Question[], answers: Answered[], seed: number, fun = true) {
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
      h("button", { onClick: () => { const { rng, seed: s } = makeRng(); quizView(sampleQuestions(questions, questions.length, rng), rng, s, fun); } }, "Jeszcze raz ten sam zestaw"),
      h("button", { onClick: () => setupView() }, "Nowy quiz"),
    ),
    h("footer", { class: "muted" }, `seed: ${seed}`),
  );

  function retryMissed() {
    const { rng, seed: s } = makeRng();
    const qs = sampleQuestions(missed.map((a) => a.question), missed.length, rng);
    quizView(qs, rng, s, fun);
  }
}

// ---------- boot ----------
(async () => {
  render(h("p", { class: "muted" }, "Ładowanie…"));
  try {
    if (SUBVIEW_HASHES.includes(location.hash)) history.replaceState(null, "", location.pathname + location.search); // reload lands on the setup
    index = await loadIndex();
    for (const b of index.books) for (const c of b.chapters) titles.set(`${b.id}/${c.id}`, { book: b.title, chapter: c.title });
    setupView();
  } catch (e) {
    render(h("p", { class: "error" }, `Nie udało się wczytać bazy pytań: ${(e as Error).message}`));
  }
})();
