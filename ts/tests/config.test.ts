/**
 * Config layer tests.
 *
 * Verifies env-var overrides and transport selection. All cases stub
 * process.env in an isolated record so they don't leak between tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, resolveTransport } from "../src/config.js";

const ENV_KEYS = [
  "EF_DATA_PATH",
  "EF_WIKI_ENDPOINT",
  "EF_WIKI_UA",
  "EF_WIKI_REFERER",
  "EF_TRANSPORT",
  "PORT",
  "HOST",
  "GITHUB_MIRRORS",
  "EF_MCP_ROOT",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("loadConfig defaults", () => {
  it("uses the default wiki endpoint", () => {
    const cfg = loadConfig();
    expect(cfg.wikiEndpoint).toBe("https://endfield.wiki.gg/api.php");
  });

  it("uses a browser-style default User-Agent (WAF requirement)", () => {
    const cfg = loadConfig();
    expect(cfg.wikiUserAgent).toContain("Mozilla");
    expect(cfg.wikiUserAgent.length).toBeGreaterThan(40);
  });

  it("uses the wiki root as default Referer", () => {
    const cfg = loadConfig();
    expect(cfg.wikiReferer).toBe("https://endfield.wiki.gg/");
  });

  it("defaults to stdio transport", () => {
    const cfg = loadConfig();
    expect(cfg.transport).toBe("stdio");
  });

  it("isCustomDataPath is false when EF_DATA_PATH is unset", () => {
    const cfg = loadConfig();
    expect(cfg.isCustomDataPath).toBe(false);
  });

  it("parses empty GITHUB_MIRRORS to an empty array", () => {
    const cfg = loadConfig();
    expect(cfg.githubMirrors).toEqual([]);
  });
});

describe("loadConfig env overrides", () => {
  it("honors EF_DATA_PATH and marks it custom", () => {
    process.env["EF_DATA_PATH"] = "/custom/data";
    const cfg = loadConfig();
    expect(cfg.dataPath).toBe("/custom/data");
    expect(cfg.isCustomDataPath).toBe(true);
  });

  it("honors EF_WIKI_ENDPOINT", () => {
    process.env["EF_WIKI_ENDPOINT"] = "https://mirror.example/api.php";
    const cfg = loadConfig();
    expect(cfg.wikiEndpoint).toBe("https://mirror.example/api.php");
  });

  it("honors EF_WIKI_UA", () => {
    process.env["EF_WIKI_UA"] = "TestBot/1.0";
    const cfg = loadConfig();
    expect(cfg.wikiUserAgent).toBe("TestBot/1.0");
  });

  it("honors PORT and HOST for HTTP transport", () => {
    process.env["PORT"] = "8080";
    process.env["HOST"] = "127.0.0.1";
    const cfg = loadConfig();
    expect(cfg.httpPort).toBe(8080);
    expect(cfg.httpHost).toBe("127.0.0.1");
  });

  it("parses GITHUB_MIRRORS comma list, strips trailing slashes", () => {
    process.env["GITHUB_MIRRORS"] =
      "https://ghproxy.net/, https://mirror.example.com/";
    const cfg = loadConfig();
    expect(cfg.githubMirrors).toEqual([
      "https://ghproxy.net",
      "https://mirror.example.com",
    ]);
  });
});

describe("resolveTransport", () => {
  it("returns stdio by default", () => {
    expect(resolveTransport()).toBe("stdio");
  });

  it("returns http for EF_TRANSPORT=http", () => {
    process.env["EF_TRANSPORT"] = "http";
    expect(resolveTransport()).toBe("http");
  });

  it("returns http for EF_TRANSPORT=streamable-http", () => {
    process.env["EF_TRANSPORT"] = "streamable-http";
    expect(resolveTransport()).toBe("http");
  });

  it("is case-insensitive", () => {
    process.env["EF_TRANSPORT"] = "HTTP";
    expect(resolveTransport()).toBe("http");
  });

  it("falls back to stdio on unknown value", () => {
    process.env["EF_TRANSPORT"] = "weird";
    expect(resolveTransport()).toBe("stdio");
  });
});
