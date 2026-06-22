/**
 * Live mirror sync smoke test.
 *
 * Wipes a temp data directory, then runs the real syncReleaseArchive
 * pipeline against the live 3aKHP/EndFieldGameData v0.2.0 Release.
 * Verifies the full chain: API tag check → asset download → zip extract
 * → file presence. Then loads the character reader to prove the data
 * is usable.
 *
 * Run:
 *   bun run ts/scripts/smoke-sync.ts
 *
 * Not part of `bun test` — hits the network.
 */

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSpecForDataset, GAMEDATA_TABLES } from "../src/data/datasets.js";
import { syncReleaseArchive } from "../src/data/sync.js";
import { DirectoryStore } from "../src/data/stores.js";
import { bindTextStore } from "../src/data/texts.js";
import { bindCharacterStore, listCharacters } from "../src/data/characters.js";

const tmpRoot = mkdtempSync(join(tmpdir(), "ef-sync-"));
const localZip = join(tmpRoot, "archives", GAMEDATA_TABLES.assetName);

console.log(`Temp data root: ${tmpRoot}`);
console.log(`Mirror: ${GAMEDATA_TABLES.owner}/${GAMEDATA_TABLES.repo}`);
console.log(`Asset: ${GAMEDATA_TABLES.assetName}`);
console.log(`Required files: ${GAMEDATA_TABLES.requiredFiles.length}`);
console.log("");

const spec = archiveSpecForDataset(GAMEDATA_TABLES, localZip, tmpRoot);

console.log("=== running syncReleaseArchive ===");
const result = await syncReleaseArchive(spec);
console.log(`status: ${result.status}`);
console.log(`commitSha (tag): ${result.commitSha}`);
console.log(`error: ${result.error ?? "(none)"}`);
console.log("");

if (result.status === "no_data") {
  console.error("SYNC FAILED — no data available.");
  rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(1);
}

console.log("=== verify extracted files ===");
let allPresent = true;
for (const f of GAMEDATA_TABLES.requiredFiles) {
  const p = join(tmpRoot, f);
  const ok = existsSync(p);
  console.log(`  ${ok ? "✓" : "✗"} ${f}`);
  if (!ok) allPresent = false;
}
console.log("");

if (!allPresent) {
  console.error("FILES MISSING after sync.");
  rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(1);
}

console.log("=== load character reader against synced data ===");
const store = new DirectoryStore(tmpRoot);
bindTextStore(store);
bindCharacterStore(store);
const list = listCharacters("CN");
console.log(`listCharacters() returned ${list.length} characters:`);
for (const c of list.slice(0, 5)) {
  console.log(`  ${c.id}  ${c.name}  ${c.profession}  ${c.rarity}★`);
}
console.log(`  ... (${list.length} total)`);

console.log("\n=== SECOND sync (should be up_to_date, no download) ===");
const result2 = await syncReleaseArchive(spec);
console.log(`status: ${result2.status}`);
console.log(`commitSha: ${result2.commitSha}`);

console.log("\n✓ Live sync smoke test passed.");
rmSync(tmpRoot, { recursive: true, force: true });
