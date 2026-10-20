# DiskRookie MCP 工具系统 — 设计方案：AI 磁盘清理专家

> 本文档分两部分：**第 1–8 节**是交给实施 AI 的任务书（设计并实现 MCP server）；**附录 A** 是给使用侧 AI（MCP 客户端中的"磁盘清理专家"角色）的系统提示词，实施完成后随 `docs/MCP_SERVER.md` 一并交付。
>
> 目标：让任意 MCP 客户端（Claude Desktop、DSH 等）中的 AI 以**专业磁盘清理专家**身份工作——精准发现本机可清理的内容，向用户给出可信建议，经用户确认后安全执行。实施前必须通读仓库根目录 `AGENTS.md` 的全部红线。

---

## 1. 目标与场景

DiskRookie（Rust + Tauri + React，`crates/disk-scanner` 含 NTFS MFT 加速）将底层能力以 MCP 工具（stdio transport）暴露，支撑清理专家的三条能力主线：

1. **精准发现**：一次调用拿到全盘"可清理内容地图"（分类聚合），而非让 AI 用通用枚举逐层摸索；
2. **可信建议**：AI 基于地图 + 占用分析 + 文件取证，向用户呈现"清什么、能省多少、有什么风险"；
3. **安全执行**：一切删除/移动走 dry-run 预演 → 用户明确确认 → 执行的门槛，唯一写入口在 `executor`。

典型闭环：用户说"帮我清理 C 盘" → AI 盘点磁盘 → 扫描清理地图 → 呈现建议表 → 用户勾选 → 预演 → 确认 → 执行 → 报告释放空间。

---

## 2. 架构

### 2.1 新增 crate

新增 workspace 成员 **`crates/mcp-server`**（binary crate，产出 `diskrookie-mcp`），stdio transport。必须独立于桌面应用运行（客户端直接 spawn 二进制），不得塞进 `apps/desktop/src-tauri`。根 `Cargo.toml` 的 `workspace.members` 加入该 crate（`crates/ntfs-reader` 保持不在 members 中，红线 3）。

### 2.2 依赖方向（不得破坏现有单向流动）

```
common → domain-model → (disk-scanner / ntfs-reader) → mcp-server
                                            executor ↗ (写操作)
```

- `mcp-server` 依赖 `ai-disk-common`、`ai-disk-domain`、`ai-disk-scanner`、`ai-disk-executor`（path 依赖）。
- **禁止**直接依赖 `ntfs-reader`；MFT 数据一律经 `ai-disk-scanner` 的 `mft_scan` 模块间接复用。
- `crates/executor` 的 `delete_file` / `move_file` 目前为占位实现，本任务落地真实实现，保持"破坏性动作唯一入口在 executor"（红线 1）。

### 2.3 MCP 协议选型

优先官方 Rust SDK **`rmcp`**（stdio）；若传递依赖过重，允许手写最小 JSON-RPC 2.0 stdio 循环（initialize 握手 + `tools/list` + `tools/call` 即可覆盖需求）。二选一，在实施记录中注明依据。

依赖新增许可清单（其余一律不加）：`rmcp`（或手写免依赖）、`regex`、`serde_json`（workspace 应已有）、`encoding_rs`（可选）。glob 模式手写 `*`/`?`/`**` → regex 转换，不引入 `globset`。

---

## 3. 工具清单（8 个）

通用约定：

- 路径参数为字符串绝对路径；server 端统一 `normalize_path` + 存在性校验。
- 输出为 JSON（`tools/call` text content）；错误统一映射 `DiskAnalyzerError` → MCP 错误消息，路径不存在 → `InvalidPath`。
- 枚举/搜索类输出必须带 `truncated: bool` 与 `next_offset: u64|null`。
- 数值参数（limit/offset/max_bytes）做范围钳制，越界取边界值。

### 3.1 发现类（只读）

#### `disk_list_drives`

- 枚举所有盘符/卷及容量。无参数。
- 输出：`{ "drives": [{ "path": "C:\\", "total_bytes": u64, "free_bytes": u64 }] }`
- 锚点：`crates/disk-scanner/src/mft_scan.rs` 的 `get_volume_space_bytes`；盘符遍历 `A`..`Z` 判 `Path::exists() && is_dir()`，勿引入新依赖。

#### `disk_scan_cleanable`（核心新增）

