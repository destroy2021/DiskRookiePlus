# DiskRookie 项目指南

> 本文档面向 AI 编程助手，帮助快速理解和开发本项目。

## 项目概述

**DiskRookie（磁盘菜鸟）** 是一款 AI 驱动的智能磁盘分析与清理工具，采用 Tauri 2.x 构建。项目目标是让小白用户也能像电脑高手一样轻松清理磁盘。

### 核心特性

- 🚀 **Rust 高性能扫描**：基于 Rust 核心构建，最高速度可达 1 秒扫描 5000 个文件
- 🤖 **AI 智能分析**：自动分析文件用途，智能决定哪些需要删除、哪些需要迁移
- 🌐 **网盘无缝对接**：支持 Google Drive、OneDrive、阿里云盘、百度网盘、Dropbox 及 WebDAV NAS

### 技术栈

| 层级 | 技术 |
|------|------|
| 后端核心 | Rust (Edition 2021) |
| 桌面框架 | Tauri 2.x |
| 前端框架 | React 19 + TypeScript 5.x |
| 构建工具 | Vite 7.x |
| UI 组件 | PrimeReact + MUI + TailwindCSS |
| 图表库 | Recharts |
| 国际化 | i18next |

## 项目结构

```
DiskRookie/
├── Cargo.toml                    # Workspace 根配置
├── clippy.toml                   # Clippy  lint 配置
├── crates/                       # Rust 核心 crate
│   ├── common/                   # 通用错误类型和配置
│   ├── domain-model/             # 领域模型（数据结构）
│   ├── disk-scanner/             # 磁盘扫描引擎（含 MFT 扫描）
│   ├── ai-engine/                # AI 分析引擎
│   ├── executor/                 # 清理计划执行器
│   └── ntfs-reader/              # NTFS MFT 读取器（Windows 专用）
├── apps/desktop/                 # Tauri 桌面应用
│   ├── src-tauri/                # Rust 后端代码
│   │   ├── src/commands/         # Tauri 命令处理器
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json       # Tauri 配置
│   ├── frontend/                 # React 前端
│   │   ├── src/                  # TypeScript/React 源码
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   └── package.json              # Tauri 应用 package.json
├── docs/                         # 文档
├── figures/                      # 截图和示意图
└── .github/workflows/            # CI/CD 工作流
```

### Crate 依赖关系

```
common (基础错误类型)
  ↑
domain-model (领域模型)
  ↑
disk-scanner → common, domain-model
ai-engine → common, domain-model
executor → common, domain-model
ntfs-reader (独立 crate，Windows only)

desktop (Tauri 应用) → 依赖所有 workspace crates
```

## 开发环境配置

### 前置要求

- **Rust**: 1.86+ (`rustc --version`)
- **Node.js**: 20+ (`node --version`)
- **包管理器**: npm 或 pnpm

### 首次设置

```bash
# 1. 克隆项目
git clone <repository-url>
cd DiskRookie

# 2. 安装前端依赖
cd apps/desktop/frontend
npm install
cd ..

# 3. 安装 Tauri CLI（全局）
npm install -g @tauri-apps/cli@latest

# 4. 配置 OAuth 环境变量（可选）
cp .env.example .env
# 编辑 .env 填入你的 OAuth 客户端密钥
```

### 常用开发命令

```bash
# 启动开发模式（自动启动 Rust 后端 + React 前端）
cd apps/desktop
npm run dev

# 仅启动前端开发服务器
cd apps/desktop/frontend
npm run dev

# 构建发布版本
cd apps/desktop
npm run build

# 构建 Windows x86_64 可执行文件
npx tauri build --target x86_64-pc-windows-msvc

# 构建 macOS ARM64 版本
npx tauri build --target aarch64-apple-darwin
```

## 代码风格规范

### Rust 代码规范

项目使用 Workspace 级别的 lint 配置，定义在根目录 `Cargo.toml`：

