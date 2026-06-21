# EndField-MCP 项目状态

_Last updated: 2026-06-22_

## 当前版本

| 实现 | 版本 | 状态 |
|------|------|------|
| TypeScript（Bun） | 0.1.0-dev.0 | skeleton — Wiki MVP 已端到端跑通 |

- 当前工具：6 个 Wiki 工具（`ef_*` 前缀）
- 单实现：仅 TypeScript / Bun（不搞双实现——TS 一套覆盖 stdio + HTTP）
- 兼容性预期：1.0 前工具名/必填参数可变；1.0 后冻结（参考 PRTS-MCP 政策）

## 当前分支

仓库尚未 `git init`。骨架完成后第一次提交即建立 `main` / `dev` 双分支模型。

## 仓库结构

```
EndFiled-MCP/
├── ts/                          # 唯一实现
│   ├── src/
│   │   ├── server.ts            # 入口：按 EF_TRANSPORT 选 stdio / http
│   │   ├── config.ts            # env 解析、路径优先级
│   │   ├── startupSync.ts       # 同步编排（v0.1 占位 no-op）
│   │   ├── api/
│   │   │   └── endfieldWiki.ts  # MediaWiki 客户端（WAF 头 + 速率限制）
│   │   ├── data/
│   │   │   └── stores.ts        # JsonStore 抽象（Directory/Zip/Fallback）
│   │   ├── tools/
│   │   │   └── wikiTools.ts     # 6 个 ef_ Wiki 工具注册
│   │   ├── transports/
│   │   │   ├── stdio.ts         # StdioServerTransport 封装
│   │   │   └── http.ts          # Stateless Streamable HTTP（Bun.serve）
│   │   └── utils/
│   │       └── sanitizer.ts     # wikitext 清洗
│   ├── tests/                   # bun:test（53 测试全绿）
│   ├── scripts/
│   │   └── smoke-live.ts        # live WAF 绕过验证（不进 CI）
│   ├── package.json             # type: module, Bun scripts
│   ├── tsconfig.json
│   └── CHANGELOG.md             # 待补
├── docs/
│   └── dev/
│       └── STYLE.md
├── scripts/
│   ├── check-runtime.ps1        # Windows 环境审计
│   └── check-runtime.sh         # Unix 环境审计
├── .github/workflows/
│   └── ci.yml                   # Bun test + typecheck + build（Linux + Windows）
├── AGENTS.md                    # AI 协作说明（本会话必读）
├── STATUS.md                    # 本文件
├── ROADMAP.md                   # 路线图
└── README.md                    # 面向用户的说明
```

## 数据源

| 数据源 | 用途 | 接入方式 | 状态 |
|--------|------|----------|------|
| [endfield.wiki.gg](https://endfield.wiki.gg/api.php) | 世界观词条、阵营设定 | 实时 HTTP（浏览器 UA + Referer 绕 WAF） | ✅ v0.1 |
| 自建 GameData 镜像仓库 | 角色/敌人/物品/关卡表格 | GitHub Release（参照 ArknightsGameData 模式） | ⏳ v0.2 |

Wiki 内容以英文为主；调用方 LLM 负责桥接到用户语言。工具描述与项目文档使用中文。

## 工具清单 (6, current branch)

| # | 工具 | 数据源 | 版本 |
|---|------|--------|------|
| 1 | `ef_search_wiki` | endfield.wiki.gg | 0.1.0 |
| 2 | `ef_read_wiki_page` | endfield.wiki.gg | 0.1.0 |
| 3 | `ef_list_wiki_sections` | endfield.wiki.gg | 0.1.0 |
| 4 | `ef_get_wiki_categories` | endfield.wiki.gg | 0.1.0 |
| 5 | `ef_get_wiki_links` | endfield.wiki.gg | 0.1.0 |
| 6 | `ef_get_wiki_template` | endfield.wiki.gg | 0.1.0 |

## 验收状态（v0.1 骨架）

| 检查项 | 结果 |
|--------|------|
| `bun install` | ✅ 99 包，3.18s |
| `bun run typecheck` | ✅ 零错误 |
| `bun test` | ✅ 53/53 通过 |
| `bun run build`（tsc emit） | ✅ dist 完整生成 |
| stdio transport 握手 | ✅ initialize + tools/list 返回正确 serverInfo 与 6 工具 |
| HTTP transport | ✅ `/health` ok，`/mcp POST` 返回 SSE 流，`GET` 返回 405 |
| live WAF 绕过 | ✅ `searchWiki("Endfield")` 返回 2273 真实结果 |
| CI（GitHub Actions） | ✅ workflow 就位（待首次推送触发） |

## 已知遗留

- [ ] 自建 GameData 镜像仓库的 schema 与 CI pipeline（v0.2 阻塞项）
- [ ] startupSync 的真实 sync 逻辑（v0.2 随镜像仓库就位）
- [ ] CHANGELOG.md（首次正式提交时建立）
- [ ] `git init` 与 main/dev 双分支模型建立