- **用途**：全盘（或指定盘）"可清理内容地图"——按内置类别规则聚合，一次调用给出全部清理候选。这是清理专家的起点工具。
- **输入**：`{ "drives": ["C:\\"], "categories": null }`（`drives` 可选，默认所有本地盘；`categories` 可选，类别 id 过滤）
- **输出**：
  ```json
  {
    "categories": [{
      "id": "browser_cache", "label": "浏览器缓存",
      "total_bytes": 1234567890, "file_count": 4567,
      "locations": ["C:\\Users\\...\\Chrome\\User Data\\Default\\Cache"],
      "risk_level": "low", "sample_paths": ["..."],
      "status": "ok | partial | access_denied"
    }],
    "scan_duration_ms": 1234
  }
  ```
- **内置类别规则表**（静态定义在 `crates/mcp-server` 内；路径经环境变量展开；非 Windows 平台回退空类别而非报错，红线 7）：

  | id | 内容 | 风险 |
  |---|---|---|
  | `temp_user` | `%TEMP%`、`%LOCALAPPDATA%\Temp` | 低 |
  | `recycle_bin` | 各卷 `$Recycle.Bin` | 低 |
  | `browser_cache` | Chrome/Edge/Firefox 的 Cache、Code Cache 目录 | 低 |
  | `package_cache` | npm/pip/cargo/gradle/nuget 等缓存目录 | 低 |
  | `thumbnails` | 缩略图与图标缓存 | 低 |
  | `crash_dumps` | `*.dmp`、`%LOCALAPPDATA%\CrashDumps`、WER 报告 | 低 |
  | `windows_update` | `C:\Windows\SoftwareDistribution\Download` | 中 |
  | `old_downloads` | 下载目录中 90 天未修改且 >100MB 的文件 | 中 |

- **实现**：对每个 location 做受控 walk + 流式累计 size/count（复用 `scanner.rs` 的并行遍历模式）；单类别限时 10 秒，超时置 `status: "partial"`。类别路径固定且数量有限，无需 MFT。`sample_paths` 最多 10 条。
- **刻意不内置** `node_modules` / `target` / `dist` 等构建产物：误删在研项目代价极高，这类内容由 AI 用 `disk_du` + `disk_search_name` 主动发现，按高风险流程逐项确认（见第 4 节）。

#### `disk_list_dir`

- 枚举目录直接子项（"进入目录"即反复调用本工具下钻）。
- 输入：`{ "path": "D:\\data", "offset": 0, "limit": 200, "sort": "size | name | modified", "show_hidden": true }`（`sort` 默认 size 降序；`limit` 默认 200 最大 1000）
- 输出：`{ "path", "entries": [{ "path", "name", "size", "is_dir", "modified" }], "total_matched", "truncated", "next_offset" }`
- 子目录大小不在此计算（保持枚举毫秒级）；大小分析用 `disk_du`，职责分离。
- 锚点：`scanner.rs` 的 `build_tree` 内排序段；`FileNode` 见 `crates/domain-model/src/file_tree.rs`。

#### `disk_du`

- 目录占用分析——各子项按大小排名，清理场景的"大户挖掘"工具。
- 输入：`{ "path": "D:\\projects", "depth": 1, "shallow_dirs": true, "top_n": 50, "min_size_bytes": 0 }`
  （`depth` 默认 1；`shallow_dirs` 语义与主应用一致；`top_n` 默认 50 最大 200；`min_size_bytes` 可选，直接回答"超过 1GB 的有哪些"）
- 输出：`{ "path", "total_size", "items": [{ "path", "name", "size", "is_dir" }], "truncated" }`
- 锚点：直接复用 `scan_path_with_progress(path, None, shallow_dirs, use_mft)`（`scanner.rs:354`），从 `ScanResult.root` 取指定深度排序截断——不写新遍历器。卷根自动享受 MFT 加速。

#### `disk_search_name`

