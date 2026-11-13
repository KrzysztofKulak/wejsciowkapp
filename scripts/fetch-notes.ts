/**
 * Downloads a public, published Notion page (no auth) and writes it as
 * Markdown to source/notes.md. Uses the unofficial `notion-client`.
 */
import { NotionAPI } from "notion-client";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

type Decoration = [string, any[]?];
type RichText = Decoration[];
type Block = {
  id: string;
  type: string;
  properties?: Record<string, any>;
  content?: string[];
  format?: Record<string, any>;
  parent_table?: string;
};
type RecordMap = { block: Record<string, { value?: any }> };

/** Notion sometimes wraps block values twice: { value: { value: Block } }. */
function blk(rm: RecordMap, id: string): Block | undefined {
  const v = rm.block[id]?.value;
  if (!v) return undefined;
  return (v.value && typeof v.value === "object" && v.value.type ? v.value : v) as Block;
}

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(resolve(root, "quiz.config.json"), "utf8"));
type Source = { url?: string; pdf?: string; title?: string; id?: string; chapter?: string; chapterLevel?: number };
/** `sources` entries are URLs or { url, title?, id? }. `title` replaces the page title (used as the
 *  fallback book title) and `id` names the output file; both are needed when two pages share a title. */
const sources: Source[] = (config.sources ?? (config.notionUrl ? [config.notionUrl] : [])).map((x: string | Source) => (typeof x === "string" ? { url: x } : x));
if (!sources.length) {
  console.error("quiz.config.json: `sources` is empty");
  process.exit(1);
}

function pageIdFromUrl(url: string): string {
  const m = url.replace(/-/g, "").match(/([0-9a-f]{32})(?:[?#].*)?$/i);
  if (!m) throw new Error(`Could not find a 32-hex page id in ${url}`);
  return m[1];
}

function slugify(s: string): string {
  const map: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };
  return s.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => map[c]).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const api = new NotionAPI();
const visitedPages = new Set<string>();
let out: string[] = [];
let headings = 0;

function richText(rt?: RichText): string {
  if (!rt) return "";
  const text = rt
    .map(([text, decos]) => {
      if (text === "⁍") return ""; // inline equation placeholder
      if (text === "‣") return ""; // mention placeholder
      let t = text;
      for (const d of decos ?? []) {
        if (d[0] === "b") t = `**${t}**`;
        else if (d[0] === "i") t = `*${t}*`;
        else if (d[0] === "c") t = `\`${t}\``;
        else if (d[0] === "a") t = `[${t}](${d[1]})`;
      }
      return t;
    })
    .join("");
  if (text.trim()) return text;
  // A line that is only a date mention (a day heading like "@4 października" in day-by-day notes) becomes "4.10.2026".
  // Dates next to other text stay dropped, so existing headings (and the chapter ids derived from them) don't change.
  const date = rt.flatMap(([, decos]) => decos ?? []).find((d) => d[0] === "d")?.[1]?.start_date;
  const m = typeof date === "string" && date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[3]}.${m[2]}.${m[1]}` : text;
}

function title(b: Block): string {
  return richText(b.properties?.title);
}

/** Heading text on one line: Notion allows soft line breaks inside headings. */
function headingTitle(b: Block): string {
  return title(b).replace(/\s*\n\s*/g, " – ").replace(/\s{2,}/g, " ").trim();
}

async function renderPage(id: string, depth: number, asHeading: boolean) {
  const norm = id.replace(/-/g, "");
  if (visitedPages.has(norm)) return;
  visitedPages.add(norm);
  const rm = (await api.getPage(id)) as unknown as RecordMap;
  const page = blk(rm, id) ?? blk(rm, withDashes(norm));
  if (!page) {
    console.error(`Page ${id} not found in record map`);
    return;
  }
  if (asHeading) {
    const h = "#".repeat(Math.min(depth, 6));
    out.push(`${h} ${title(page)}`, "");
    headings++;
  } else {
    out.push(`# ${title(page)}`, "");
    headings++;
  }
  await renderChildren(rm, page, 0, depth);
}