- `unsafe_code = "warn"` - 警告使用 unsafe 代码
- `unused_imports = "warn"` - 警告未使用的导入
- `dead_code = "warn"` - 警告死代码
- `correctness` lints - deny 级别（必须修复）
- `suspicious`, `complexity`, `perf`, `style` - warn 级别

**Clippy 配置**（`clippy.toml`）：
- 认知复杂度上限：30
- 函数行数警告阈值：200 行
- 类型复杂度上限：300

**提交前检查**：
```bash
# 格式化检查
cargo fmt --all -- --check

# Clippy 检查
cargo clippy --workspace --all-targets -- -D warnings

# 安全检查
cargo audit
```

### 前端代码规范

- **ESLint**: 使用 `@eslint/js` 和 `typescript-eslint`
- **TypeScript**: 严格模式，使用项目引用（project references）
- **TailwindCSS**: 用于样式

**前端检查命令**：
```bash
cd apps/desktop/frontend
npx tsc -b --noEmit      # 类型检查
npm run lint             # ESLint 检查
npx vite build           # 构建测试
```

## 模块说明

### 1. `crates/common` - 通用基础

- `error.rs` - 定义 `DiskAnalyzerError` 错误类型
- `config.rs` - 配置管理
- `telemetry.rs` - 遥测/日志

### 2. `crates/domain-model` - 领域模型

核心数据结构：
- `scan_result.rs` - 扫描结果
- `file_tree.rs` - 文件树结构
- `cleanup_plan.rs` - 清理计划
- `action.rs` - 操作动作定义
- `risk.rs` - 风险等级
- `top_file_entry.rs` - 大文件条目

### 3. `crates/disk-scanner` - 磁盘扫描

高性能文件扫描实现：
- `scanner.rs` - 主扫描逻辑
- `mft_scan.rs` - NTFS MFT 快速扫描（Windows）
- `node.rs` - 文件树节点
- `filters.rs` - 文件过滤逻辑

依赖：`rayon`（并行扫描）、`ntfs-reader`（Windows MFT）

### 4. `crates/ai-engine` - AI 分析

- `planner.rs` - 清理计划生成
- `prompt.rs` - AI 提示词模板
- `validator.rs` - 结果验证

### 5. `crates/executor` - 执行器

- `delete.rs` - 删除操作
- `move.rs` - 移动操作
- `dry_run.rs` - 试运行模式
- `permission.rs` - 权限处理

### 6. `apps/desktop/src-tauri/src/commands` - Tauri 命令

| 模块 | 功能 |
|------|------|
| `scan.rs` | 扫描路径命令 |
| `analyze.rs` | AI 分析命令 |
| `plan.rs` | 获取清理计划 |
| `execute.rs` | 执行清理计划 |
| `delete.rs` | 删除文件/目录 |
| `storage.rs` | 文件系统存储操作 |
| `oauth.rs` | OAuth 认证（Google/Baidu/Aliyun/Dropbox）|
| `cloud_upload.rs` | 云存储上传 |
| `permission.rs` | 管理员权限检查 |

## 数据存储

应用数据存储在用户主目录的 `.disk-rookie` 文件夹中：

```
~/.disk-rookie/
├── settings.json              # AI 设置
├── system-prompt.txt          # AI 系统提示词
├── prompt-instruction.txt     # 用户自定义提示词
├── theme.txt                  # 主题设置
└── snapshots/                 # 快照目录
    ├── index.json             # 快照索引
    └── <snapshot-id>.json     # 快照数据
```

