/**
 * Endfield wiki client tests (mocked fetch).
 *
 * Two critical things to verify without hitting the network:
 *   1. Every request carries the WAF-bypass headers (browser UA + Referer
 *      + Accept: application/json). If these regress, every real call
 *      starts returning the wiki.gg "Blocked" stub.
 *   2. The MediaWiki response shapes parse correctly into our typed
 *      result objects.
 *
 * `bindWikiConfig` is stubbed to a fixed config so the client doesn't
 * depend on env at test time. The global `fetch` is replaced per-test.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  bindWikiConfig,
  searchWiki,
  readPage,
  listSections,
  getCategories,
  getLinks,
} from "../src/api/endfieldWiki.js";

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
}

let captured: CapturedRequest[];
let originalFetch: typeof globalThis.fetch;

const STUB_CONFIG = {
  wikiEndpoint: "https://stub.example/api.php",
  wikiReferer: "https://stub.example/",
  wikiUserAgent: "StubTestBrowser/1.0",
};

/**
 * Stub fetch. The wiki client calls `fetch(urlString, { headers, signal })`,
 * so headers arrive on the second argument (the init object), not on a
 * Request wrapper. We accept both shapes to be robust.
 */
function mockFetchJson(responseJson: unknown): typeof globalThis.fetch {
  return mock(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string" ? input : input.toString();
      const headers: Record<string, string> = {};

      // Prefer init.headers (the path the wiki client actually takes).
      const rawHeaders =
        init?.headers ??
        ((input as Request)?.headers as Headers | undefined);
      if (rawHeaders) {
        if (rawHeaders instanceof Headers) {
          rawHeaders.forEach((v: string, k: string) => {
            headers[k.toLowerCase()] = v;
          });
        } else if (Array.isArray(rawHeaders)) {
          for (const [k, v] of rawHeaders) {
            headers[k.toLowerCase()] = v;
          }
        } else if (typeof rawHeaders === "object") {
          for (const [k, v] of Object.entries(rawHeaders)) {
            headers[k.toLowerCase()] = String(v);
          }
        }
      }

      captured.push({ url, headers });
      return new Response(JSON.stringify(responseJson), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  ) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  captured = [];
  originalFetch = globalThis.fetch;
  // Rate limiter state is module-local; sleep through it by making the
  // mock resolve instantly. setTimeout still runs but with a tiny interval.
  bindWikiConfig(STUB_CONFIG);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("wiki client WAF headers", () => {
  it("searchWiki sends browser UA + Referer + Accept", async () => {
    globalThis.fetch = mockFetchJson({
      query: { searchinfo: { totalhits: 0 }, search: [] },
    });
    await searchWiki("Endfield");
    expect(captured.length).toBe(1);
    const h = captured[0]!.headers;
    expect(h["user-agent"]).toBe(STUB_CONFIG.wikiUserAgent);
    expect(h["referer"]).toBe(STUB_CONFIG.wikiReferer);
    expect(h["accept"]).toBe("application/json");
  });

  it("readPage targets the configured endpoint URL", async () => {
    globalThis.fetch = mockFetchJson({
      parse: { text: { "*": "<p>hello</p>" } },
    });
    await readPage("Endfield");
    expect(captured[0]!.url).toContain("https://stub.example/api.php");
  });
});

describe("searchWiki parsing", () => {
  it("returns totalHits and shaped results", async () => {
    globalThis.fetch = mockFetchJson({
      query: {
        searchinfo: { totalhits: 42 },
        search: [
          { title: "Endfield", snippet: "<i>Endfield</i> is a game" },
          { title: "Template:Nav", snippet: "tech page" },
        ],
      },
    });
    const r = await searchWiki("endfield", 5, "text", true);
    expect(r.totalHits).toBe(42);
    // Template: filtered out by filterTechnical
    expect(r.results.map((x) => x.title)).toEqual(["Endfield"]);
  });

  it("respects the limit cap", async () => {
    globalThis.fetch = mockFetchJson({
      query: {
        searchinfo: { totalhits: 3 },
        search: [
          { title: "A", snippet: "" },
          { title: "B", snippet: "" },
          { title: "C", snippet: "" },
        ],
      },
    });
    const r = await searchWiki("x", 2, "text", false);
    expect(r.results.length).toBe(2);
  });
});

describe("readPage parsing", () => {
  it("strips HTML and returns plain text", async () => {
    globalThis.fetch = mockFetchJson({
      parse: { text: { "*": "<p>Hello <b>Endfield</b> &amp; welcome</p>" } },
    });
    const text = await readPage("Endfield");
    expect(text).toContain("Hello Endfield & welcome");
    expect(text.includes("<")).toBe(false);
  });

  it("returns a not-found message on API error", async () => {
    globalThis.fetch = mockFetchJson({
      error: { info: "Page missing" },
    });
    const text = await readPage("Nonexistent");
    expect(text).toContain("not found");
  });
});

describe("listSections parsing", () => {
  it("returns shaped section entries", async () => {
    globalThis.fetch = mockFetchJson({
      parse: {
        sections: [
          { index: "1", level: "2", line: "Overview", fromtitle: "Endfield" },
          { index: "2", level: "2", line: "Gameplay", fromtitle: "Endfield" },
        ],
      },
    });
    const s = await listSections("Endfield");
    expect(s.length).toBe(2);
    expect(s[0]).toEqual({
      index: "1",
      level: "2",
      line: "Overview",
      fromTitle: "Endfield",
    });
  });

  it("throws on API error", async () => {
    globalThis.fetch = mockFetchJson({ error: { info: "missing" } });
    expect(listSections("Nope")).rejects.toThrow(/not found/);
  });
});

describe("getCategories parsing", () => {
  it("returns category name list", async () => {
    globalThis.fetch = mockFetchJson({
      parse: { categories: [{ "*": "Characters" }, { "*": "Endfield" }] },
    });
    const cats = await getCategories("Endfield");
    expect(cats).toEqual(["Characters", "Endfield"]);
  });
});

describe("getLinks parsing", () => {
  it("outbound: returns page links with truncation flag", async () => {
    globalThis.fetch = mockFetchJson({
      parse: {
        links: [{ "*": "A" }, { "*": "B" }, { "*": "C" }],
      },
    });
    const r = await getLinks("X", "outbound", 2);
    expect(r.links).toEqual(["A", "B"]);
    expect(r.hasMore).toBe(true);
    expect(r.total).toBe(3);
  });

  it("inbound: uses backlinks query shape", async () => {
    globalThis.fetch = mockFetchJson({
      query: {
        backlinks: [{ title: "Ref1" }, { title: "Ref2" }],
      },
    });
    const r = await getLinks("X", "inbound", 30);
    expect(r.links).toEqual(["Ref1", "Ref2"]);
    expect(r.hasMore).toBe(false);
  });

  it("inbound: hasMore is true when continue is present", async () => {
    globalThis.fetch = mockFetchJson({
      continue: { blcontinue: "x" },
      query: { backlinks: [{ title: "Ref1" }] },
    });
    const r = await getLinks("X", "inbound", 30);
    expect(r.hasMore).toBe(true);
  });
});
