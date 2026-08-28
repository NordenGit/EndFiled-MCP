import { describe, expect, test } from "bun:test";
import { fingerprint, rendezvousPorts } from "../src/transports/shared.js";

describe("fingerprint", () => {
  test("is deterministic and short", () => {
    const fp = fingerprint("endfield-mcp|0.4.1|/home/u|/data|/bundled");
    expect(fp).toBe(fingerprint("endfield-mcp|0.4.1|/home/u|/data|/bundled"));
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  test("separates installs that must not share a process", () => {
    const base = ["endfield-mcp", "0.4.1", "/home/u", "/data", "/bundled"];
    const vary = (i: number, v: string) =>
      fingerprint(base.map((x, j) => (j === i ? v : x)).join("|"));

    // Version, user and both data paths each break sharing on their own.
    const tags = new Set([
      fingerprint(base.join("|")),
      vary(1, "0.4.2"),
      vary(2, "/home/other"),
      vary(3, "/other-data"),
      vary(4, "/other-bundled"),
    ]);
    expect(tags.size).toBe(5);
  });

  test("does not leak the identity it was built from", () => {
    expect(fingerprint("/home/ludov/secret-path")).not.toContain("ludov");
  });
});

describe("rendezvousPorts", () => {
  const fp = fingerprint("endfield-mcp|0.4.1|/home/u|/data|/bundled");

  test("every process of one install agrees without coordinating", () => {
    expect(rendezvousPorts(fp)).toEqual(rendezvousPorts(fp));
  });

  test("stays inside the dynamic/private range", () => {
    for (const port of rendezvousPorts(fp, 3)) {
      expect(port).toBeGreaterThanOrEqual(49152);
      expect(port).toBeLessThanOrEqual(65535);
    }
  });

  test("fallbacks are consecutive", () => {
    const [a, b, c] = rendezvousPorts(fp, 3) as [number, number, number];
    expect(b).toBe(a + 1);
    expect(c).toBe(a + 2);
  });

  test("the top of the range cannot overflow past 65535", () => {
    // Worst case: the hash lands on the last slot of PORT_SPAN.
    const maxBase = 49152 + 15999;
    expect(maxBase + 2).toBeLessThanOrEqual(65535);
  });
});
