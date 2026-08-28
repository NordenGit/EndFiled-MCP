/**
 * Differential test for the copy-free parseInt64Safe rewrite.
 *
 * parseInt64Safe used to append one character at a time; it now scans
 * without copying and splices only around the integers it rewrites. That
 * is a pure performance change, so the only thing worth asserting is that
 * it is *exactly* equivalent — including on the inputs a hand-written case
 * list would never think of.
 *
 * The oracle below is the original character-by-character implementation,
 * kept verbatim. Randomized documents are run through both and compared.
 * If the two ever disagree, the seed in the failure message reproduces it.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectoryStore } from "../src/data/stores.js";

/** The pre-rewrite implementation, unchanged, used only as an oracle. */
function oracle(text: string): string {
  let out = "";
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i]!;

    if (ch === '"') {
      out += ch;
      i++;
      while (i < len) {
        const s = text[i]!;
        out += s;
        i++;
        if (s === "\\") {
          if (i < len) {
            out += text[i]!;
            i++;
          }
        } else if (s === '"') {
          break;
        }
      }
      continue;
    }

    if (ch === "-" || ch === "+" || (ch >= "0" && ch <= "9")) {
      let j = i - 1;
      while (j >= 0 && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) {
        j--;
      }
      const structural = j < 0 ? "{" : text[j]!;
      if (structural === ":" || structural === "," || structural === "[" || structural === "{") {
        const numStart = i;
        if (text[i] === "-" || text[i] === "+") i++;
        const digitStart = i;
        while (i < len && text[i]! >= "0" && text[i]! <= "9") i++;
        const digitCount = i - digitStart;

        if (i < len && (text[i] === "." || text[i] === "e" || text[i] === "E")) {
          out += text.substring(numStart, i);
          continue;
        }

        if (digitCount >= 15) {
          const digits = text.substring(numStart, i);
          const n = BigInt(digits);
          if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(-Number.MAX_SAFE_INTEGER)) {
            out += `"${digits}"`;
            continue;
          }
        }
        out += text.substring(numStart, i);
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/** Deterministic PRNG so a failure is reproducible from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Values chosen to sit on every boundary the scanner cares about. */
function makeValue(r: () => number, depth: number): unknown {
  const pick = r();
  if (depth < 2 && pick < 0.14) {
    const n = 1 + Math.floor(r() * 3);
    return Array.from({ length: n }, () => makeValue(r, depth + 1));
  }
  if (depth < 2 && pick < 0.28) {
    const o: Record<string, unknown> = {};
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) o[`k${Math.floor(r() * 1000)}`] = makeValue(r, depth + 1);
    return o;
  }
  if (pick < 0.42) return -7078064683023630592n.toString();
  if (pick < 0.50) return 0;
  if (pick < 0.58) return Number.MAX_SAFE_INTEGER;
  if (pick < 0.64) return -Number.MAX_SAFE_INTEGER;
  if (pick < 0.70) return 1.5e18;
  if (pick < 0.74) return -0.25;
  if (pick < 0.78) return true;
  if (pick < 0.82) return null;
  // Strings that look like the things the scanner must NOT touch.
  const traps = [
    'quote " inside',
    'backslash \ inside',
    'escaped \\" quote then 9223372036854775807',
    'digits 9223372036854775807 in text',
    ', 12345678901234567890 after comma',
    ': -9007199254740993 after colon',
    'tab\there and newline\nhere',
    '',
  ];
  return traps[Math.floor(r() * traps.length)]!;
}

/**
 * Raw JSON text with oversized integers spliced in as bare literals.
 *
 * JSON.stringify cannot emit an unquoted int64, so the big values are
 * injected textually — that is precisely the shape parseInt64Safe exists
 * to handle.
 */
function makeDocument(r: () => number): string {
  const doc: Record<string, unknown> = {};
  const n = 2 + Math.floor(r() * 5);
  for (let k = 0; k < n; k++) doc[`f${k}`] = makeValue(r, 0);
  let text = JSON.stringify(doc, null, r() < 0.5 ? 2 : 0);
  // Turn the sentinel strings back into bare int64 literals.
  text = text.replace(/"(-?\d{16,})"/g, "$1");
  return text;
}

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ef-int64-eq-"));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("parseInt64Safe — equivalence with the pre-rewrite implementation", () => {
  it("agrees with the oracle on 400 randomized documents", () => {
    const store = new DirectoryStore(tmpRoot);
    for (let seed = 1; seed <= 400; seed++) {
      const text = makeDocument(rng(seed));
      writeFileSync(join(tmpRoot, "d.json"), text);
      const actual = store.readJsonInt64Safe("d.json");
      const expected = JSON.parse(oracle(text));
      // The seed is the reproduction handle if this ever fires.
      expect({ seed, actual }).toEqual({ seed, actual: expected });
    }
  });

  it("returns documents needing no rewrite untouched", () => {
    const text = JSON.stringify({ a: 1, b: "9223372036854775807", c: [1.5, -2] });
    writeFileSync(join(tmpRoot, "plain.json"), text);
    const store = new DirectoryStore(tmpRoot);
    expect(store.readJsonInt64Safe("plain.json")).toEqual(JSON.parse(text));
    expect(oracle(text)).toBe(text);
  });
});
