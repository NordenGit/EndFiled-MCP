/**
 * Endfield Talos Wiki (endfield.wiki.gg) API client.
 *
 * Ported from PRTS-MCP's `ts/src/api/prtsWiki.ts`. Two substantive
 * differences from the PRTS client:
 *
 *   1. WAF handling — wiki.gg blocks bare/curl-like User-Agents. Every
 *      request carries a browser UA + Referer + Accept header. These are
 *      pulled from the loaded Config so they can be overridden per-deployment
 *      (EF_WIKI_UA / EF_WIKI_REFERER / EF_WIKI_ENDPOINT).
 *
 *   2. Content language — endfield.wiki.gg is primarily English. Snippets
 *      and page text come back in English by default; the calling LLM is
 *      responsible for bridging into the user's language. Tool descriptions
 *      stay Chinese (the project's user-facing language), but the strings
 *      returned by this client are whatever language the wiki page is in.
 *
 * All MediaWiki action=parse / action=query shapes are identical to PRTS,
 * so the response parsing ports verbatim.
 */

import {
  RATE_LIMIT_INTERVAL,
  type Config,
} from "../config.js";
import { stripWikitext } from "../utils/sanitizer.js";
import { parseParsetreeXml } from "./parsetreeParser.js";

// ---------------------------------------------------------------------------
// Module-local config binding
// ---------------------------------------------------------------------------

/**
 * The wiki client is bound to a Config snapshot at first use rather than
 * re-reading process.env on every call. This keeps request headers stable
 * for the process lifetime and makes the client trivially mockable in tests
 * (swap `bindWikiConfig` with a stub before importing the test subject).
 */
let bound: Config | null = null;

export function bindWikiConfig(cfg: Config): void {
  bound = cfg;
}

function cfg(): Config {
  if (bound === null) {
    throw new Error(
      "Wiki client used before bindWikiConfig() — call it once at startup."
    );
  }
  return bound;
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

// Tracks the earliest time the next request is allowed to fire.
// Updated immediately (before any await) so concurrent callers each
// reserve a distinct slot — avoiding the check-then-act race.
let nextAllowedTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const intervalMs = RATE_LIMIT_INTERVAL * 1000;
  const slot = Math.max(now, nextAllowedTime);
  nextAllowedTime = slot + intervalMs;
  const waitMs = slot - now;
  if (waitMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  }
}

// ---------------------------------------------------------------------------
// Request helper (WAF headers live here)
// ---------------------------------------------------------------------------

function defaultHeaders(): Record<string, string> {
  const c = cfg();
  return {
    "User-Agent": c.wikiUserAgent,
    "Referer": c.wikiReferer,
    "Accept": "application/json",
  };
}

async function wikiGet(
  params: Record<string, string | number>,
): Promise<unknown> {
  await rateLimit();
  const c = cfg();
  const url = new URL(c.wikiEndpoint);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: defaultHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Endfield wiki API error: HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Text cleanup helpers (ported verbatim from prtsWiki.ts)
// ---------------------------------------------------------------------------

const CSS_JS_RE =
  /@(font-face|keyframes|media|import|charset|namespace|supports|page)[^{]*\{[^}]*\}|\(window\.RLQ\s*\|\|\s*\[\]\)\.push\([^)]*\)|<style[^>]*>.*?<\/style>|<script[^>]*>.*?<\/script>/gis;

const HTML_TAG_RE = /<[^>]+>/g;

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  copy: "©", reg: "®", trade: "™",
  times: "×", divide: "÷", plusmn: "±",
  bull: "•", middot: "·", shy: "­",
};

function unescapeHTMLEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (_, name) => NAMED_ENTITIES[name] ?? `&${name};`);
}

