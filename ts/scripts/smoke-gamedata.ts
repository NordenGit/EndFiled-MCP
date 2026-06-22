/**
 * Live GameData smoke test — runs the character reader against a real
 * export laid out at $EF_DATA_PATH (matching datasets.ts conventions).
 *
 * Run (after staging tables/i18n under EF_DATA_PATH):
 *   EF_DATA_PATH=/tmp/ef-validate bun run ts/scripts/smoke-gamedata.ts
 *
 * Verifies:
 *   - CharacterTable loads and parses
 *   - i18n resolution produces real strings (not hash ids)
 *   - listCharacters / getCharacterInfo / searchCharacters all return data
 *
 * Not part of `bun test` — needs a populated EF_DATA_PATH.
 */

import { loadConfig } from "../src/config.js";
import { DirectoryStore } from "../src/data/stores.js";
import { bindTextStore, resolveText } from "../src/data/texts.js";
import {
  bindCharacterStore,
  clearCharacterCaches,
  getCharacterInfo,
  listCharacters,
  searchCharacters,
} from "../src/data/characters.js";

const cfg = loadConfig();
console.log(`EF_DATA_PATH: ${cfg.dataPath}`);

const store = new DirectoryStore(cfg.dataPath);
bindTextStore(store);
bindCharacterStore(store);

console.log("\n=== listCharacters() — first 5 ===");
const list = listCharacters("CN");
console.log(`total: ${list.length}`);
for (const c of list.slice(0, 5)) {
  console.log(
    `  ${c.id}  ${c.name}  ${c.profession}  ${c.rarity}★  ${c.charType}  ${c.department}`,
  );
}

console.log("\n=== getCharacterInfo('chr_0002_endminm') ===");
const info = getCharacterInfo("chr_0002_endminm", "CN");
if (info === null) {
  console.log("NOT FOUND");
} else {
  console.log(JSON.stringify(info, null, 2));
}

console.log("\n=== getCharacterInfo by name: '管理员' ===");
const byName = getCharacterInfo("管理员", "CN");
console.log(byName === null ? "NOT FOUND" : `${byName.id} → ${byName.name}`);

console.log("\n=== getCharacterInfo by EN name: 'Lifeng' ===");
const byEn = getCharacterInfo("Lifeng", "CN");
console.log(byEn === null ? "NOT FOUND" : `${byEn.id} → ${byEn.name}`);

console.log("\n=== searchCharacters('近卫') ===");
const hits = searchCharacters("近卫", 10, "CN");
console.log(`${hits.length} matches:`);
for (const h of hits) {
  console.log(`  ${h.id}  ${h.name}  [${h.snippet}]`);
}

console.log("\n=== searchCharacters('Physical') ===");
const hits2 = searchCharacters("Physical", 10, "CN");
console.log(`${hits2.length} matches:`);
for (const h of hits2.slice(0, 3)) {
  console.log(`  ${h.id}  ${h.name}  [${h.snippet}]`);
}

console.log("\n=== i18n cross-check: 管理员 in all 5 langs ===");
// Re-resolve the name id across languages to prove multilingual works.
clearCharacterCaches();
const endmin = getCharacterInfo("chr_0002_endminm", "CN");
if (endmin) {
  // Re-fetch raw name id via a fresh table load isn't exposed; use info.id
  // to look up again in each language by searching.
  for (const lang of ["CN", "EN", "JP", "TC", "KR"] as const) {
    const localized = getCharacterInfo(endmin.id, lang);
    console.log(`  ${lang}: ${localized?.name ?? "?"}`);
  }
}