**Windows**: `C:\Users\<用户名>\.disk-rookie\`
**macOS/Linux**: `~/.disk-rookie/`

## CI/CD 流程

### 持续集成 (`.github/workflows/ci.yml`)

每次 push/PR 到 main 分支时触发：

1. **Clippy** - Rust 代码 lint 检查
2. **Rustfmt** - 代码格式化检查
3. **Security Audit** - `cargo audit` 安全检查
4. **Frontend** - TypeScript 类型检查、ESLint、构建测试

**注意**: Linux CI 会将 `ntfs-reader` crate 替换为 stub，因为该 crate 仅支持 Windows。

### 发布流程 (`.github/workflows/release.yml`)

支持三种触发方式：

1. **Commit Message 触发**（推荐）: 包含 `[release]` 标记
   ```bash
   git commit -m "feat: 新增功能 [release]"
   ```

2. **Git Tag 触发**: 推送 `v*` 标签
   ```bash
   git tag -a v0.2.0 -m "Release v0.2.0"
   git push origin v0.2.0
   ```

3. **手动触发**: 通过 GitHub Actions 页面

构建目标：
- Windows x86_64 (MSI 安装包)
- macOS ARM64 (Apple Silicon, DMG)

## 环境变量与配置

### OAuth 配置（`.env` 文件）

```bash
# Google Drive
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx

# 百度网盘
BAIDU_CLIENT_ID=xxx
BAIDU_CLIENT_SECRET=xxx

# 阿里云盘
ALIYUN_CLIENT_ID=xxx
ALIYUN_CLIENT_SECRET=xxx

# Dropbox
DROPBOX_CLIENT_ID=xxx
DROPBOX_CLIENT_SECRET=xxx
```

代码中使用 `option_env!()` 宏读取，未设置时使用空字符串，不会导致编译失败。

### GitHub Secrets（CI/CD 用）

必需：
- `TAURI_PRIVATE_KEY` - Tauri 更新私钥
- `TAURI_KEY_PASSWORD` - 私钥密码

可选（OAuth）：
- `GOOGLE_CLIENT_ID/SECRET`
- `BAIDU_CLIENT_ID/SECRET`
- `ALIYUN_CLIENT_ID/SECRET`
- `DROPBOX_CLIENT_ID/SECRET`

## 版本号管理

版本号遵循语义化版本（SemVer）：
- 主版本号：不兼容的 API 修改
- 次版本号：向下兼容的功能新增
- 修订号：向下兼容的问题修正

**需要同步更新的文件**：
- `apps/desktop/src-tauri/tauri.conf.json` - 主版本号
- `apps/desktop/src-tauri/Cargo.toml` - 保持一致
- `apps/desktop/package.json` - 可选

**注意**: MSI 安装包要求版本号必须是纯数字格式（如 `0.1.0`），不支持预发布后缀（如 `-beta`）。

## 安全注意事项

1. **不要将 `.env` 文件提交到 Git** - 已添加到 `.gitignore`
2. **敏感数据加密** - API Key 等敏感数据建议加密存储（当前版本为明文存储，待改进）
3. **OAuth 安全** - 使用 PKCE 流程，本地回调服务器仅在认证时启动
4. **管理员权限** - 某些操作（如删除系统文件）需要管理员权限，应用会进行检查

## 常见开发任务

### 添加新的 Tauri 命令

1. 在 `apps/desktop/src-tauri/src/commands/` 创建新文件或修改现有文件
2. 在 `mod.rs` 中导出（如需要）
3. 在 `lib.rs` 的 `invoke_handler!` 宏中注册命令
4. 前端通过 `@tauri-apps/api` 调用

### 添加新的 Crate

1. 在 `crates/` 下创建新目录
2. 创建 `Cargo.toml`，注意添加 `[lints] workspace = true`
3. 在根目录 `Cargo.toml` 的 `members` 中添加路径
4. 运行 `cargo check` 验证

### 修改领域模型

1. 在 `crates/domain-model/src/` 修改或添加结构体
2. 确保实现 `Serialize`/`Deserialize`（用于前后端通信）
3. 在 `lib.rs` 中导出

### 调试技巧

```bash
# 查看详细日志
cargo run --release -- --log-level=debug

# 前端调试
# 开发模式下打开浏览器 DevTools (Ctrl+Shift+I)

