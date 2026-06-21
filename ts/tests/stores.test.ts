/**
 * Stores layer tests.
 *
 * Covers path-safety invariants (the central guarantee of the JsonStore
 * abstraction) and the Directory/Zip/Fallback reading paths. These are
 * pure-filesystem tests — no network, no wiki.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import {
  DirectoryStore,
  ZipStore,
  FallbackStore,
} from "../src/data/stores.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ef-stores-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("DirectoryStore", () => {
  it("reads JSON files under the root", () => {
    mkdirSync(join(tmpRoot, "excel"));
    writeFileSync(
      join(tmpRoot, "excel", "character_table.json"),
      '{"chars":{"a":{"name":"Test"}}}',
    );
    const store = new DirectoryStore(tmpRoot);
    expect(store.exists("excel/character_table.json")).toBe(true);
    const data = store.readJson<{ chars: Record<string, { name: string }> }>(
      "excel/character_table.json",
    );
    expect(data.chars.a.name).toBe("Test");
  });

  it("returns false for missing files", () => {
    const store = new DirectoryStore(tmpRoot);
    expect(store.exists("missing.json")).toBe(false);
  });

  it("throws on missing read", () => {
    const store = new DirectoryStore(tmpRoot);
    expect(() => store.readText("missing.json")).toThrow(/not found/);
  });

  it("rejects path traversal via ..", () => {
    const store = new DirectoryStore(tmpRoot);
    expect(() => store.exists("../escape.json")).toThrow(/Unsafe/);
    expect(() => store.readText("../escape.json")).toThrow(/Unsafe/);
  });

  it("rejects absolute paths", () => {
    const store = new DirectoryStore(tmpRoot);
    expect(() => store.exists("/etc/passwd")).toThrow(/Unsafe/);
  });

  it("normalizes backslashes to forward slashes", () => {
    mkdirSync(join(tmpRoot, "excel"));
    writeFileSync(
      join(tmpRoot, "excel", "stage_table.json"),
      '{"stages":{}}',
    );
    const store = new DirectoryStore(tmpRoot);
    // Caller might pass Windows-style separators; store normalizes them.
    expect(store.exists("excel\\stage_table.json")).toBe(true);
  });

  it("describe identifies the store type and root", () => {
    const store = new DirectoryStore(tmpRoot);
    expect(store.describe()).toBe(`directory:${tmpRoot}`);
  });
});

describe("ZipStore", () => {
  function makeZip(files: Record<string, string>): string {
    const zipPath = join(tmpRoot, "data.zip");
    const zip = new AdmZip();
    for (const [path, content] of Object.entries(files)) {
      zip.addFile(path, Buffer.from(content, "utf-8"));
    }
    zip.writeZip(zipPath);
    return zipPath;
  }

  it("reads entries from a zip", () => {
    const zipPath = makeZip({
      "excel/item_table.json": '{"items":{}}',
    });
    const store = new ZipStore(zipPath);
    expect(store.exists("excel/item_table.json")).toBe(true);
    const data = store.readJson<{ items: Record<string, unknown> }>(
      "excel/item_table.json",
    );
    expect(data.items).toEqual({});
  });

  it("returns false for missing entries", () => {
    const zipPath = makeZip({ "a.json": "{}" });
    const store = new ZipStore(zipPath);
    expect(store.exists("missing.json")).toBe(false);
  });

  it("returns false when zip file is missing entirely", () => {
    const store = new ZipStore(join(tmpRoot, "nope.zip"));
    expect(store.exists("anything.json")).toBe(false);
  });

  it("describe identifies the zip path", () => {
    const zipPath = makeZip({ "a.json": "{}" });
    const store = new ZipStore(zipPath);
    expect(store.describe()).toBe(`zip:${zipPath}`);
  });

  it("can be closed and reused", () => {
    const zipPath = makeZip({ "a.json": '{"x":1}' });
    const store = new ZipStore(zipPath);
    store.readJson("a.json");
    store.close();
    // Re-open after close (lazy reload)
    expect(store.readJson<{ x: number }>("a.json").x).toBe(1);
  });
});

describe("FallbackStore", () => {
  it("prefers primary when present", () => {
    mkdirSync(join(tmpRoot, "primary"));
    mkdirSync(join(tmpRoot, "fallback"));
    writeFileSync(join(tmpRoot, "primary", "f.json"), '{"src":"primary"}');
    writeFileSync(join(tmpRoot, "fallback", "f.json"), '{"src":"fallback"}');

    const store = new FallbackStore(
      new DirectoryStore(join(tmpRoot, "primary")),
      new DirectoryStore(join(tmpRoot, "fallback")),
    );
    expect(store.readJson<{ src: string }>("f.json").src).toBe("primary");
  });

  it("falls back when primary is missing", () => {
    mkdirSync(join(tmpRoot, "primary"));
    mkdirSync(join(tmpRoot, "fallback"));
    writeFileSync(join(tmpRoot, "fallback", "f.json"), '{"src":"fallback"}');

    const store = new FallbackStore(
      new DirectoryStore(join(tmpRoot, "primary")),
      new DirectoryStore(join(tmpRoot, "fallback")),
    );
    expect(store.exists("f.json")).toBe(true);
    expect(store.readJson<{ src: string }>("f.json").src).toBe("fallback");
  });

  it("throws when neither has the file", () => {
    const store = new FallbackStore(
      new DirectoryStore(join(tmpRoot, "a")),
      new DirectoryStore(join(tmpRoot, "b")),
    );
    expect(store.exists("missing.json")).toBe(false);
    expect(() => store.readText("missing.json")).toThrow(/fallback chain/);
  });

  it("describe includes both layers", () => {
    const store = new FallbackStore(
      new DirectoryStore(join(tmpRoot, "a")),
      new DirectoryStore(join(tmpRoot, "b")),
    );
    expect(store.describe()).toBe(
      `fallback:directory:${join(tmpRoot, "a")} -> directory:${join(tmpRoot, "b")}`,
    );
  });
});
