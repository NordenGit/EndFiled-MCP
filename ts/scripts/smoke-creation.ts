/**
 * Live smoke test for v0.3.0 creation-oriented tools.
 *
 * Verifies the three tool families that matter for fan creation:
 *   1. Character archives (profile text)
 *   2. Character voices (voice lines)
 *   3. Story scenes (dialogue text)
 *
 * Character data uses the bundled tables snapshot (ts/data/endfield/).
 * Story data syncs from the v0.3.0 mirror Release on first run.
 *
 * Run: bun run ts/scripts/smoke-creation.ts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DirectoryStore, FallbackStore } from "../src/data/stores.js";
import { bindTextStore } from "../src/data/texts.js";
import {
  bindCharacterStore,
  clearCharacterCaches,
} from "../src/data/characters.js";
import {
  getCharacterArchives,
  getCharacterVoices,
} from "../src/data/characterProfiles.js";
import { bindStoryStore, clearStoryCaches, listStoryChapters, listStories, readStory, searchStories } from "../src/data/story.js";
import { archiveSpecForDataset, STORY_CN } from "../src/data/datasets.js";
import { syncReleaseArchive } from "../src/data/sync.js";

const _tsRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bundledPath = join(_tsRoot, "data", "endfield");

// ----- Character data (bundled) -----
console.log("=== binding character store (bundled) ===");
const tmpEmpty = mkdtempSync(join(tmpdir(), "ef-empty-"));
const charStore = new FallbackStore(
  new DirectoryStore(tmpEmpty),
  new DirectoryStore(bundledPath),
);
bindTextStore(charStore);
bindCharacterStore(charStore);
clearCharacterCaches();

console.log("\n=== getCharacterArchives('管理员') ===");
const archives = getCharacterArchives("chr_0002_endminm", "CN");
if (archives === null) {
  console.error("FAILED: no archives");
} else {
  console.log(`${archives.length} sections:`);
  for (const a of archives) {
    console.log(`\n  [${a.recordId}] ${a.title}`);
    console.log(`  ${a.text.slice(0, 100)}${a.text.length > 100 ? "..." : ""}`);
  }
}

console.log("\n=== getCharacterVoices('陈千语') ===");
const voices = getCharacterVoices("陈千语", "CN");
if (voices === null) {
  console.error("FAILED: no voices");
} else {
  console.log(`${voices.length} voice lines (first 5):`);
  for (const v of voices.slice(0, 5)) {
    console.log(`  [${v.index}] ${v.title}: ${v.text.slice(0, 60)}`);
  }
}

// ----- Story data (sync from mirror) -----
console.log("\n=== syncing story data from mirror ===");
const storyRoot = mkdtempSync(join(tmpdir(), "ef-story-"));
const storyZip = join(storyRoot, "archives", STORY_CN.assetName);
const spec = archiveSpecForDataset(STORY_CN, storyZip, storyRoot);
const syncResult = await syncReleaseArchive(spec);
console.log(`sync status: ${syncResult.status}, tag: ${syncResult.commitSha}`);

if (syncResult.status === "no_data") {
  console.error("FAILED: story sync returned no_data");
  rmSync(tmpEmpty, { recursive: true, force: true });
  rmSync(storyRoot, { recursive: true, force: true });
  process.exit(1);
}

console.log("\n=== binding story store ===");
const storyStore = new DirectoryStore(storyRoot);
bindStoryStore(storyStore);
clearStoryCaches();

console.log("\n=== listStoryChapters() (first 10) ===");
const chapters = listStoryChapters();
console.log(`${chapters.length} chapters total, first 10:`);
for (const c of chapters.slice(0, 10)) {
  console.log(`  ${c.chapterId}: ${c.displayName} (${c.entryCount} scenes)`);
}

console.log("\n=== listStories('e1') (first 5) ===");
const e1Stories = listStories("e1");
console.log(`${e1Stories.length} scenes in e1, first 5:`);
for (const s of e1Stories.slice(0, 5)) {
  console.log(`  ${s.key} | ${s.mission} s${s.scene} | ${s.lineCount} lines | ${s.preview.slice(0, 50)}`);
}

console.log("\n=== readStory(first e1 scene) ===");
if (e1Stories.length > 0) {
  const scene = readStory(e1Stories[0]!.key);
  if (scene) {
    console.log(`mission: ${scene.missionName}, scene: ${scene.scene}, ${scene.lines.length} lines (first 8):`);
    for (const line of scene.lines.slice(0, 8)) {
      if (line.type === "dialog") {
        console.log(`  ${line.role}：${line.text.slice(0, 60)}`);
      } else {
        console.log(`  *${line.text.slice(0, 60)}*`);
      }
    }
  }
}

console.log("\n=== searchStories('源石') (first 5) ===");
const hits = searchStories("源石", 5);
console.log(`${hits.length} matches (showing all):`);
for (const h of hits) {
  console.log(`  ${h.key} | ${h.entry.mission} | ${h.snippet.slice(0, 70)}`);
}

console.log("\n✓ v0.3.0 creation tools smoke test complete.");
rmSync(tmpEmpty, { recursive: true, force: true });
rmSync(storyRoot, { recursive: true, force: true });
