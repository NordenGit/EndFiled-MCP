/**
 * Build the endfield-story-CN.zip mirror asset.
 *
 * One-shot script: stages the story bundle from endfield_research_kit's
 * webui/data/lang/CN/ output, then zips it with forward-slash entry names
 * (matching the ZIP spec our reader expects).
 *
 * Layout produced:
 *   index.json, missions.json, actors.json, search.json, conv/*.json
 *
 * Excludes: reference/ (per-mission detail, large, not needed for v0.3),
 *           mission/ (per-mission files, same), narrative_video_evidence.json
 *           (video provenance, not text).
 *
 * Usage:
 *   bun run ts/scripts/build-story-zip.ts <cn_data_dir> <output_zip>
 */

import AdmZip from "adm-zip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const srcDir = process.argv[2];
const outZip = process.argv[3];

if (!srcDir || !outZip) {
  console.error("Usage: build-story-zip.ts <cn_data_dir> <output_zip>");
  process.exit(2);
}

// Files to include at root level (catalog + search index).
const ROOT_FILES = ["index.json", "missions.json", "actors.json", "search.json"];

function walkFiles(root: string, subdir?: string): string[] {
  const out: string[] = [];
  const base = subdir ? join(root, subdir) : root;
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        visit(full);
      } else {
        out.push(full);
      }
    }
  };
  visit(base);
  return out;
}

const zip = new AdmZip();
let count = 0;
let totalBytes = 0;

// Root catalog files.
for (const f of ROOT_FILES) {
  const full = join(srcDir, f);
  try {
    const data = readFileSync(full);
    zip.addFile(f, data);
    count++;
    totalBytes += data.length;
    console.log(`  + ${f} (${data.length} bytes)`);
  } catch {
    console.warn(`  ! skipping ${f} (not found)`);
  }
}

// conv/ directory — all dialogue scene files.
const convFiles = walkFiles(srcDir, "conv").sort();
console.log(`\n  conv/ (${convFiles.length} files)...`);
for (const full of convFiles) {
  const entryName = relative(srcDir, full).replace(/\\/g, "/");
  const data = readFileSync(full);
  zip.addFile(entryName, data);
  count++;
  totalBytes += data.length;
}

zip.writeZip(outZip);
console.log(`\nWrote ${outZip}`);
console.log(`Files: ${count}, uncompressed: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

// Verify entry names use forward slashes.
const verify = new AdmZip(outZip);
const bad = verify.getEntries().filter((e) => !e.isDirectory && e.entryName.includes("\\"));
if (bad.length > 0) {
  console.error(`ERROR: ${bad.length} entries use backslashes`);
  process.exit(1);
}
console.log("✓ All entry names use forward slashes.");
