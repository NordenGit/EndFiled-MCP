/**
 * int64-safe JSON parsing tests.
 *
 * Verifies the parseInt64Safe logic that wraps large integer literals in
 * quotes so they survive JSON.parse as strings. This is the single most
 * load-bearing piece of the Endfield data layer — a regression here
 * silently breaks every localization lookup.
 *
 * The tests reach into the module-private helper via a tiny public surface:
 * we exercise it through DirectoryStore.readJsonInt64Safe against staged
 * temp files, which is the real consumer path.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectoryStore } from "../src/data/stores.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ef-int64-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("DirectoryStore.readJsonInt64Safe", () => {
  it("preserves int64 values as strings when beyond MAX_SAFE_INTEGER", () => {
    // -7078064683023630592 is chr_0002_endminm's actual name id.
    writeFileSync(
      join(tmpRoot, "test.json"),
      '{"name": {"id": -7078064683023630592, "text": ""}}',
    );
    const store = new DirectoryStore(tmpRoot);
    const data = store.readJsonInt64Safe<{
      name: { id: string; text: string };
    }>("test.json");
    expect(data.name.id).toBe("-7078064683023630592");
    expect(typeof data.name.id).toBe("string");
  });

  it("preserves positive int64 values beyond MAX_SAFE_INTEGER", () => {
    // 9200000000000000001 is comfortably beyond 2^53.
    writeFileSync(
      join(tmpRoot, "test.json"),
      '{"id": 9200000000000000001}',
    );
    const store = new DirectoryStore(tmpRoot);
    const data = store.readJsonInt64Safe<{ id: string }>("test.json");
    expect(data.id).toBe("9200000000000000001");
  });

  it("leaves safe integers as numbers", () => {
    writeFileSync(
      join(tmpRoot, "test.json"),
      '{"rarity": 6, "profession": 0, "weaponType": 1}',
    );
    const store = new DirectoryStore(tmpRoot);
    const data = store.readJsonInt64Safe<{
      rarity: number;
      profession: number;
      weaponType: number;
    }>("test.json");
    expect(data.rarity).toBe(6);
    expect(typeof data.rarity).toBe("number");
    expect(data.profession).toBe(0);
  });

  it("leaves MAX_SAFE_INTEGER boundary values as numbers", () => {
    // 9007199254740991 === Number.MAX_SAFE_INTEGER. Should stay a number.
    writeFileSync(
      join(tmpRoot, "test.json"),
      '{"safe": 9007199254740991}',
    );
    const store = new DirectoryStore(tmpRoot);
    const data = store.readJsonInt64Safe<{ safe: number }>("test.json");
    expect(data.safe).toBe(Number.MAX_SAFE_INTEGER);
    expect(typeof data.safe).toBe("number");
  });

  it("wraps MAX_SAFE_INTEGER + 1 as string", () => {
    writeFileSync(
      join(tmpRoot, "test.json"),
      '{"over": 9007199254740992}',
    );
    const store = new DirectoryStore(tmpRoot);
    const data = store.readJsonInt64Safe<{ over: string }>("test.json");
    expect(data.over).toBe("9007199254740992");
    expect(typeof data.over).toBe("string");
  });

  it("handles arrays of mixed int64 and small ints", () => {
    writeFileSync(
      join(tmpRoot, "test.json"),
      '{"ids": [-7078064683023630592, 42, 9007199254740999, 0]}',
    );
    const store = new DirectoryStore(tmpRoot);
    const data = store.readJsonInt64Safe<{
      ids: (string | number)[];
    }>("test.json");
    expect(data.ids[0]).toBe("-7078064683023630592");
    expect(data.ids[1]).toBe(42);
    expect(data.ids[2]).toBe("9007199254740999");
    expect(data.ids[3]).toBe(0);
  });

  it("does not touch integers already inside quoted strings", () => {
    writeFileSync(
      join(tmpRoot, "test.json"),
      '{"key": "-7078064683023630592", "value": "管理员"}',
    );
    const store = new DirectoryStore(tmpRoot);
    const data = store.readJsonInt64Safe<{
      key: string;
      value: string;
    }>("test.json");
    expect(data.key).toBe("-7078064683023630592");
    expect(data.value).toBe("管理员");
  });

  it("handles nested objects with int64 at multiple depths", () => {
    // Written as raw text — JSON.stringify of a JS object would truncate
    // the int64 ids before they ever reach the parser.
    writeFileSync(
      join(tmpRoot, "test.json"),
      '{"outer":{"id":-7078064683023630592,"nested":[{"id":9007199254740999,"small":1}]}}',
    );
    const store = new DirectoryStore(tmpRoot);
    const data = store.readJsonInt64Safe<{
      outer: {
        id: string;
        nested: Array<{ id: string; small: number }>;
      };
    }>("test.json");
    expect(data.outer.id).toBe("-7078064683023630592");
    expect(data.outer.nested[0]!.id).toBe("9007199254740999");
    expect(data.outer.nested[0]!.small).toBe(1);
  });
});
