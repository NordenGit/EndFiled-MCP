/**
 * Build the endfield-tables.zip mirror asset with forward-slash entry names.
 *
 * PowerShell's Compress-Archive uses backslashes in zip entry names, which
 * violates the ZIP spec and breaks AdmZip lookups downstream. This script
 * uses AdmZip directly so entry names are spec-compliant forward slashes.
 *
 * Usage:
 *   bun run ts/scripts/build-mirror-zip.ts <staged_dir> <output_zip>
 *
 * The staged dir must already be laid out per datasets.ts (tables/ + i18n/).
 */

import AdmZip from "adm-zip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const stagedDir = process.argv[2];
const outZip = process.argv[3];

if (!stagedDir || !outZip) {
  console.error(
    "Usage: bun run build-mirror-zip.ts <staged_dir> <output_zip>",
  );
  process.exit(2);
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
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
  visit(root);
  return out;
}

const files = walkFiles(stagedDir).sort();
console.log(`Staging ${files.length} files from ${stagedDir}`);

const zip = new AdmZip();
for (const full of files) {
  // Always forward-slash — required by ZIP spec, expected by AdmZip lookups.
  const entryName = relative(stagedDir, full).replace(/\\/g, "/");
  const data = readFileSync(full);
  zip.addFile(entryName, data);
  console.log(`  + ${entryName} (${data.length} bytes)`);
}

zip.writeZip(outZip);
console.log(`\nWrote ${outZip}`);

// Verify entry names are forward-slash.
const verify = new AdmZip(outZip);
const badEntries = verify
  .getEntries()
  .filter((e) => !e.isDirectory && e.entryName.includes("\\"));
if (badEntries.length > 0) {
  console.error(
    `ERROR: ${badEntries.length} entries still use backslashes:`,
  );
  for (const e of badEntries.slice(0, 5)) {
    console.error(`  ${e.entryName}`);
  }
  process.exit(1);
}
console.log("✓ All entry names use forward slashes (ZIP-spec compliant).");
