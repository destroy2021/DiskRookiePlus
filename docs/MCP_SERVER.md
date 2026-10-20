# DiskRookie MCP Server

`diskrookie-mcp` 将 DiskRookie 的磁盘分析能力以 MCP（Model Context Protocol）工具集暴露，供任意 MCP 客户端（Claude Desktop、DSH 等）以**专业磁盘清理专家**身份使用：精准发现 → 可信建议 → 经用户确认后安全执行。

- 传输：stdio（客户端直接 spawn 二进制）
- 协议：MCP（JSON-RPC 2.0），实现 `initialize` / `tools/list` / `tools/call`
- 实现选型：手写最小 JSON-RPC 2.0 循环（约 150 行）。依据：官方 Rust SDK `rmcp` 传递依赖需拉入 tokio 全家桶（async runtime、transport 等），而本 server 三个方法即覆盖全部需求且工具层是同步 IO；手写依赖更少、与 executor 同步模型一致（设计文档 2.3 节允许二选一）。

## 工具清单（8 个）

### 发现类（只读）

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `disk_list_drives` | 枚举所有盘符及容量/剩余空间 | 无 |
| `disk_scan_cleanable` | 全盘"可清理内容地图"：8 类清理候选聚合（大小/文件数/样本路径/风险等级）。清理工作流起点 | `drives?`（默认全部本地盘）、`categories?` |
| `disk_list_dir` | 枚举目录直接子项（分页下钻，毫秒级；子目录大小用 disk_du） | `path`、`offset?`、`limit?`（默认 200/最大 1000）、`sort?`（size/name/modified，默认 size 降序）、`show_hidden?` |
| `disk_du` | 目录占用分析：子项按大小排名（"大户挖掘"）；卷根自动 MFT 加速 | `path`、`depth?`（默认 1/最大 5）、`shallow_dirs?`、`top_n?`（默认 50/最大 200）、`min_size_bytes?` |
| `disk_search_name` | 名称搜索：fuzzy/glob/regex 三模式；卷根走 MFT（秒级全卷），否则回退 walk，`engine` 字段如实告知 | `root`、`pattern`、`mode?`、`case_sensitive?`、`is_dir?`、`offset?`、`limit?` |

内置清理类别（`disk_scan_cleanable`）：

| id | 内容 | 风险 |
|---|---|---|
| `temp_user` | `%TEMP%`、`%LOCALAPPDATA%\Temp` | 低 |
| `recycle_bin` | 各卷 `$Recycle.Bin` | 低 |
| `browser_cache` | Chrome/Edge/Firefox 的 Cache、Code Cache 目录 | 低 |
| `package_cache` | npm/pip/cargo/gradle/nuget 等缓存目录 | 低 |
| `thumbnails` | 缩略图与图标缓存（thumbcache 等） | 低 |
| `crash_dumps` | `*.dmp`、`%LOCALAPPDATA%\CrashDumps` | 低 |
| `windows_update` | `C:\Windows\SoftwareDistribution\Download` | 中 |
| `old_downloads` | 下载目录中 90 天未修改且 >100MB 的文件 | 中 |

> `node_modules` / `target` / `dist` 等构建产物**刻意不内置**：误删在研项目代价极高，由 AI 用 `disk_du` + `disk_search_name` 主动发现，按高风险流程逐项确认。

### 执行类（必须经用户确认，全部走 executor）

| 工具 | 用途 | 确认协议 |
|---|---|---|
| `disk_read_text` | 读文本片段（取证：日志/配置/README）。前 8KB 二进制嗅探拒绝；UTF-8 优先回退 GBK | 只读无风险 |
| `disk_delete` | 删除文件/目录（目录递归） | `confirm: false`（默认）仅预演零修改；`confirm: true` 真实执行 |
| `disk_move` | 移动到另一目录（同卷 rename / 跨卷复制后删；同名冲突标记 `target_exists`） | 同上 |

**确认两步协议（硬约束）**：每个执行类工具 `confirm` 默认 `false` → 预演返回将被影响的路径与大小预估，零文件系统修改；`confirm: true` 前必须已有用户对该批内容的明确同意。系统关键目录黑名单（`C:\Windows`、`C:\Program Files`、`C:\Program Files (x86)`、`C:\System Volume Information` 及非 Windows 对应项）在 `crates/executor` 单一定义（`FORBIDDEN_PATHS` + `CLEAN_SAFE_EXCEPTIONS` 精确例外：`C:\Windows\Temp`、`C:\Windows\SoftwareDistribution\Download`），MCP server 与桌面应用共用。

## 客户端配置

### Claude Desktop

`claude_desktop_config.json`（Windows: `%APPDATA%\Claude\claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "diskrookie": {
      "command": "C:\\path\\to\\DiskRookie\\target\\debug\\diskrookie-mcp.exe",
      "args": [],
      "env": {}
    }
  }
}
```

### DSH

DSH MCP 连接器（stdio 型）配置：

```json
{
  "mcpServers": {
    "diskrookie": {
      "transport": "stdio",
      "command": "C:\\path\\to\\DiskRookie\\target\\debug\\diskrookie-mcp.exe",
      "args": []
    }
  }
}
```

### 构建与启动

```bash
# 在仓库根目录
cargo build -p diskrookie-mcp

# 发布版路径：target/release/diskrookie-mcp.exe
# 手动冒烟（stdin 按行输入 JSON-RPC）：
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | ./target/debug/diskrookie-mcp.exe
```

> MFT 引擎（`disk_search_name` 卷根加速）需要管理员权限；无权限时自动回退目录 walk，结果以 `engine: "walk"` 如实标注。

## 清理专家工作流（六步）

1. **盘点**：`disk_list_drives` 报告各盘容量与剩余空间，锁定目标盘；
2. **地图**：`disk_scan_cleanable` 拿到分类清理地图；
3. **深挖**（可选）：`disk_du` 挖大户、`disk_search_name` 定位特定模式（如 `*.iso`、`node_modules`）、`disk_read_text` 对可疑文本取证；
4. **建议**：向用户呈现建议表——每项含类别、可释放空间、风险等级、样本路径，按"先低风险高收益"排序；
5. **确认与执行**：用户选定范围 → `disk_delete`/`disk_move` 预演 → 展示预演摘要（共 X 项 Y GB）→ 用户最终同意 → `confirm: true` 执行；
6. **复核**：报告实际释放空间与失败项，必要时复查剩余空间。

交互规则：任何 `confirm: true` 前必须有用户对该批内容的明确同意；严禁把"展示建议"与"执行"合并为一次交互；部分失败如实报告不自动重试；用户拒绝立即停止不劝说。

## 安全模型

1. 确认门槛：写操作无 `confirm: true` 一律预演；
2. 路径黑名单 + 清理安全例外：executor 单一定义，canonicalize 后前缀校验，防 `..\`、符号链接、大小写变体绕过；
3. 输入校验：绝对路径、长度 ≤ 32767、数值参数范围钳制；
4. 资源上限：枚举/搜索/读取强制结果与字节上限，流式处理禁止无界缓存（单类别扫描限时 10 秒）；
5. 零 unsafe（MCP server 内）；MFT 路径复用既有实现；
6. 不涉及任何凭据；MFT 不可用时静默回退并如实告知，不可读位置标 `access_denied`。

## 附录 A：磁盘清理专家系统提示词

以下文本粘贴到 MCP 客户端的 system prompt / 自定义指令中：

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
