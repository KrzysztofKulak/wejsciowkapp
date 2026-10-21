/**
 * Downloads a public, published Notion page (no auth) and writes it as
 * Markdown to source/notes.md. Uses the unofficial `notion-client`.
 */
import { NotionAPI } from "notion-client";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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
const urls: string[] = config.sources ?? (config.notionUrl ? [config.notionUrl] : []);
if (!urls.length) {
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
  return rt
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
}

function title(b: Block): string {
  return richText(b.properties?.title);
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
      out.push(`${pad}${"#".repeat(pageDepth + 1)} ${t}`, "");
      headings++;
      await renderChildren(rm, b, indent, pageDepth + HDEPTH); // toggleable headings hold their section
      return;
    case "header_4":
      var HDEPTH = 4;
      out.push(`${pad}${"#".repeat(pageDepth + 4)} ${t}`, "");
      headings++;
      await renderChildren(rm, b, indent, pageDepth + HDEPTH); // toggleable headings hold their section
      return;
    case "sub_header":
      var HDEPTH = 2;
      out.push(`${pad}${"#".repeat(pageDepth + 2)} ${t}`, "");
      headings++;
      await renderChildren(rm, b, indent, pageDepth + HDEPTH); // toggleable headings hold their section
      return;
    case "sub_sub_header":
      var HDEPTH = 3;
      out.push(`${pad}${"#".repeat(pageDepth + 3)} ${t}`, "");
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
      out.push(`${pad}[image: ${cap}]`, "");
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
for (const url of urls) {
  const pageId = pageIdFromUrl(url);
  out = [];
  headings = 0;
  visitedPages.clear();
  await renderPage(withDashes(pageId), 0, false);
  const md = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const title = md.split("\n")[0].replace(/^#\s*/, "");
  const dest = resolve(root, `source/${slugify(title) || pageId}.md`);
  writeFileSync(dest, md);
  const words = md.split(/\s+/).filter(Boolean).length;
  console.log(`Wrote ${dest}: ${headings} headings, ${words} words`);
}