- 高性能名称搜索，fuzzy（子串）/ glob / regex 三模式。
- 输入：`{ "root": "C:\\", "pattern": "*.log", "mode": "fuzzy | glob | regex", "case_sensitive": false, "is_dir": null, "offset": 0, "limit": 100 }`（`limit` 最大 1000）
- 输出：`{ "matches": [{ "path", "name", "size", "is_dir", "modified" }], "total_matched", "truncated", "next_offset", "engine": "mft | walk" }`
- 实现路径：
  1. `root` 为 Windows 卷根 → 复用 `ai-disk-scanner` MFT 全量记录（含 `full_path`/`is_dir`/`size`/`modified`）做模式匹配。若现有公共 API 不暴露"仅枚举记录不建树"入口，在 `disk-scanner` 内新增公共函数（如 `scan_volume_mft_records` 或流式迭代器），**改动限定在 disk-scanner 内，不新增 unsafe，不动 ntfs-reader**。
  2. 非卷根或 MFT 不可用（无管理员权限）→ 回退并行目录 walk（`scanner.rs` 的 `par_iter` 模式）。
  3. `engine` 字段如实告知实际引擎；MFT 路径 `total_matched` 可为 `null` 表示下界。
- 红线：命中达 `offset+limit` 提前终止 walk；流式处理，禁止无界缓存（红线 4）。
- 性能：MFT 路径在百万级文件卷上秒级完成全卷匹配。

#### `disk_read_text`

- 读取文本文件内容（AI 取证用：看日志/配置/README 判断文件用途）。
- 输入：`{ "path": "D:\\notes.txt", "offset_bytes": 0, "max_bytes": 65536 }`（`max_bytes` 默认 64KB，最大 256KB）
- 输出：`{ "content", "encoding": "utf-8 | gbk", "size_bytes", "truncated", "next_offset_bytes" }`
- 约束：前 8KB 二进制嗅探（NUL 字节或不可打印比例过高 → 报错，不提供 hex 预览）；UTF-8 优先（剥 BOM），失败回退 GBK（`encoding_rs`），仍失败报错。只读字节范围，绝不整文件载入。

### 3.2 执行类（必须经确认，全部走 executor）

通用确认协议（写入各工具 description，让调用方 AI 理解）：

- 每个执行类工具都有 `confirm: bool`，**默认 false**。
- `confirm: false` → 仅**预演**：返回将被影响的路径清单与大小预估，**零文件系统修改**。
- `confirm: true` → 真实执行。正确用法：预演 → 展示用户 → 用户同意 → 执行。
- 执行前统一：`fs::canonicalize` → 黑名单前缀校验。黑名单沿用 `apps/desktop/src-tauri/src/commands/delete.rs` 的 `forbidden_paths`，**抽到 `crates/executor` 作为共享常量 `FORBIDDEN_PATHS`**，src-tauri 改为引用（消除双份定义）。

#### `disk_delete`

- 输入：`{ "paths": ["..."], "confirm": false }`（`paths` 1..=50 项；缓存目录可直接传目录路径递归删除，应用会重建）
- 输出：预演 `{ "mode": "dry_run", "items": [{ "path", "exists", "is_dir", "size_bytes", "would_delete": true }] }`；执行 `{ "mode": "executed", "items": [{ "path", "success", "error" }], "freed_bytes": u64 }`
- 锚点：`crates/executor/src/delete.rs` 落地真实实现（逻辑参考 src-tauri delete.rs 迁移）；预演逻辑放 `crates/executor/src/dry_run.rs`。

#### `disk_move`

- 迁移场景保留（DiskRookie 核心是"删除/迁移"建议）：把大文件挪到数据盘/NAS 前的本地移动。
- 输入：`{ "sources": ["..."], "destination_dir": "...", "confirm": false }`
- 约束：目标必须存在且为目录；同名冲突跳过并标记 `skipped_reason: "target_exists"`；同卷 rename 快路径，跨卷先复制后删除（删除失败则报告并保留源，不留半份文件）。
- 锚点：`crates/executor/src/move.rs` 的 `move_file` 占位 → 落地。

### 3.3 相对旧版砍掉的工具

`disk_stat`（`disk_list_dir`/`disk_list_drives` 已覆盖同构元数据）、`disk_read_hex`（清理场景无十六进制取证需求）、`disk_copy`（清理与迁移用不到复制）——不做实现；`disk_list_dir` 的 `include_dir_size` 参数与 `disk_read_text` 的行分页参数一并移除，职责并入 `disk_du` 与字节分页。

---

## 4. 清理专家工作流与用户交互协议

> 本节写入 `docs/MCP_SERVER.md`，与附录 A 配套。交互**不依赖 MCP elicitation**（客户端支持度不一），全部通过"AI 展示建议 → 用户自然语言确认 → AI 调用 `confirm: true`"实现，任何 MCP 客户端可用。