# 检查构建输出
target/x86_64-pc-windows-msvc/release/bundle/
```

## 参考文档

- `README.md` - 用户-facing 的项目介绍
- `RELEASE.md` - 详细的发布指南
- `STORAGE_MIGRATION.md` - 存储迁移说明
- `docs/` - 其他技术文档

## 社区与支持

- QQ 群：[点击加入](https://qm.qq.com/cgi-bin/qm/qr?k=m_GRedABaOwTCseJQnKi_sjMlS_cIhtx)
- 许可证：Apache License 2.0

## 已验证经验

- 若 `tauri dev/build` 报 `failed to run 'cargo metadata'`，先检查 workspace 成员的 `Cargo.toml` 是否缺失；本仓库曾因 `crates/ntfs-reader/` 为空导致批处理脚本失败。
- Windows 下仅为通过 `cargo metadata` / 依赖解析时，可先补最小 `ntfs-reader` stub crate，后续再替换为真实实现。
- 若 Windows 卷根（如 `C:\`/`D:\`）扫描结果为 `0` 文件，优先检查 `crates/ntfs-reader/src/lib.rs` 是否仍为 stub；stub 的 `iterate_files()` 不返回记录，会让 MFT 扫描“成功但为空”。可在 `crates/disk-scanner/src/mft_scan.rs` 中对空 MFT 结果直接返回错误，让 `scanner.rs` 自动回退普通遍历，避免前端显示 0 文件。
- 快照能力实现约定：统一通过 `saveSnapshot()` 写入快照文件，文件名由扫描路径自动生成为 `[目录名或盘符]_snapshot_YYYYMMDD_HHmmss(.json)`；手动保存与 AI 自动保存都应复用同一入口，避免命名和序列化分叉。
- `snapshotSaveDir` 仅作为运行数据根目录（`~/.disk-rookie`）下的相对目录配置，默认 `snapshots`；设置文案需明确“默认运行目录/snapshots/”语义，减少用户对保存位置的歧义。
- 快照管理右键“打开所在目录”建议通过前端服务统一封装：从 `SnapshotMetadata.file_path`（缺失时回退 `snapshots/<id>.json`）推导目录，再调用 `open_in_file_manager`；对“目录不存在”错误返回可识别结果并在 UI 降级提示，不中断快照加载/删除主流程。
- AI 分析后快照决策建议使用“会话策略 + 当前弹窗默认动作”两层状态：未静默时每次分析弹窗确认；勾选“本进程不再显示”后记住本进程默认动作（保存/不保存）并在后续分析自动执行。`autoSaveAfterAi` 用于每次弹窗的默认动作来源（开=保存，关=不保存），而不是绕过弹窗逻辑。
- 标准模式“AI 原文”面板可直接复用 `latestAiRawText` 状态：分析完成后写入、加载快照时从 `ai_raw_text` 恢复，UI 只需新增独立滚动容器展示即可，不必额外引入存储字段。
- 若 `target/debug` 持续膨胀，优先清理 `target/debug/deps` 下旧 hash 产物（`.rlib/.rmeta/.pdb/.dll` 等）而不只是 `incremental`；可通过 `DISKROOKIE_TARGET_OPT_AGGRESSIVE=1` 或 `run_dev.bat tauri clean` 触发激进清理，脚本会保留每个 crate 的最新 hash 版本以兼顾体积与可重编译性。
- ExpertMode 组件拆分架构：主文件 `ExpertMode.tsx`（~320 行）通过 4 个自定义 Hook + 7 个子组件组合而成。Hook 负责状态和逻辑，子组件负责 UI 渲染。Hook 间循环依赖通过 `useRef` 存储跨 Hook 的 setter 引用来打破（如 `aiSettersRef`/`actionsSettersRef`/`subDirSettersRef`），在所有 Hook 初始化完成后统一赋值。拆分文件清单：
  - **Hooks**: `useExpertModeScan`(扫描)、`useExpertModeAi`(AI 分析)、`useExpertModeSubDir`(子目录分析)、`useExpertModeActions`(操作/选择/批量)
  - **UI 组件**: `ExpertModeToolbar`(路径输入+按钮+三Tab切换+统计)、`AnalysisReportContent`(AI分析报告+建议卡片列表+饼图+AI原文)、`DeveloperModeContent`(Treemap+提示词面板)、`AiPieChart`(饼图)、`FileExplorer`(仿 Windows Explorer 文件浏览器)、`ScanProgressIndicator`(扫描进度)、`AiAnalyzingIndicator`(AI 分析进度)、`ExpertModeDialogs`(弹窗集合)、`AIPromptPanel`(提示词面板)
  - **辅助**: `ExpertMode.types`(类型定义)、`ExpertMode.utils`(工具函数)
- 前端组件拆分时注意：`AnalysisResult` 类型应从 `../services/ai-analysis` 导入而非 `ExpertMode.types`，`ScanResult` 则从 `ExpertMode.types` 导入；`CleanupSuggestion` 是 `AnalysisResult.suggestions` 的元素类型（非 `Suggestion`）；中文文件必须 UTF-8 无 BOM 编码，Windows 下 PowerShell 写入时需显式指定编码。
- H7 扫描与 AI 分析分离架构：`ScanResultBrowser` 组件替代原 `SubDirAnalysisPanel`，实现扫描与 AI 分析解耦。扫描（`onScan`）仅执行 `scanDirectoryTopN`，不自动触发 AI；用户在扫描结果面板中勾选目录/文件后点击"AI 分析"按钮手动触发。`handleSubDirAiAnalyze` 签名改为 `(selectedPaths: string[], scanResult: DirectoryTopNResult)` 以支持勾选后分析。i18n key `aiAnalysis.subDirAnalysis*` 文案从"子目录分析"统一改为"扫描"语义。
- H8 零延迟目录浏览器架构：Rust 后端新增 `list_directory_command`（非递归，仅直接子项，`std::fs::read_dir`）和 `get_directory_size_command`（递归计算目录大小，`spawn_blocking`）；前端 `FileExplorer` 组件仿 Windows Explorer 布局（路径栏+搜索+可排序列表+双击导航+前进后退+右键菜单）；目录大小首次加载显示 `--`，点击或后台异步通过 `getDirectorySize` 计算；`DirectoryListing`/`DirEntry` 结构体定义在 `domain-model` crate 的 `scan_result.rs` 中；右键菜单通过 MUI `Menu` + `anchorPosition` 实现，包含"AI 自动分析"、"询问 AI"、"扫描此目录"、"在文件管理器中打开"、"删除"选项。
- H9 三 Tab 模式重构架构：将 `isAdmin: boolean | null` 状态替换为 `activeTab: 'file-browser' | 'file-summary' | 'analysis-report'`；工具栏从 2 个模式按钮改为 3 个 Tab 按钮（文件浏览📂 / 文件汇总📊 / 分析报告🤖）；扫描完成后默认切换到"文件浏览"Tab，AI 分析完成后自动切换到"分析报告"Tab（通过 `useEffect` 监听 `ai.analysisResult` 从 null 变为有值）；`AnalysisReportContent` 组件复用 `SuggestionCard`（含确认对话框、云存储选择、任务进度、详情弹窗等完整功能），布局为上下结构（AI 摘要+Token → 统计摘要卡片3列 → 饼图 → 建议卡片列表 → AI Agent 日志面板 → 可折叠 AI 原文）；`AgentToolCallLog` 接口预留给 C2 MCP 智能体（toolName/args/result/timestamp），`agentLogs`/`agentRunning` 为可选 props；已移除 `ScanResultBrowser` 和 `StandardModeContent` 组件；i18n 新增 `expertMode.fileBrowser`/`fileSummary`/`analysisReport` 三个 key + `aiAnalysis.processed`/`agentLog`/`agentRunning`/`agentToolCalls`/`agentThinking` 五个 key（中/英/日三语）；`ActiveTab` 类型定义在 `ExpertMode.types.ts` 中。
- H10 分析会话系统架构：新增 `AnalysisSession` 数据模型（id/name/scanPath/createdAt/source/status/analysisResult/latestAiRawText/latestAiPrompt/agentLogs/deletedPaths/addedToSafeListPaths/actionOverrides/统计字段），`AgentToolCallLog` 接口定义在 `ExpertMode.types.ts`；`useAnalysisSessions` Hook 管理会话列表（createSession/switchSession/updateSession/deleteSession/setSessionAnalysisResult/addSuggestionToSession/removeSuggestionFromSession/markPathDeleted/markPathSafeListed/setSessionActionOverride/appendAgentLog/getSessionsForSnapshot/loadSessionsFromSnapshot/clearSessions）；`SessionListPanel` 组件（220px 可折叠，显示会话列表+新建按钮+右键删除，支持折叠为 8px 图标栏）；分析报告 Tab 改为左侧会话列表+右侧报告详情布局；AI 分析完成自动创建会话并切换到分析报告 Tab；`FileExplorer` 新增 `activeSession`/`deletedPathsFromSession`/`safeListPathsFromSession` props，已删除条目显示删除线+灰色+透明度降低，安全名单条目显示🛡️图标；文件浏览右键"删除"操作同步记入活跃会话的 `deletedPaths`；i18n 新增 `session.*` 命名空间（10 个 key）+ `contextMenu.safeListed`（中/英/日三语）；`useExpertModeActions` 新增导出 `setAddedToSafeListPaths`。
- H11 FileExplorer 重构架构：`ExpertModeToolbar` 移除路径输入/扫描按钮（仅保留 Tab 切换+浅层目录开关+批量操作按钮+AI 分析/保存快照按钮）；`FileExplorer` 内嵌路径输入+文件夹选择+扫描/停止按钮；多选交互支持 Shift+Click 范围选择和 Ctrl+Click 多选；右键菜单支持批量"询问 AI"/"AI 自动分析"/"删除"/"加入安全名单"；新增 `useAiTaskQueue` Hook 管理 AI 任务队列（排队/运行/暂停/完成/失败状态，支持暂停/恢复/取消）；新增 `AiOperationPanel` 组件（Dialog 形式，显示当前任务+等待队列+实时日志+完成历史，支持最小化）；AI 简要信息展示：鼠标悬停 600ms 显示悬浮卡片，已分析文件显示 Sparkle 图标+Tooltip，`aiResultCacheRef` 缓存 AI 分析结果；i18n 新增 `aiOperation.*` 命名空间（16 个 key，中/英/日三语）。
- H12 分析报告分组架构：修复建议列表扁平展示 bug，新增 `SuggestionGroup` 类型（parentPath/parentName/suggestions/source）和 `groupSuggestionsByParent()` 工具函数（按 `_parentPath` 分组，`_parentPath` 为空归入顶层组 source:'main'，其余按相同值聚合 source:'subdir'）；`AnalysisReportContent` 用分组渲染替代扁平列表，每组可折叠/展开（`collapsedGroups` 状态，默认全部展开），分组头部显示来源标签（主分析/子目录分析）+建议数量 Badge+父目录路径 Tooltip；子目录分析分组底部新增"AI 进一步分析"和"扫描更多子目录"按钮；AI 进一步分析通过 `onSubDirScan` 触发，新建议自动带 `_parentPath` 归入对应分组；i18n 新增 `suggestion.mainAnalysis`/`subDirAnalysis`/`furtherAnalyze`/`scanMoreSubdir`/`newSuggestion`/`groupSuggestions`（中/英/日三语）。
- H10-4 用户可干预分析架构：`ExpertModeToolbar` AI 分析按钮改为下拉菜单（首次分析直接弹确认对话框，已有分析结果时显示下拉：分析全部/分析选中目录）；新增分析前确认对话框（`confirmDialog` 状态，显示将分析的目录数量和路径）；`SuggestionCard` 新增 `onRemove` prop 和"移除"按钮，支持手动移除不需要的建议；`ExpertMode.tsx` 中 `onRemoveSuggestion` 回调从 `analysisResult.suggestions` 中过滤移除路径并同步更新 `selectedItems`；i18n 新增 `aiAnalysis.analyzeAll`/`analyzeSelected`/`analyzeSelectedNone`/`confirmAnalyzeAllTitle`/`confirmAnalyzeSelectedTitle`/`confirmAnalyzeAllDesc`/`confirmAnalyzeSelectedDesc`/`startAnalysis`/`suggestion.remove`（中/英/日三语）；修复 i18n 缺失 key bug：`contextMenu.delete`/`expertMode.suggestions`/`expertMode.scanCompleteHint`。
- C2-0 用户可干预询问架构：工具栏 AI 下拉菜单新增 `aiAnalysis.deepAnalysis`，在完整 Agent 循环未完成前点击后创建/复用 `source:'agent'` 会话、写入 `agentLogs` 占位并切到分析报告；右键"询问 AI"由 `FileExplorer` 通过 `onAskAi`/`onAskAiMulti` 交给 `ExpertMode` 统一执行，结果展示在独立 `AskAiResultDialog`，显示目标路径、当前会话和 AI 回答；"添加到当前会话"会将回答转换为保守的 `CleanupSuggestion`（默认 `action:'move'`），若无会话则自动创建 `source:'manual'` 会话并切到分析报告；多选询问结果用左侧列表逐条查看并选择性追加。
- C2-1 MCP 只读工具后端约定：`list_directory_command` 保持非递归直接子项查询，最多返回 500 条 `items`，并通过 `DirectoryListing.truncated`/`total_count` 暴露截断信息；`get_directory_size_command` 使用 `spawn_blocking` 内部 `Instant` 检查实现 10 秒软超时，超时时返回已统计部分结果并置 `timed_out:true`；`get_file_info_command` 返回 `{ path, name, size, modified, is_dir, extension, child_count? }`，目录 `child_count` 仅统计直接子项。新增 Tauri 命令必须注册到 `lib.rs` 的 `generate_handler!`，前端统一在 `services/ai-analysis.ts` 暴露类型和 invoke 封装。
- C2-2 前端 MCP 工具执行层：新增 `services/mcp-tools.ts` 作为只读工具统一入口，工具名限定为 `list_directory`/`get_directory_size`/`get_file_info`，内部调用 `services/ai-analysis.ts` 的 Tauri 封装并生成 `AgentToolCallLog`（toolName/args/result/timestamp）；`runInitialMcpInspection(path)` 先调用 `get_file_info`，若目标为目录再顺序调用 `list_directory` 与 `get_directory_size`。`ExpertMode` 的工具栏“AI 深度分析”和 `FileExplorer` 右键“AI 自动分析”复用该初始检查流程，执行期间用本地 `agentRunning` 控制分析报告日志运行态，执行结果追加到当前/新建 `source:'agent'` 会话的 `agentLogs`，C2-3 再接入真实 AI Agent 循环。
- C2-3 AI Agent 循环核心：新增 `services/ai-agent.ts`，直接复用 `ai.ts` 的 Chat Completions 类型与设置加载、`kimi-oauth.ts` 的 Kimi Header 处理、`mcp-tools.ts` 的只读工具执行；使用 `tools + tool_choice:auto` 让模型在最多 6 轮内调用 `list_directory` / `get_directory_size` / `get_file_info`，最终通过 `output_suggestions` 函数一次性输出结构化 `{ summary, suggestions[] }`。`ExpertMode` 中 `runMcpInspectionForSession()` 已切换为真实 `analyzeWithAgent()`，执行期间会清空旧 `agentLogs`、持续追加新工具日志，并把 `analysisResult` / `latestAiRawText` / `latestAiPrompt` / `tokenUsage` 回写到 `source:'agent'` 会话；若达到最大轮次仍未收敛，则返回 `interrupted:true` 和 `continueFromContextHint`。
