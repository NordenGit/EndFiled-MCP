# 镜像仓库 Release Workflow 设计草稿

_本文档是给未来的 `EndFieldGameData` 镜像仓库（或同义命名）准备的 GitHub Actions
设计参考。镜像仓库本身是独立项目，不在这个仓库里——这里只记录设计意图，便于
建仓时直接套用。_

## 仓库定位

镜像仓库的目标：**定期从 endfield_research_kit 的导出产出中，凝练出纯文本 JSON
表格，打包成 GitHub Release asset 供 EndField-MCP 同步消费**。

关键约束（与 ROADMAP.md / docs/dev/STYLE.md 一致）：

- 只发布**纯文本 JSON 表格**，不发布二进制资产（贴图、音频、模型）。
- 不再分发 endfield_research_kit 的原始导出物（上游明确禁止）。
- 体积控制在几十 MB 级别（GitHub Release 单 asset 上限是 2GB，足够）。
- tag 用裸 semver：`v0.2.0`、`v0.2.1` 等。

## 触发方式

两种触发并存：

### 1. 定时触发（推荐每周一次）

```yaml
on:
  schedule:
    # 每周一 UTC 02:00 跑一次（北京时间 10:00）
    - cron: "0 2 * * 1"
  workflow_dispatch: {}  # 允许手动触发
```

定时触发会自动检查终末地客户端是否更新（通过比对当前导出的指纹与上次发布的
指纹）。游戏没更新就跳过 Release；更新了就跑导出 + 打包 + 发布。

### 2. 手动触发

`workflow_dispatch` 带一个 `force` 输入参数，强制重新导出并发布（哪怕指纹没变）。

## 工作流阶段

```yaml
jobs:
  export:
    runs-on: windows-latest  # 终末地是 Windows 游戏，endfield_research_kit 依赖 Windows
    steps:
      # 1. checkout 镜像仓库（含 endfield_research_kit 作为 submodule 或克隆）
      # 2. 装依赖：Rust/Cargo（fluffy-dumper）、.NET 9（AnimeStudio CLI）、Python 3
      # 3. 缓存 fluffy-dumper 和 AnimeStudio 的构建产物（首次 ~10min，后续 <1min）
      # 4. 检出游戏客户端（这一步需要 self-hosted runner，见下文）
      # 5. 跑 endfield_research_kit 的 export.bat --export-from-game
      # 6. 从 export_full/structured/StreamingAssets/Table/ 挑出我们关心的 JSON
      # 7. 打包成 endfield-tables.zip
      # 8. 上传为 artifact 给下一 job

  release:
    needs: export
    runs-on: ubuntu-latest
    steps:
      # 1. 下载 artifact
      # 2. 计算 zip 的 sha256
      # 3. 与上一次 Release 的 sha256 比对，相同则跳过
      # 4. 不同则生成新 tag（基于日期 + 自增：v0.2.0-20260622 或纯 semver）
      # 5. gh release create 发布
```

## self-hosted runner 问题

endfield_research_kit 需要**本地的终末地客户端**才能导出。GitHub-hosted runner
上没有游戏客户端，且游戏客户端有数十 GB，每次工作流都重装不现实。

两种解法：

### 选项 A：self-hosted runner（推荐）

在你本地（或专用机器）配置一个 GitHub Actions self-hosted runner，常驻游戏
客户端。镜像仓库的 export job 用 `runs-on: self-hosted` 跑。优点是游戏客户端
常驻、导出快；缺点是要维护一台常开机的主机。

### 选项 B：手动导出 + 自动发布

你在本地手动跑导出（就像现在做的），把 `endfield-tables.zip` 推到镜像仓库
的某个分支或上传为 artifact，CI 只负责"比对 sha + 打 Release"这后半段。前半段
（导出）是手动节奏。优点是无需 self-hosted runner；缺点是更新节奏取决于你
手动跑的频率。

**v0.2 阶段建议选项 B**——先让链路跑通，等社区对镜像有稳定更新频率需求时再
升级到 self-hosted runner。

## zip 结构约定

镜像仓库发布的 `endfield-tables.zip` 内部结构必须与 EndField-MCP 的
`datasets.ts` 里 `requiredFiles` 的路径**完全一致**。建议约定：

```
endfield-tables.zip
└── tables/                          # 顶层目录，与 requiredFiles 前缀对应
    ├── character_table.json
    ├── item_table.json
    ├── enemy_table.json
    ├── stage_table.json
    └── ... （具体文件名 SCHEMA_TODO，待首次导出确认）
```

EndField-MCP 这边的 `GAMEDATA_TABLES.requiredFiles` 就会写成
`["tables/character_table.json", ...]`，`localRoot` 解压后直接读
`<dataPath>/tables/character_table.json`。

## 版本号策略

- 主版本号跟随 EndField-MCP 的 minor：v0.2.x 镜像对应 EndField-MCP 0.2.x。
- 镜像独立 patch：游戏更新但 schema 没变 → patch +1（如 v0.2.1）。
- schema 有 breaking 变化 → minor +1（如 v0.3.0），同步更新 EndField-MCP 的
  `requiredFiles` 和 reader。
- 首个 Release：`v0.2.0`（与 EndField-MCP 的 0.2.0 同步发布）。

## 镜像级联

EndField-MCP 的 `sync.ts` 支持 `GITHUB_MIRRORS` 环境变量配置 ghproxy 风格的代理
URL。对于 GitHub Release 的下载，国内用户可以配：

```
GITHUB_MIRRORS=https://ghproxy.net
```

镜像仓库的 Release asset 下载 URL 是
`github.com/<owner>/<repo>/releases/download/<tag>/endfield-tables.zip`，
ghproxy 会自动代理。

## 待你决定的事项

- [ ] 镜像仓库的 owner/repo 名（当前占位 `3aKHP/EndFieldGameData`）
- [ ] 选项 A（self-hosted runner）还是 B（手动导出 + CI 发布）
- [ ] zip 内部目录结构（`tables/` 还是 `data/` 还是扁平）
- [ ] 首次 Release 时机（v0.2.0 与 EndField-MCP 同步，还是更早先发一个 v0.1.0
      镜像测试链路）

这些决策可以在你导出完成后、写镜像仓库的 CI 时再定。
