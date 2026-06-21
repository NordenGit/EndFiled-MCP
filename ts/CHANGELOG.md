# Changelog

All notable changes to EndField-MCP (TypeScript implementation) are recorded
here. Format follows [Keep a Changelog](https://keepachangelog.com/),
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added — v0.1.0 skeleton

Initial project skeleton. End-to-end working Wiki MVP, no GameData domain
yet.

- **Project scaffold**: Bun + TypeScript + MCP SDK project layout with
  strict TS, ESM, NodeNext module resolution.
- **6 Wiki tools** (`ef_` prefix):
  - `ef_search_wiki(query, limit?, search_mode?, filter_technical?)`
  - `ef_read_wiki_page(page_title, section_index?)`
  - `ef_list_wiki_sections(page_title)`
  - `ef_get_wiki_categories(page_title)`
  - `ef_get_wiki_links(page_title, direction?, limit?)`
  - `ef_get_wiki_template(page_title)`
- **Dual transport**: stdio (default, `StdioServerTransport`) and Streamable
  HTTP stateless (`WebStandardStreamableHTTPServerTransport` over
  `Bun.serve`). Selected via `EF_TRANSPORT` env var.
- **Wiki client** (`api/endfieldWiki.ts`): MediaWiki API client with
  built-in WAF bypass (browser UA + Referer + Accept headers), 1.5s rate
  limiter, and parsetree XML parser for template extraction.
- **Store abstraction** (`data/stores.ts`): `JsonStore` interface with
  `DirectoryStore`, `ZipStore`, `FallbackStore` implementations. Path-safety
  invariants (rejects absolute paths, `..` traversal, leading `/`).
- **Config layer** (`config.ts`): env-driven configuration with path
  priority (Docker volume → per-user dir → bundled fallback).
- **Test suite**: 53 tests across stores, sanitizer, config, wiki client
  (mocked fetch). Zero network dependencies in `bun test`.
- **CI**: GitHub Actions workflow (`.github/workflows/ci.yml`) running
  typecheck + test + build on Linux + Windows, Bun 1.3.
- **Runtime audit scripts**: `scripts/check-runtime.{ps1,sh}` for
  cross-platform environment verification.
- **Live smoke test**: `ts/scripts/smoke-live.ts` for manual WAF-bypass
  verification against endfield.wiki.gg (not part of `bun test`).
- **Docs**: README (bilingual), AGENTS.md, STATUS.md, ROADMAP.md,
  `docs/dev/STYLE.md`.

### Architecture decisions

- **Single TS implementation** (no Python sibling). Rationale: PRTS-MCP's
  dual implementation was driven by Python's asyncio friction with
  Streamable HTTP; Bun+TS handles both transports natively, eliminating
  that motivation.
- **Bun runtime** (not Node). Official MCP SDK first-class support;
  native `fetch`, native `Bun.serve`, native `bun:test`.
- **Stateless HTTP transport** (no session tracking). EndField-MCP has no
  per-session state, so stateless is strictly simpler than PRTS-MCP's
  session-pooled approach with no capability loss.
- **Wiki source: endfield.wiki.gg**. Verified MediaWiki 1.43.6 with live
  `api.php` access (requires WAF bypass headers). endfield.prts.chat and
  endfield.games were evaluated and rejected (RAG tool and pure SPA
  respectively; neither is a wiki nor has a usable API).
- **GameData: self-hosted mirror** (planned for v0.2). Will mirror only
  text-only JSON tables from endfield_research_kit exports, no binary
  assets. Private domain hosting as fallback.

### Known limitations

- GameData domain not wired (v0.2).
- Story / lore domain not wired (v0.5).
- `startupSync.ts` is a no-op placeholder.
- No Docker image yet.
- Not yet published to npm.
- Git repository not yet initialized.