### 4.1 标准工作流（六步）

1. **盘点**：`disk_list_drives` 报告各盘容量与剩余空间，锁定目标盘；
2. **地图**：`disk_scan_cleanable` 拿到分类清理地图；
3. **深挖**（可选）：`disk_du` 挖大户、`disk_search_name` 定位特定模式（如 `*.iso`、`node_modules`）、`disk_read_text` 对可疑文本取证；
4. **建议**：向用户呈现建议表——每项含类别、可释放空间、风险等级、样本路径，并给出推荐顺序（先低风险高收益）；
5. **确认与执行**：用户选定范围 → `disk_delete`/`disk_move` 预演 → 展示预演摘要（共 X 项 Y GB）→ 用户最终同意 → `confirm: true` 执行；
6. **复核**：报告实际释放空间与失败项，必要时复查剩余空间。

### 4.2 交互规则（写入附录 A 并约束 AI 行为）

- **建议与执行分离**：任何 `confirm: true` 调用前，必须存在用户对该批内容的明确同意（勾选、回复"确认/删吧"等）；严禁把"展示建议"与"执行"合并为一次用户交互。
- **风险分级话术**：
  - `low`（缓存/临时/回收站/崩溃转储）：正常推荐，说明"应用首次启动会稍慢"等轻微影响即可；
  - `medium`（Windows 更新残留、旧下载）：说明具体影响（如更新需重新下载），默认不勾选；
  - `high`（构建产物、AI 主动发现的大文件/目录）：必须逐项列出证据（大小、路径、修改时间、内容取证）并单独征询，绝不打包进批量建议。
- **部分失败**：执行结果中失败项如实报告并保留原因，不自动重试、不静默跳过。
- **用户拒绝**：立即停止该批操作，不做劝说式重复建议。

---

## 5. 安全模型（硬约束，写入实现代码与工具 description）

