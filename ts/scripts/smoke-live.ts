/**
 * Live WAF-bypass smoke check.
 *
 * One-shot probe: bind the real default config and fire a single searchWiki
 * call against endfield.wiki.gg. Verifies the browser-UA + Referer header
 * combination actually clears the wiki.gg WAF and returns real JSON.
 *
 * Run: bun run ts/scripts/smoke-live.ts
 *
 * Not part of `bun test` (would hit the network on every CI run). Run by
 * hand or in a separate "live" CI job.
 */

import { loadConfig } from "../src/config.js";
import {
  bindWikiConfig,
  searchWiki,
} from "../src/api/endfieldWiki.js";

const cfg = loadConfig();
bindWikiConfig(cfg);

console.log(`Endpoint: ${cfg.wikiEndpoint}`);
console.log(`UA: ${cfg.wikiUserAgent}`);
console.log(`Referer: ${cfg.wikiReferer}`);
console.log("");

const r = await searchWiki("Endfield", 3);
console.log(`totalHits: ${r.totalHits}`);
console.log(`results (${r.results.length}):`);
for (const x of r.results) {
  const snippet = x.snippet.replace(/\n/g, " ").slice(0, 100);
  console.log(`  - ${x.title} | ${snippet}`);
}
