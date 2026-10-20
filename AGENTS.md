# AGENTS.md

本文件面向在本仓库工作的 AI 助手与自动化代理，描述项目定位、构建方式、目录约定与必须遵守的红线。

## 项目是什么

DiskRookie（磁盘菜鸟）是一款面向普通用户的桌面磁盘分析工具：用 Rust 高速扫描磁盘占用，由 AI 分析文件用途并给出「删除 / 迁移」建议，再通过一键操作迁移到云存储（Google Drive、OneDrive、阿里云盘、百度网盘、WebDAV/NAS）。

- 技术栈：Rust（核心引擎）+ Tauri（桌面壳）+ React/TypeScript（前端）
- 主目标平台：Windows（`x86_64-pc-windows-msvc`），代码需尽量保持跨平台可编译
- 最低环境：Rust 1.86+、Node.js 20+、npm/pnpm
- 许可：Apache-2.0

## 怎么跑 / 构建

所有桌面端命令在 `apps/desktop` 下执行，不要在仓库根目录跑前端命令。

```bash
# 安装前端依赖
cd apps/desktop/frontend && npm install && cd ..

# 开发模式（同时拉起 Rust 后端与前端热更新）
npm run dev

# 构建安装包（Windows）
npx tauri build --target x86_64-pc-windows-msvc
```

仓库级脚本（Windows）：

- `scripts/dev.bat`：开发启动
- `scripts/build-release.bat`：发布构建

Rust 侧：

```bash
cargo build --workspace
cargo test --workspace
cargo clippy --workspace --all-targets
cargo fmt --all
```

CI：`.github/workflows/ci.yml`（提交前应本地跑通等价的 fmt / clippy / test）；`.github/workflows/release.yml`（发布流程）。

## 目录结构

```
Cargo.toml                 # Rust workspace 与 lints 统一配置
Cargo.lock                 # 必须提交，勿手工编辑
clippy.toml
.env.example               # 环境变量模板，真实 .env 不入库
crates/
  common/                  # 通用工具、错误类型、共享常量
  domain-model/            # 领域模型（扫描结果、文件条目、AI 建议等）
  disk-scanner/            # 扫描引擎，含 examples/ 与 tests/
  ntfs-reader/             # NTFS/MFT 底层读取
  ai-engine/               # AI 分析与建议生成
  executor/                # 文件操作执行（删除/迁移），所有破坏性动作入口
apps/
  desktop/
    frontend/              # React 前端
    src-tauri/             # Tauri 应用与命令层（workspace 成员）
    package.json           # 桌面端开发/构建脚本
  images/                  # 图标生成脚本（Python）
scripts/                   # dev.bat / build-release.bat
docs/                      # 设计文档：ui-spec.md、OAuth、百度网盘、MFT 优化等
figures/                   # README 截图
.github/workflows/         # CI 与发布
```

## 开发约定

### 分层与依赖方向

- 依赖单向流动：`common` → `domain-model` → (`disk-scanner` / `ntfs-reader` / `ai-engine`) → `executor` → `src-tauri`。
- 业务逻辑写在 `crates/*`，`src-tauri` 只做命令注册、参数校验与结果转换。
- 跨 crate 共享的类型统一放 `domain-model`，不要在多个 crate 里重复定义。
- 错误类型统一走 `common`，命令层负责转成可序列化的返回结构。

### Rust

- workspace 统一 lints：`unsafe_code`、`unused_imports`、`dead_code` 均为 warn；clippy `correctness` 为 deny，其余组为 warn。
- `too_many_arguments` 在 workspace 层已 allow（Tauri 命令签名需要）。
- 提交前执行 `cargo fmt --all`，保持与现有风格一致。
- 性能敏感的扫描路径避免不必要克隆，注意 `cloned_instead_of_copied`、`inefficient_to_string`、`needless_pass_by_value` 这几条已开启的 lint。

### 前端

- 使用 TypeScript，遵循 `docs/ui-spec.md` 中的界面规范。
- 新增界面文案与交互前先读 `ui-spec.md`，保持与既有组件风格一致。
- 前后端通过 Tauri command 通信，接口变更需同步更新 Rust 侧命令与前端调用。

### 文档

- 新增云存储接入、OAuth 流程、MFT 扫描优化等改动时，同步更新 `docs/` 下对应文档（`OAUTH_SETUP.md`、`BAIDU_NETDISK_SETUP.md`、`MFT_SCAN_OPTIMIZATION_ANALYSIS.md` 等）。
- 发布相关说明放 `RELEASE.md`，存储结构变更放 `STORAGE_MIGRATION.md`。

## 红线与坑

1. **任何删除或迁移操作都必须经用户显式确认。** AI 只产出建议，不得自动执行破坏性文件操作。所有写操作走 `crates/executor`，不要绕开其在别处直接调用文件系统 API。
2. **不要提交密钥与凭证。** OAuth token、AI API Key、网盘账号信息只通过环境变量注入，参考 `.env.example`；`docs/oauth.html` 为本地回调页，不要写入真实凭据。
3. **`crates/ntfs-reader` 目前不在 workspace `members` 中。** 修改该 crate 时需单独 `cargo build -p ntfs-reader` 或以路径方式验证，不要想当然认为 `cargo test --workspace` 覆盖了它；如需纳入 workspace 应作为显式改动提出。
4. **扫描路径必须能处理百万级文件。** 优先保证内存占用与流式处理，不要在扫描结果上做全量深拷贝或构建无界缓存。
5. **NTFS/MFT 相关代码涉及 `unsafe` 与原始字节解析。** 修改时保持最小 `unsafe` 块并附注释说明不变量，指针偏移与结构体对齐需与文档核对。
6. **`Cargo.lock` 与 `apps/desktop/package-lock.json` 必须提交并保持同步**，不要手工编辑锁文件。
7. **构建产物目标是 Windows MSVC**，涉及平台特定路径分隔符、盘符、权限提升的代码需有回退分支，避免破坏其他平台编译。
8. **`.dsh-jsonc-check.mjs` 与 `.codegraph/` 是工具产物**，不要手动修改其内容；`codegraph.db` 勿提交。
9. **云盘接口多为非官方/受限 API**，改动上传逻辑前先读 `docs/` 中对应厂商文档，限流、分片、断点续传等行为不要随意简化。
10. **提交前自查**：`cargo fmt --all`、`cargo clippy --workspace --all-targets`、`cargo test --workspace`、前端 `npm run build` 全部通过。