function cleanSnippet(snippet: string): string {
  // Remove JSON key-value fragments from technical data pages
  snippet = snippet.replace(/\s*"[^"]*"\s*:\s*"[^"]*"\s*,?\s*/g, " ");
  // Remove isolated pipe-value artifacts with non-ASCII keys
  snippet = snippet.replace(/\|[\u4e00-\u9fff\w]+\s*=[^\n]*/g, "");
  snippet = snippet.replace(/#REDIRECT|#重定向/g, "");
  // Collapse whitespace
  snippet = snippet.replace(/[ \t]+/g, " ");
  snippet = snippet.replace(/,{2,}/g, "");
  snippet = snippet.replace(/\n{2,}/g, "\n");
  return snippet.replace(/^[ ,\n]+|[ ,\n]+$/g, "");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * endfield.wiki.gg doesn't host the same /spine, /data technical subpages
 * that PRTS does, but MediaWiki namespace prefixes (Template:, Widget:,
 * Module:, File:, Category: as standalone pages) are still worth filtering
 * from search results — they're editing infrastructure, not lore.
 */
const TECHNICAL_PAGE_PATTERNS = [
  "Widget:",
  "Template:",
  "Module:",
  "File:",
  "MediaWiki:",
];

function isTechnicalPage(title: string): boolean {
  return TECHNICAL_PAGE_PATTERNS.some((p) => title.startsWith(p));
}

function stripHtml(text: string): string {
  let out = text.replace(CSS_JS_RE, "");
  out = out.replace(HTML_TAG_RE, "");
  out = unescapeHTMLEntities(out);
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  snippet: string;
}

export interface SearchResponse {
  totalHits: number;
  results: SearchResult[];
}

/** Search endfield.wiki.gg. */
export async function searchWiki(
  query: string,
  limit = 5,
  searchMode: "text" | "title" = "text",
  filterTechnical = true,
): Promise<SearchResponse> {
  const fetchLimit = filterTechnical ? limit * 2 : limit;
  const params: Record<string, string | number> = {
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: fetchLimit,
    srnamespace: 0,
    srinfo: "totalhits",
    format: "json",
  };
  if (searchMode === "title") {
    params.srwhat = "title";
  }
  const data = (await wikiGet(params)) as {
    error?: { code?: string; info?: string };
    query?: {
      searchinfo?: { totalhits: number };
      search?: Array<{ title: string; snippet: string }>;
    };
  };

  // Handle API-level errors. endfield.wiki.gg disables title search
  // (`wgDisableSearchTitle` — returns `search-title-disabled`). Other
  // errors (rate limit, etc.) surface here too. We throw a Chinese
  // message so the tool layer can catch and return it as text content.
  if (data.error) {
    if (data.error.code === "search-title-disabled") {
      throw new Error(
        "endfield.wiki.gg 禁用了标题搜索（srwhat=title）。请改用默认的全文搜索模式（search_mode=\"text\" 或不传该参数）。",
      );
    }
    throw new Error(
      `Wiki 搜索 API 返回错误：${data.error.info ?? data.error.code ?? "未知错误"}`,
    );
  }

  const totalHits = data.query?.searchinfo?.totalhits ?? 0;
  const results: SearchResult[] = [];
  for (const item of data.query?.search ?? []) {
    if (filterTechnical && isTechnicalPage(item.title)) continue;
    if (results.length >= limit) break;
    let snippet = stripWikitext(item.snippet ?? "");
    snippet = unescapeHTMLEntities(snippet);
    snippet = cleanSnippet(snippet);
    results.push({ title: item.title, snippet });
  }
  return { totalHits, results };
}

/** Fetch rendered plain-text content for a wiki page. */
export async function readPage(
  title: string,
  sectionIndex?: number,
): Promise<string> {
  const params: Record<string, string | number> = {
    action: "parse",
    page: title,
    prop: "text",
    format: "json",
  };
  if (sectionIndex !== undefined) {
    params.section = sectionIndex;
  }
  const data = (await wikiGet(params)) as {
    error?: { info?: string };
    parse?: { text?: { "*": string } };
  };

  if (data.error?.info) {
    return `Page '${title}' not found or empty.`;
  }

  const htmlText = data.parse?.text?.["*"] ?? "";
  if (!htmlText) {
    return `Page '${title}' not found or empty.`;
  }

  return stripHtml(htmlText);
}

/** List section table of contents for a page. */
export async function listSections(
  title: string,
): Promise<
  Array<{ index: string; level: string; line: string; fromTitle: string }>
> {
  const data = (await wikiGet({
    action: "parse",
    page: title,
    prop: "sections",
    format: "json",
  })) as {
    error?: { info?: string };
    parse?: {
      sections?: Array<{
        index: string;
        level: string;
        line: string;
        fromtitle: string;
      }>;
    };
  };

  if (data.error?.info) {
    throw new Error(`Page '${title}' not found.`);
  }

  return (data.parse?.sections ?? []).map((s) => ({
    index: s.index ?? "",
    level: s.level ?? "",
    line: s.line ?? "",
    fromTitle: s.fromtitle ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Public API (continued)
// ---------------------------------------------------------------------------
//
// Template extraction (`getTemplateData` below) delegates parsetree XML
// parsing to `./parsetreeParser.ts` — see that module for the rationale
// (file-size guard + independently testable pure function).

/** Get category tags for a page. */
export async function getCategories(title: string): Promise<string[]> {
  const data = (await wikiGet({
    action: "parse",
    page: title,
    prop: "categories",
    format: "json",
  })) as {
    error?: { info?: string };
    parse?: { categories?: Array<{ "*": string }> };
  };

  if (data.error?.info) {
    throw new Error(`Page '${title}' not found.`);
  }

  return (data.parse?.categories ?? []).map((c) => c["*"]);
}

export interface LinksResult {
  title: string;
  links: string[];
  total: number;
  hasMore: boolean;
}

/** Get outbound links (parse prop=links) or inbound backlinks (list=backlinks). */
export async function getLinks(
  title: string,
  direction: "outbound" | "inbound" = "outbound",
  limit = 30,
): Promise<LinksResult> {
  if (direction === "outbound") {
    const data = (await wikiGet({
      action: "parse",
      page: title,
      prop: "links",
      format: "json",
    })) as {
      error?: { info?: string };
      parse?: { links?: Array<{ "*": string }> };
    };

    if (data.error?.info) {
      throw new Error(`Page '${title}' not found.`);
    }

    const allLinks = (data.parse?.links ?? []).map((l) => l["*"]);
    return {
      title,
      links: allLinks.slice(0, limit),
      total: allLinks.length,
      hasMore: allLinks.length > limit,
    };
  }

  if (direction !== "inbound") {
    throw new Error(
      `Invalid direction: ${JSON.stringify(direction)}. Use "outbound" or "inbound".`,
    );
  }

  // inbound: use list=backlinks
  const data = (await wikiGet({
    action: "query",
    list: "backlinks",
    bltitle: title,
    bllimit: Math.min(limit, 500),
    blnamespace: 0,
    format: "json",
  })) as {
    continue?: unknown;
    query?: { backlinks?: Array<{ title: string }> };
  };

  const backlinks = data.query?.backlinks ?? [];
  const links = backlinks.map((bl) => bl.title);
  return {
    title,
    links: links.slice(0, limit),
    total: links.length,
    hasMore: "continue" in data,
  };
}

/** Extract structured template data (parsetree) from a page. */
export async function getTemplateData(
  title: string,
): Promise<Record<string, Record<string, unknown>>> {
  const data = (await wikiGet({
    action: "parse",
    page: title,
    prop: "parsetree",
    format: "json",
  })) as {
    error?: { info?: string };
    parse?: { parsetree?: { "*": string } };
  };

  if (data.error?.info) {
    throw new Error(`Page '${title}' not found.`);
  }

  const xml = data.parse?.parsetree?.["*"] ?? "";
  if (!xml) {
    throw new Error(`Page '${title}' has no parsetree data.`);
  }

  return parseParsetreeXml(xml);
}
