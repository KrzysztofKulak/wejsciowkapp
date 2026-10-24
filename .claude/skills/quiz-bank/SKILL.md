---
name: quiz-bank
description: Generate or update the A–D quiz question bank (app/public/data) from the user's published Notion notes and their example questions, chapter by chapter. Use when the user asks to generate, update, or regenerate quiz questions, or runs /quiz-bank.
---

# quiz-bank

Builds the A–D quiz question bank from published Notion notes, calibrated on the user's own example questions. Read `quiz.config.json` and SPEC.md §2.4 (schema) first. Never use Notion MCP or the Notion API.

## Modes
- `outline`: fetch and split only. Print books → chapters with word counts. Write no questions.
- `style`: (re)build `examples/STYLE.md` from the examples.
- `chapter <bookId>/<chapterId>`: generate one chapter.
- `update` (default): regenerate only chapters whose notes changed. Compare a sha1 of the chapter text with `sourceHash` in the existing file.
- `all`: regenerate everything. Ask for confirmation first.

## Step 1: Get the notes
1. Run `npm run fetch-notes`. It downloads every public link in `sources` (quiz.config.json) to `source/<page-title-slug>.md`, one file per page. If `sources` is empty, ask the user for the published link(s). To add a page, append its URL to `sources` and re-run.
2. If the script fails, try WebFetch on the link.
3. If that also returns too little, ask the user to export the page as Markdown into `source/`.
4. Split into books/chapters with `npm run outline` (uses `chapterPattern`; see Project notes).
5. Make ids from slugified titles: lowercase ASCII, strip Polish diacritics. Never use positions.

## Step 2: Example questions (required)
1. Read everything in `examples/`. If it's empty, **stop and ask the user to paste example questions** from the same classes. Explain that they set the difficulty and style. Don't generate anything without them.
2. If `examples/STYLE.md` doesn't exist, or the examples changed, write it. Cover:
   - typical stem length and phrasing
   - level of detail (dates, numbers, names, exact definitions?)
   - mix of question types (definition, fact recall, application, comparison, "which is NOT…")
   - what the wrong answers typically look like
   - 3 representative examples quoted from the user's files
3. Show STYLE.md to the user and get approval once.
4. For each chapter, use STYLE.md plus the 5–10 examples most relevant to that book/chapter.
5. **Never copy examples. Never test facts that are absent from the notes.**

## Step 3: Write questions (per chapter)
Aim for about `questionsPer1000Words` questions per 1000 words, spread across the whole chapter. Match STYLE.md in difficulty and detail. Write in the notes' language. For each question:
- `stems`: 1–3 phrasings with the same meaning.
- `correct`: 2–4 phrasings of exactly the same answer. They must not be broader, narrower, or partial versions of each other. Use 1 phrasing only if the answer is a bare name/number/term.
- `distractors`: 6–12 options that are plausible to someone who half-knows the material, e.g. near-miss numbers, swapped terms, concepts from neighbouring chapters, common misconceptions. Each must be unambiguously false according to the notes.
- No "all/none of the above", no combined options, no joke options.
- Similar length and grammatical form across correct and wrong options. No length tells.
- Any 1 correct + any 3 distractors must make a valid question with exactly one right answer.
- Also fill `explanation`, `sourceExcerpt` (short, from the notes), `difficulty` 1–3, `status: "ok"`.

## Step 4: Self-review (separate pass, be strict)
Re-read each question against the notes and STYLE.md as a sceptical examiner:
- Drop any distractor that could be argued true.
- Drop any correct phrasing that isn't fully equivalent.
- Drop any option with a length or form tell.
- Fix or drop questions clearly easier or harder than the examples.
- If fewer than 3 distractors or 0 correct phrasings remain, fix the question or set `status: "flagged"`.

## Step 5: Write + check
1. Write `app/public/data/bank/<bookId>/<chapterId>.json` with `sourceHash`, then run `npm run build-index` to regenerate `app/public/data/index.json`.
2. Run `npm run check-bank` and fix any errors.
3. Report per chapter: number of questions created and flagged, plus 2 sample questions rendered as A–D.
4. Ask before `git commit && git push`.

## Project notes (learned on first run, 2026-10-21)
- The published page is **one Notion page** where each `# Rozdział N` is a *toggleable heading* holding the chapter's blocks as children. `fetch-notes` renders those children one heading level deeper, so sub-sections inside a chapter come out as `##`/`###`.
- Splitting (`scripts/split-notes.ts`, `splitAll`): every source file is split separately and books with the same id are merged. Any heading h1–h4 matching `chapterPattern` starts a chapter. The pattern has two groups: an optional book prefix and the chapter title, so both layouts work:
  - page 1 (psychologia społeczna): `# “Psychologia Społeczna” Grzyb, Wojciszke` (h1 → book), then `# Rozdział 5` (toggle h1 → chapter);
  - page 2 (historia i współczesność): `## “Psychologia i życie”, Zimbardo. Rozdział 1` (one h2 → book *and* chapter).
  A suffix after the chapter number (e.g. `Rozdział 1, str. 12-19` or `Rozdział 3 – podrozdział 3.2`) is kept in the chapter *title* (shown in the app, so the user sees that only part of the chapter is covered) but not in the id, which stays `rozdzial-1`. `build-index` takes titles from the outline, so renaming a heading in Notion updates the app after `fetch-notes` + `build-index`; set `chapterTitle` in the bank file to the same full title. Any other h1 is a book heading. The first heading of each file (page title) is skipped. Headings that don't match (e.g. `## Ocenianie ludzi` inside Rozdział 5) are plain chapter text.
- `npm run outline` prints books → chapters with word counts, target question counts and the full `sourceHash`. `npm run outline -- --dump <bookId>/<chapterId>` prints one chapter's text. Use these instead of splitting by hand.
- The first bank (rozdzial-5) was written at roughly 25 questions per 1000 words because the notes are dense and the chapter is short; keep new chapters in the same range so the bank stays useful, not at the literal `questionsPer1000Words` default.
- The user's 5 real exam questions (see `examples/`) are also stored in the bank as questions 01–05 of psychologia-spoleczna-grzyb-wojciszke/rozdzial-5, with extra stem/answer phrasings. Keep them when regenerating that chapter. They are the only examples so far, so STYLE.md applies to every book (including Zimbardo and Tavris) until the user adds examples from those classes.
- `npm run check-bank` also warns about *length tells* (correct options on average >1.6× or <0.6× the distractor length). Fix warnings, not only errors.
- **The notes are the only source of truth for facts, but the question text must not mention them.** Every stem, correct answer, distractor and explanation is grounded in `source/notes.md` (`sourceExcerpt` proves it). Still, never write „według notatek” / „zgodnie z notatkami” or any similar phrase in a stem or option: the exam doesn't know the notes exist, so phrase the question as a plain statement of fact. The user asked for this explicitly.
- Headings may abbreviate the chapter (`Rozdz. 13 – …`); the id is normalised to `rozdzial-13`. If a heading names the book differently from an existing one (e.g. `“Psychologia i życie Freud”` vs `“Psychologia i życie”, Zimbardo`), map the stray slug to the real book in `bookAliases` in quiz.config.json instead of creating a new book.
