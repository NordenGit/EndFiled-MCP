/**
 * JSON store abstraction for local dataset access.
 *
 * Mirrors PRTS-MCP's `ts/src/data/stores.ts` shape-for-shape so the data
 * layer stays portable across the two projects. Business code only ever
 * touches the {@link JsonStore} interface; whether a file lives in a real
 * directory, inside a zip, or in a bundled fallback is invisible to callers.
 *
 * The same path-safety guarantees are preserved:
 *   - backslashes normalized to forward slashes
 *   - no leading "/"
 *   - no ".." segments
 *   - resolved target must remain inside the store root (DirectoryStore)
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import AdmZip from "adm-zip";

export interface JsonStore {
  exists(path: string): boolean;
  readText(path: string): string;
  readJson<T = unknown>(path: string): T;
  /**
   * Parse JSON with int64-safe number handling.
   *
   * Endfield tables store localization ids as raw int64 numbers (e.g.
   * `-7078064683023630592`), which exceed JS Number.MAX_SAFE_INTEGER
   * (2^53-1). A plain `JSON.parse` silently truncates them, breaking i18n
   * lookups. This variant pre-processes the text to wrap any integer
   * whose absolute value exceeds MAX_SAFE_INTEGER in quotes, so the id
   * survives as a string. Use it for any table containing `{id, text}`
   * localization objects.
   */
  readJsonInt64Safe<T = unknown>(path: string): T;
  describe(): string;
  close(): void;
}

/**
 * Pre-process JSON text so int64-sized integers are parsed as strings.
 *
 * Endfield localization ids (e.g. `-7078064683023630592`) exceed JS
 * Number.MAX_SAFE_INTEGER (2^53-1). A plain `JSON.parse` silently
 * truncates them, breaking i18n lookups. This wraps any bare integer
 * literal whose absolute value exceeds MAX_SAFE_INTEGER in double quotes
 * so it survives parsing as a string.
 *
 * The regex matches an optional sign + 15-19 digit run that sits in a
 * JSON value position (after `:`, `,`, `[`, or `{`, optionally preceded
 * by whitespace). Using a capture group for the prefix avoids the
 * variable-width lookbehind limitation.
 */
function parseInt64Safe(text: string): string {
  return text.replace(
    /([,:[\{]\s*)(-?\d{15,19})/g,
    (full, prefix: string, digits: string) => {
      const n = BigInt(digits);
      if (
        n > BigInt(Number.MAX_SAFE_INTEGER) ||
        n < BigInt(-Number.MAX_SAFE_INTEGER)
      ) {
        return `${prefix}"${digits}"`;
      }
      return full;
    },
  );
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    throw new Error(`Unsafe dataset path: ${path}`);
  }
  const parts = normalized.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) {
    throw new Error(`Unsafe dataset path: ${path}`);
  }
  return parts.join("/");
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// ---------------------------------------------------------------------------
// DirectoryStore
// ---------------------------------------------------------------------------

export class DirectoryStore implements JsonStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private resolvePath(path: string): string {
    const root = resolve(this.root);
    const target = resolve(this.root, normalizePath(path));
    if (!isInsideRoot(root, target)) {
      throw new Error(`Unsafe dataset path: ${path}`);
    }
    return target;
  }

  resolveForDiagnostics(path: string): string {
    return this.resolvePath(path);
  }

  exists(path: string): boolean {
    const target = this.resolvePath(path);
    return existsSync(target) && statSync(target).isFile();
  }

  readText(path: string): string {
    const target = this.resolvePath(path);
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new Error(`Dataset file not found: ${path}`);
    }
    return readFileSync(target, "utf-8");
  }

  readJson<T = unknown>(path: string): T {
    return JSON.parse(this.readText(path)) as T;
  }

  readJsonInt64Safe<T = unknown>(path: string): T {
    return JSON.parse(parseInt64Safe(this.readText(path))) as T;
  }

  describe(): string {
    return `directory:${this.root}`;
  }

  close(): void {
    // DirectoryStore does not hold open resources.
  }
}

// ---------------------------------------------------------------------------
// ZipStore
// ---------------------------------------------------------------------------

export class ZipStore implements JsonStore {
  readonly zipPath: string;
  private _zip: AdmZip | null = null;

  constructor(zipPath: string) {
    this.zipPath = zipPath;
  }

  private zip(): AdmZip {
    if (this._zip === null) {
      this._zip = new AdmZip(this.zipPath);
    }
    return this._zip;
  }

  close(): void {
    this._zip = null;
  }

  exists(path: string): boolean {
    const innerPath = normalizePath(path);
    if (!existsSync(this.zipPath)) return false;
    return this.zip().getEntry(innerPath) !== null;
  }

  readText(path: string): string {
    const innerPath = normalizePath(path);
    const entry = this.zip().getEntry(innerPath);
    if (!entry) {
      throw new Error(`Dataset zip entry not found: ${path}`);
    }
    return entry.getData().toString("utf-8");
  }

  readJson<T = unknown>(path: string): T {
    return JSON.parse(this.readText(path)) as T;
  }

  readJsonInt64Safe<T = unknown>(path: string): T {
    return JSON.parse(parseInt64Safe(this.readText(path))) as T;
  }

  describe(): string {
    return `zip:${this.zipPath}`;
  }
}

// ---------------------------------------------------------------------------
// FallbackStore
// ---------------------------------------------------------------------------

export class FallbackStore implements JsonStore {
  readonly primary: JsonStore;
  readonly fallback: JsonStore;

  constructor(primary: JsonStore, fallback: JsonStore) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private storeFor(path: string): JsonStore | null {
    if (this.primary.exists(path)) return this.primary;
    if (this.fallback.exists(path)) return this.fallback;
    return null;
  }

  exists(path: string): boolean {
    return this.storeFor(path) !== null;
  }

  readText(path: string): string {
    const store = this.storeFor(path);
    if (store === null) {
      throw new Error(`Dataset file not found in fallback chain: ${path}`);
    }
    return store.readText(path);
  }

  readJson<T = unknown>(path: string): T {
    return JSON.parse(this.readText(path)) as T;
  }

  readJsonInt64Safe<T = unknown>(path: string): T {
    const store = this.storeFor(path);
    if (store === null) {
      throw new Error(`Dataset file not found in fallback chain: ${path}`);
    }
    return store.readJsonInt64Safe<T>(path);
  }

  describe(): string {
    return `fallback:${this.primary.describe()} -> ${this.fallback.describe()}`;
  }

  close(): void {
    this.primary.close();
    this.fallback.close();
  }
}