/** Saves an image block to source/img/<blockId>.<ext>; returns the path relative to source/, or null. */
async function downloadImage(rm: RecordMap, b: Block): Promise<string | null> {
  const raw = b.properties?.source?.[0]?.[0] ?? b.format?.display_source;
  const url: string | undefined = (rm as any).signed_urls?.[b.id] ?? (typeof raw === "string" && raw.startsWith("http") ? raw : undefined);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = resolve(root, "source/img");
    mkdirSync(dir, { recursive: true });
    // iPhone photos arrive as HEIC even when labelled .jpg: detect by the "ftyp" box, convert with macOS `sips`
    if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
      const heic = resolve(dir, `${b.id}.heic`);
      writeFileSync(heic, buf);
      try {
        execFileSync("sips", ["-s", "format", "png", heic, "--out", resolve(dir, `${b.id}.png`)], { stdio: "ignore" });
        imagesSaved++;
        return `img/${b.id}.png`;
      } catch {
        imagesSaved++;
        return `img/${b.id}.heic`; // no sips (not macOS): keep the original
      }
    }
    const ext = type.includes("png") ? "png" : type.includes("gif") ? "gif" : type.includes("webp") ? "webp" : type.includes("svg") ? "svg" : "jpg";
    const name = `${b.id}.${ext}`;
    writeFileSync(resolve(dir, name), buf);
    imagesSaved++;
    return `img/${name}`;
  } catch (e) {
    console.warn(`image ${b.id}: ${(e as Error).message}`);
    return null;
  }
}
let imagesSaved = 0;

