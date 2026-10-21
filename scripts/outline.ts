import { loadNotes, splitNotes, config } from "./split-notes.ts";

const books = splitNotes(loadNotes());
for (const b of books) {
  console.log(`BOOK ${b.id}  "${b.title}"`);
  for (const c of b.chapters) {
    const target = Math.round((c.words / 1000) * config.questionsPer1000Words);
    console.log(`  CHAPTER ${c.id}  "${c.title}"  words=${c.words}  target≈${target}  hash=${c.hash}`);
  }
}
if (process.argv.includes("--dump")) {
  const [bookId, chapterId] = (process.argv[process.argv.indexOf("--dump") + 1] ?? "").split("/");
  const c = books.find((b) => b.id === bookId)?.chapters.find((c) => c.id === chapterId);
  if (c) console.log("\n" + c.text);
  else console.error("chapter not found");
}