1. **确认门槛**：写操作无 `confirm: true` 一律预演；工具 description 写明两步协议。
2. **路径黑名单 + 清理安全例外**：写操作执行前 canonicalize + 前缀校验 `FORBIDDEN_PATHS`（`C:\Windows`、`C:\Program Files`、`C:\Program Files (x86)`、`C:\System Volume Information` 及非 Windows 对应项），防 `..\`、符号链接、大小写变体绕过。黑名单常量单一定义在 executor。
   为使 `windows_update` 类别可清理，executor 同时维护精确子路径例外 `CLEAN_SAFE_EXCEPTIONS`（仅 `C:\Windows\Temp`、`C:\Windows\SoftwareDistribution\Download`），写操作校验时例外生效；该类别结果仍标 `risk_level: "medium"`，AI 须按中风险流程交互。
3. **输入校验（信任边界）**：路径参数校验绝对路径、长度 ≤ 32767；数值参数范围钳制。
4. **资源上限**：所有枚举/搜索/读取工具强制结果与字节上限，流式处理，禁止无界缓存与全量深拷贝（红线 4）。
5. **不新增 unsafe**：MFT 路径复用现有实现，`mcp-server` 内零 unsafe（红线 5）。
6. **不提交任何凭据**：MCP server 不涉及 OAuth/AI key（红线 2）。
7. **权限诚实**：MFT 不可用时静默回退 walk 并通过 `engine` 字段如实告知，不伪造结果；`$Recycle.Bin` 等不可读位置标 `access_denied`。

---

## 6. 实施步骤

| 步骤 | 内容 | 涉及文件 |
|---|---|---|
| 1 | 根 `Cargo.toml` members 加入 `crates/mcp-server` | `Cargo.toml` |
| 2 | executor：抽共享 `FORBIDDEN_PATHS` + `CLEAN_SAFE_EXCEPTIONS`；落地 `delete_file`、`move_file`；补 dry_run | `crates/executor/src/{delete.rs, move.rs, dry_run.rs, lib.rs}` |
| 3 | disk-scanner：新增 MFT 记录枚举公共入口（仅当现有 API 不足时） | `crates/disk-scanner/src/{mft_scan.rs, lib.rs}` |
| 4 | 新建 `crates/mcp-server`：stdio MCP 循环 + 8 个工具 + 类别规则表 | `crates/mcp-server/*` |
| 5 | src-tauri `delete.rs` 改为引用 executor 共享黑名单（不改命令签名与前端契约） | `apps/desktop/src-tauri/src/commands/delete.rs` |
| 6 | `docs/MCP_SERVER.md`：工具清单、客户端配置示例（Claude Desktop / DSH 的 mcpServers JSON）、启动方式、附录 A 系统提示词 | `docs/MCP_SERVER.md` |

---

## 7. 验收标准

1. `cargo build --workspace`、`cargo clippy --workspace --all-targets`、`cargo test --workspace`、`cargo fmt --all` 全部通过。
2. 前端不受影响：`cd apps/desktop/frontend && npm run build` 通过；src-tauri `delete_item` 命令行为不变。
3. 手动冒烟（MCP 客户端或 `echo JSON | diskrookie-mcp`）：
   - `disk_scan_cleanable` 在本机返回各类别聚合结果；无权限类别标 `access_denied` 而非报错；
   - `disk_list_drives` 返回全部盘符容量；`disk_list_dir` 大目录分页与 `truncated`/`next_offset` 语义正确；
   - `disk_search_name` 在 C:\ 卷根百万级文件下 fuzzy 与 regex 各一次，MFT 引擎秒级；无管理员权限时回退 `engine: "walk"`；
   - `disk_read_text` 验证 UTF-8/GBK 与二进制拒绝；`disk_du` 与主应用扫描结果一致；
   - `disk_delete`/`disk_move`：`confirm: false` 纯预演零副作用；临时目录验证真实执行、`freed_bytes` 正确、`C:\Windows` 下路径被拒、`C:\Windows\Temp` 经例外放行。

---

## 8. 明确不做

- 不做 `disk_stat` / `disk_read_hex` / `disk_copy`（见 3.3），不做 MCP resources/prompts/sampling，只做 tools。
- 不加遥测、日志上传、自动更新。
- 不修改现有 Tauri 命令签名与前端契约（仅 delete.rs 内部改为引用 executor）。
- 不修改 `crates/ntfs-reader` 的 unsafe 逻辑；不将其加入 workspace members。
- 不手工编辑 `Cargo.lock` / `package-lock.json`。
- **不做任何形式的自动删除/移动**（AI 侧或 server 侧定时任务）：破坏性动作只响应显式 `confirm: true` 的单次调用，且此前必须有用户同意记录。

---

## 附录 A：磁盘清理专家系统提示词（交付给 MCP 客户端）

> 以下文本随 `docs/MCP_SERVER.md` 提供，用户粘贴到 MCP 客户端的 system prompt / 自定义指令中。

```text
你是 DiskRookie 磁盘清理专家，通过 diskrookie-mcp 工具帮助用户精准、安全地清理磁盘空间。

## 工作原则
1. 安全第一：任何删除/移动前必须先预演（confirm: false）、向用户展示结果、获得明确同意后再执行（confirm: true）。用户没有明确同意前，绝不执行。
2. 证据说话：每个建议都基于工具返回的真实数据（类别、大小、文件数、样本路径、修改时间），不猜测、不夸大。
3. 建议与执行分离：一次交互只做一件事——要么呈现建议等用户决定，要么根据用户已给出的同意执行。绝不合并。

## 标准流程
1. disk_list_drives 盘点各盘容量与剩余空间，与用户确认清理目标；
2. disk_scan_cleanable 获取分类清理地图；
3. 需要时用 disk_du 挖大户、disk_search_name 定位特定文件、disk_read_text 对可疑文件取证；
4. 呈现建议表：类别 | 可释放空间 | 风险 | 样本路径，按"低风险高收益"排序推荐；
5. 用户选定 → 预演 → 展示摘要（共几项、多少空间）→ 用户确认 → 执行；
6. 报告实际释放空间与失败项。

## 风险分级
- 低（缓存、临时文件、回收站、崩溃转储）：正常推荐，说明轻微影响（应用首次启动稍慢）。
- 中（Windows 更新残留、旧下载）：说明具体影响，默认不勾选，等用户主动选择。
- 高（node_modules/target 等构建产物、你主动发现的大文件）：逐项列出证据（大小、路径、修改时间、内容），单独征询，绝不打包进批量建议。

## 禁止事项
- 不自动执行、不批量默认勾选高风险项、不劝说式重复已被拒绝的建议；
- 部分失败时如实报告，不重试、不静默跳过；
- 不读取与清理无关的个人文件内容；取证只读必要片段。
```
