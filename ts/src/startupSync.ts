/**
 * Startup data-sync orchestration.
 *
 * v0.1 placeholder: the skeleton ships without a GameData domain (Wiki tools
 * are the MVP surface). This module exposes the same `runStartupSync` entry
 * point the server calls, but it is a no-op until v0.2 wires up the
 * self-hosted mirror sync.
 *
 * The shape is intentionally aligned with PRTS-MCP's startupSync.ts so the
 * v0.2 implementation can drop in: single-flight locking, retry/backoff,
 * cache-clearing cascade — all of those patterns port cleanly.
 */

export interface SyncRunResult {
  status: "skipped" | "done";
  reason: string;
}

export async function runStartupSync(): Promise<SyncRunResult> {
  // v0.1: nothing to sync. The Wiki domain is fetched live per-request via
  // endfieldWiki.ts, and the GameData domain is intentionally absent.
  // v0.2 will branch on config.isCustomDataPath and dispatch the mirror
  // sync (syncReleaseArchive) here.
  return {
    status: "skipped",
    reason: "v0.1 has no GameData domain; sync is a no-op.",
  };
}