function withDashes(h: string) {
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function renderChildren(rm: RecordMap, b: Block, indent: number, pageDepth: number, numbered = { n: 0 }) {
  let n = 0;
  for (const cid of b.content ?? []) {
    const child = blk(rm, cid);
    if (!child) continue;
    if (child.type === "numbered_list") n++;
    else n = 0;
    await renderBlock(rm, child, indent, pageDepth, n);
  }
}

async function renderBlock(rm: RecordMap, b: Block, indent: number, pageDepth: number, num: number) {
  const pad = "  ".repeat(indent);
  const t = title(b);
  switch (b.type) {
    case "page": {
      // child page: recurse, inline under its title as a heading
      await renderPage(b.id, pageDepth + 1, true);
      return;
    }
    case "header":
      var HDEPTH = 1;
      out.push(`${pad}${"#".repeat(pageDepth + 1)} ${headingTitle(b)}`, "");
      headings++;
      await renderChildren(rm, b, indent, pageDepth + HDEPTH); // toggleable headings hold their section
      return;
    case "header_4":
      var HDEPTH = 4;
      out.push(`${pad}${"#".repeat(pageDepth + 4)} ${headingTitle(b)}`, "");
      headings++;
      await renderChildren(rm, b, indent, pageDepth + HDEPTH); // toggleable headings hold their section
      return;
    case "sub_header":
      var HDEPTH = 2;
      out.push(`${pad}${"#".repeat(pageDepth + 2)} ${headingTitle(b)}`, "");
      headings++;
      await renderChildren(rm, b, indent, pageDepth + HDEPTH); // toggleable headings hold their section
      return;
    case "sub_sub_header":
      var HDEPTH = 3;
      out.push(`${pad}${"#".repeat(pageDepth + 3)} ${headingTitle(b)}`, "");
      headings++;
      await renderChildren(rm, b, indent, pageDepth + HDEPTH); // toggleable headings hold their section
      return;
    case "text":
      if (t.trim()) out.push(`${pad}${t}`, "");
      else if (!b.content?.length) out.push("");
      await renderChildren(rm, b, indent + 1, pageDepth);
      return;
    case "bulleted_list":
      out.push(`${pad}- ${t}`);
      await renderChildren(rm, b, indent + 1, pageDepth);
      return;
    case "numbered_list":
      out.push(`${pad}${num}. ${t}`);
      await renderChildren(rm, b, indent + 1, pageDepth);
      return;
    case "to_do": {
      const checked = b.properties?.checked?.[0]?.[0] === "Yes";
      out.push(`${pad}- [${checked ? "x" : " "}] ${t}`);
      await renderChildren(rm, b, indent + 1, pageDepth);
      return;
    }
    case "quote":
      out.push(`${pad}> ${t}`, "");
      await renderChildren(rm, b, indent + 1, pageDepth);
      return;
    case "callout":
      out.push(`${pad}> ${t}`, "");
      await renderChildren(rm, b, indent + 1, pageDepth);
      return;
    case "code": {
      const lang = b.properties?.language?.[0]?.[0] ?? "";
      out.push(`${pad}\`\`\`${String(lang).toLowerCase()}`, t, `${pad}\`\`\``, "");
      return;
    }
    case "toggle":
      out.push(`${pad}- ${t}`);
      await renderChildren(rm, b, indent + 1, pageDepth);
      return;
    case "divider":
      out.push(`${pad}---`, "");
      return;
    case "image": {
      const cap = richText(b.properties?.caption);
      out.push(`${pad}[image: ${cap}]`);
      // Download the picture so questions can cover what the text refers to on it. The path goes into an
      // HTML comment, which split-notes leaves out of the chapter hash (so existing hashes do not change).
      const file = await downloadImage(rm, b);
      if (file) out.push(`${pad}<!-- img: ${file} -->`);
      out.push("");
      return;
    }
    case "table": {
      const rows = (b.content ?? []).map((id) => blk(rm, id)).filter(Boolean) as Block[];
      const order: string[] = b.format?.table_block_column_order ?? [];
      const cells = rows.map((r) => order.map((c) => richText(r.properties?.[c]).replace(/\|/g, "\\|").replace(/\n/g, " ")));
      if (cells.length) {
        out.push(`${pad}| ${cells[0].join(" | ")} |`);
        out.push(`${pad}| ${order.map(() => "---").join(" | ")} |`);
        for (const r of cells.slice(1)) out.push(`${pad}| ${r.join(" | ")} |`);
        out.push("");
      }
      return;
    }
    case "column_list":
    case "column":
    case "transclusion_container":
    case "transclusion_reference":
      await renderChildren(rm, b, indent, pageDepth);
      return;
    case "table_of_contents":
    case "breadcrumb":
    case "bookmark":
    case "embed":
    case "video":
    case "file":
    case "pdf":
    case "audio":
    case "equation":
    case "collection_view":
    case "collection_view_page":
      return;
    default:
      if (t.trim()) out.push(`${pad}${t}`, "");
      await renderChildren(rm, b, indent + 1, pageDepth);
  }
}

mkdirSync(resolve(root, "source"), { recursive: true });
/**
 * PDF source (e.g. lecture slides; Google Slides links are exported to PDF first): text via `pdftotext -layout` (poppler). Written as one chapter:
 * "# <title>" (page title) + "## <chapter>" so the normal splitter picks it up.
 * These files are git-ignored (source/prezentacja-*.md): the repo is public and slides are third-party material.
 */
function renderPdf(src: Source): string {
  if (!existsSync(src.pdf!)) throw new Error(`PDF not found: ${src.pdf}`);
  const text = execFileSync("pdftotext", ["-layout", src.pdf!, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .replace(/\f/g, "\n\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, "").replace(/^(\s*)#/, "$1\\#"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `# ${src.title}\n\n## ${src.chapter ?? "slajdy"}\n\n${text}\n`;
}

/** Google Slides shared "anyone with the link": download the deck as PDF (no auth) to a temp file. */
async function downloadSlides(url: string): Promise<string> {
  const id = url.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/)![1];
  const res = await fetch(`https://docs.google.com/presentation/d/${id}/export/pdf`);
  if (!res.ok || !res.headers.get("content-type")?.includes("pdf")) {
    throw new Error(`Could not export Google Slides ${id} as PDF (HTTP ${res.status}); is the deck shared as "anyone with the link"?`);
  }
  const path = join(tmpdir(), `slides-${id}.pdf`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

for (const src of sources) {
  const slides = src.url && /docs\.google\.com\/presentation\//.test(src.url);
  if (src.pdf || slides) {
    if (!src.id || !src.title) throw new Error("PDF and Google Slides sources need `id` and `title`");
    const md = renderPdf(slides ? { ...src, pdf: await downloadSlides(src.url!) } : src);
    const dest = resolve(root, `source/${src.id}.md`);
    writeFileSync(dest, md);
    console.log(`Wrote ${dest} (from PDF): ${md.split(/\s+/).filter(Boolean).length} words`);
    continue;
  }
  const pageId = pageIdFromUrl(src.url!);
  out = [];
  headings = 0;
  visitedPages.clear();
  await renderPage(withDashes(pageId), 0, false);
  if (src.title) out[0] = `# ${src.title}`;
  // Pages whose topics are not numbered ("Układ nerwowy" instead of "Wykład 3"): tell the splitter that
  // every heading at this level is a chapter.
  if (src.chapterLevel) out.splice(1, 0, "", `<!-- chapters: h${src.chapterLevel} -->`);
  const md = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const title = md.split("\n")[0].replace(/^#\s*/, "");
  const dest = resolve(root, `source/${src.id ?? slugify(title) ?? pageId}.md`);
  writeFileSync(dest, md);
  const words = md.split(/\s+/).filter(Boolean).length;
  console.log(`Wrote ${dest}: ${headings} headings, ${words} words, ${imagesSaved} image(s)`);
  imagesSaved = 0;
}
