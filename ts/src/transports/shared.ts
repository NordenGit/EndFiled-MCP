/**
 * Process sharing for stdio clients — one host, N bridges.
 *
 * stdio spawns one server per client, and every client is a full copy:
 * Claude Desktop windows, Claude Code sessions and Chatbox each get their
 * own process, each parsing the same GameData JSON into its own heap. The
 * i18n index alone is ~9 MB of JSON per language, and CharacterTable adds
 * another ~9 MB, so N clients cost N × a few hundred MB for byte-identical
 * data.
 *
 * So only the first process loads it. That one becomes the *host*: it binds
 * the data layer and additionally listens on a loopback port. Every later
 * process becomes a *bridge* — it loads nothing and just pumps JSON-RPC
 * between its own stdin/stdout and the host's /mcp endpoint. Cost per extra
 * client drops from a full dataset to an idle Bun runtime.
 *
 * The election is the port bind itself: whoever binds wins. A loser of the
 * startup race gets EADDRINUSE, re-probes the same port, finds the sibling
 * that just won, and bridges to it. No lockfile to go stale, no daemon to
 * supervise, no orphan to reap — the host is an ordinary client process.
 *
 * The port is derived from a fingerprint of the install (version + data
 * paths + user), so two checkouts, two versions, or two users on the same
 * machine never share a process. /health echoes that fingerprint back, so
 * a bridge that finds an unrelated service squatting the port declines to
 * talk to it and moves on to the next candidate.
 *
 * Opt out with EF_SHARE=0 (every process then loads its own data, the
 * pre-0.4.1 behaviour).
 */

import { createHash } from "node:crypto";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLogger } from "../utils/log.js";
import { runHttp } from "./http.js";
import { runStdio } from "./stdio.js";

const log = createLogger("ef.shared");

/** Bind and dial loopback only — never 0.0.0.0. A shared host must not be reachable off-box. */
const LOOPBACK = "127.0.0.1";

/** A live host answers /health in microseconds; this only bounds the dead-port case. */
const PROBE_TIMEOUT_MS = 700;

/** Dynamic/private port range (RFC 6335) — nothing standard is registered here. */
const PORT_BASE = 49152;
const PORT_SPAN = 16000;

/** Consecutive ports to try before giving up and running standalone. */
const CANDIDATES = 3;

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Collapse install identity into a short hex tag.
 *
 * Hashed rather than sent verbatim because /health is readable by any local
 * process, and the raw identity contains the user's home directory.
 */
export function fingerprint(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

/**
 * Candidate rendezvous ports for a fingerprint, in preference order.
 *
 * Deterministic: every process of the same install computes the same list
 * without coordinating. Consecutive fallbacks cover the case where an
 * unrelated program already holds the preferred port.
 */
export function rendezvousPorts(fp: string, count = CANDIDATES): number[] {
  const base = PORT_BASE + (parseInt(fp.slice(0, 8), 16) % PORT_SPAN);
  return Array.from({ length: count }, (_, i) => base + i);
}

/** True when a host of *this* install is already serving on `port`. */
async function probe(port: number, fp: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${LOOPBACK}:${port}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { id?: unknown };
    return body.id === fp;
  } catch {
    return false;
  }
}

/**
 * Run as a bridge: cross-wire our stdin/stdout to the host's /mcp.
 *
 * Both ends implement the SDK's Transport contract, so the bridge is pure
 * plumbing — it never builds an McpServer, never registers a tool and never
 * touches the data layer. That is the whole point: this process stays empty.
 */
async function runBridge(port: number): Promise<void> {
  const upstream = new StreamableHTTPClientTransport(
    new URL(`http://${LOOPBACK}:${port}/mcp`),
  );
  const downstream = new StdioServerTransport();

  // Losing the host mid-session is unrecoverable in place: this process has
  // no data layer to fall back on. Exiting is the correct move — the MCP
  // client respawns us, and the replacement finds the port free and wins the
  // election, becoming the new host.
  let closing = false;
  const fail = (err: unknown): void => {
    if (closing) return;
    closing = true;
    log("ERROR", `Host link lost: ${reason(err)} — exiting for respawn`);
    process.exit(1);
  };

  downstream.onmessage = (m): void => void upstream.send(m).catch(fail);
  upstream.onmessage = (m): void => void downstream.send(m).catch(fail);
  upstream.onerror = fail;
  downstream.onerror = fail;
  upstream.onclose = (): void => fail(new Error("host closed the connection"));
  // Our own client went away: an ordinary shutdown, not a failure.
  downstream.onclose = (): void => {
    closing = true;
    process.exit(0);
  };

  await upstream.start();
  await downstream.start();
  log("INFO", `Bridged to host on ${LOOPBACK}:${port} — no data loaded here`);
}

export interface SharedOptions {
  /** Install fingerprint from `fingerprint()`. */
  fp: string;
  createMcpServer: () => McpServer;
  /** Binds the data layer. Runs in the elected host only. */
  initHost: () => void;
}

/**
 * Serve one stdio client, sharing a data layer with sibling processes.
 *
 * Falls back to standalone (load our own data) rather than failing if no
 * candidate port can be claimed — a degraded memory profile beats a server
 * that will not start.
 */
export async function runSharedStdio(opts: SharedOptions): Promise<void> {
  for (const port of rendezvousPorts(opts.fp)) {
    if (await probe(port, opts.fp)) return await runBridge(port);

    try {
      await runHttp(opts.createMcpServer, {
        port,
        host: LOOPBACK,
        identity: opts.fp,
      });
    } catch (err) {
      // Either a stranger holds this port, or a sibling bound it between our
      // probe and our bind. Re-probing separates the two: a sibling now
      // answers our fingerprint, a stranger does not.
      if (await probe(port, opts.fp)) return await runBridge(port);
      log("INFO", `Port ${port} taken (${reason(err)}) — trying next`);
      continue;
    }

    // The bind above is synchronous inside Bun.serve and initHost() only
    // assigns module-level stores, so both complete before Bun can dispatch
    // a first request. No bridge can observe a host with unbound stores.
    log("INFO", `Elected host on ${LOOPBACK}:${port}`);
    opts.initHost();
    return await runStdio(opts.createMcpServer());
  }

  log("WARN", "No rendezvous port free — running standalone with own data");
  opts.initHost();
  return await runStdio(opts.createMcpServer());
}
