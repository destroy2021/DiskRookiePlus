# DiskRookie 后续交付流程

## 开发约束（永久）
1. 严格按"单步交付 → 验收通过 → 下一步"执行；未通过不得跨步。
2. 代码遵循"最小、直接、可维护"：最少代码与依赖、函数单一职责、避免过度抽象，仅保留核心异常处理。
3. 每步必须可验收（UI行为 + 文件结果 + 构建结果）；验收日志仅临时开启，阶段收口统一关闭。
4. 所有新增和修改文件统一使用 UTF-8 编码。
5. 开始实现前先阅读 `AGENTS.md`（若存在）；任务完成后将可复用经验提炼写回 `AGENTS.md`。
6. **代码拆分约束**：按职责提取子组件、自定义 Hook、工具函数等到独立文件；避免单文件承担过多 UI 渲染逻辑。

## 执行节奏
1. 人工发现的问题为最高优先级，必须先于后续进度执行。
2. 每完成一个步骤，必须先更新本文档进度记录，再进行验收。
3. 每个步骤验收通过后必须暂停，并向需求方确认：`是否进行下一个进度点`；未确认不得继续。
4. 若当前步骤验收失败，只允许在当前步骤内修复并重验，不得跳步。

---

## 已完成代码核查结果

### 已确认完成并从待执行任务移除

1. **H10/H11/H12/H10-Step4 基础能力已完成**
   - 会话系统、`SessionListPanel`、会话快照字段、分析报告分组、FileExplorer 多选和 AI 任务队列均已有实现。
   - AI 分析按钮已支持"分析全部/分析选中目录"下拉菜单和分析前确认对话框。
   - 建议卡片已支持手动移除。
   - AI 分析中断入口已存在，`AnalysisResult.interrupted` 可保留已返回结果。

2. **H8/C2 可复用后端查询工具已部分完成**
   - `list_directory_command` 已注册并可列出目录直接子项。
   - `get_directory_size_command` 已注册并可递归统计目录大小、文件数、目录数。
   - `DirectoryListing` / `DirEntry` / `DirectorySizeResult` 数据模型已存在。

### 核查后仍需执行

1. `get_file_info` 后端命令尚未实现。
2. `list_directory` 尚未按 MCP 场景增加单次最多 500 条的显式限制与截断标记。
3. `get_directory_size` 尚未实现 MCP 场景要求的 10 秒超时控制。
4. 前端尚未实现真正的 AI Agent tool_call 循环。
5. 右键"AI 自动分析"目前只有入口回调，尚未接入 `source: 'agent'` 会话与 Agent 循环。
6. "询问 AI"已有入口与队列基础，但尚未实现弹窗展示、当前会话名称展示、"添加到当前会话"按钮和建议追加闭环。
7. 工具栏菜单尚未包含独立的"AI 深度分析"入口。

---

## 待执行任务

### C2-0. 补齐用户可干预分析遗留项

**目标**：在进入完整 MCP Agent 前，先补齐 H10-4 中尚未落地的用户可干预能力，避免后续 Agent 逻辑和普通询问逻辑混杂。

1. 工具栏 AI 分析下拉菜单新增"AI 深度分析"入口。
2. 点击"AI 深度分析"时创建或复用当前分析会话，并进入 C2 Agent 分析流程入口；在 C2 未完成前可先展示明确的未启用提示或禁用态。
3. 实现"询问此目录/文件"对话框：展示 AI 回答、目标路径、当前会话名称。
4. "询问此目录/文件"对话框底部新增"添加到当前会话"按钮，将 AI 回答转换为 `CleanupSuggestion` 并追加到当前 `AnalysisSession`。
5. 多选"询问 AI"完成后可逐条查看结果，并支持选择性追加到当前会话。
6. 若当前没有会话，追加建议前自动创建 `source: 'manual'` 会话并切换到分析报告 Tab。

验收：
1. AI 分析下拉菜单包含"分析全部/分析选中目录/AI 深度分析"。
2. "询问此目录/文件"弹窗显示当前会话名称和 AI 回答。
3. 点击"添加到当前会话"后，分析报告中立即出现新增建议。
4. 没有会话时可自动创建会话并追加建议。
5. 前端 `npx tsc -b --noEmit`、`npm run lint`、`npx vite build` 通过。

---

### C2-1. MCP Tools 后端补齐与安全限制

**目标**：形成只读、受限、可观测的本地磁盘查询工具集，为前端 Agent 循环提供稳定接口。

1. 调整 `list_directory_command`：
   - 单次最多返回 500 条直接子项。
   - 返回结果增加 `truncated: boolean` 和 `total_count?: number`，便于 UI/Agent 判断是否截断。
   - 保持非递归，只允许查询直接子项。

2. 调整 `get_directory_size_command`：
   - 增加 10 秒超时控制。
   - 返回结果包含 `timed_out: boolean`，超时时返回已统计的部分结果或明确错误。
   - 保持只读，不修改文件系统。

3. 新增 `get_file_info_command`：
   - 参数：`path: string`。
   - 返回：`{ path, name, size, modified, is_dir, extension, child_count? }`。
   - 目录的 `child_count` 仅统计直接子项数量，不递归。

4. 前端 `services/ai-analysis.ts` 增加对应类型和调用封装。
5. Tauri `invoke_handler` 注册新增命令。

验收：
1. 三个工具均可从前端调用，返回结构稳定。
2. `list_directory` 对超过 500 条目录返回截断标记。
3. `get_directory_size` 超时不会卡死 UI。
4. Rust `cargo check` 通过。
5. 前端 `npx tsc -b --noEmit` 通过。

---

### C2-2. 前端 MCP Tool 执行层

**目标**：在不直接耦合 UI 的情况下，提供统一的 Tool Registry 和执行器，供 Agent 循环调用。

1. 新增或拆分 `agentTools` 执行层，统一定义可用工具：
   - `list_directory`
   - `get_directory_size`
   - `get_file_info`

2. 为每个工具定义：
   - 名称、描述、参数 schema、结果摘要格式化函数。
   - 入参校验，拒绝空路径和无效工具名。

3. 执行器统一返回：
   - `ok: boolean`
   - `toolName`
   - `args`
   - `result` 或 `error`
   - `summary`
   - `timestamp`

4. 将每次执行结果转换为 `AgentToolCallLog`，追加到当前会话。
5. 工具执行层仅调用只读 Tauri 命令，不包含删除/移动/写入能力。

验收：
1. 单独调用工具执行层可以得到结果摘要。
2. 错误路径、未知工具名、空参数均有可识别错误。
3. Agent 日志面板能展示工具名、参数和结果摘要。
4. 前端 `npx tsc -b --noEmit`、`npm run lint` 通过。

---

### C2-3. AI Agent 循环核心

**目标**：让 AI 在受限轮次内自主调用 MCP Tools 浏览目录，并生成最终分析报告。

1. 新增 `useDiskAgent` Hook 或等价拆分模块，管理 Agent 状态：
   - `idle` / `running` / `stopping` / `done` / `failed` / `interrupted`
   - 当前轮次、当前工具、实时文本、错误信息。

2. Agent 启动流程：
   - 用户右键目录选择"AI 自动分析"或工具栏点击"AI 深度分析"。
   - 创建 `source: 'agent'` 的 `AnalysisSession`。
   - 初始 prompt 包含目标路径、工具定义、安全限制、输出格式要求。

3. Tool call 循环：
   - 最多 20 轮 tool_call。
   - 每轮解析 AI 返回的工具调用请求。
   - 调用 C2-2 工具执行层。
   - 将工具结果回传给 AI 继续推理。
   - 每轮追加 `session.agentLogs` 并实时刷新 UI。

4. 终止条件：
   - AI 返回最终结构化分析结果。
   - 达到最大轮次。
   - 用户点击停止。
   - 单次工具调用失败次数超过阈值。

5. 完成后将最终结果写入当前会话：
   - `analysisResult`
   - `latestAiRawText`
   - `latestAiPrompt`
   - `status`
   - 自动切换到"分析报告" Tab。

验收：
1. 右键"AI 自动分析"可创建 Agent 会话并开始执行。
2. Agent 日志面板实时显示 tool_call。
3. 最多 20 轮后必定停止，不出现无限遍历。
4. 点击停止后会话状态为 `interrupted`，已产生日志和部分结果保留。
5. 前端 `npx tsc -b --noEmit`、`npm run lint`、`npx vite build` 通过。

---

### C2-4. Agent 安全控制与可观测性收口

**目标**：让 Agent 行为对用户透明、可停止、可追踪，并保证只读安全边界。

1. 增加总分析超时 5 分钟。
2. Agent 运行期间 UI 显示：
   - 当前正在调用的工具。
   - 当前轮次 / 最大轮次。
   - 已发现的候选清理项数量。
   - 最近一次工具结果摘要。

3. 分析报告页 Agent 日志面板增强：
   - 展示工具调用状态（执行中/成功/失败）。
   - 支持折叠长参数和长结果。
   - 明确显示截断、超时、失败。

4. 停止分析按钮在工具栏、FileExplorer AI 操作面板、分析报告页均能触发同一取消逻辑。
5. 明确只读工具白名单，任何非白名单工具调用都拒绝执行并写入日志。

验收：
1. 超时、停止、超轮次都能安全结束 Agent。
2. UI 能持续观察 Agent 正在做什么。
3. 非白名单工具调用不会执行。
4. 前端 `npx tsc -b --noEmit`、`npm run lint`、`npx vite build` 通过。

---

### C2-5. 快照与会话持久化验收

**目标**：确保普通分析、询问 AI、Agent 分析生成的会话数据都能被快照保存和恢复。

1. 检查快照保存中的 `sessions` 字段是否包含：
   - `source: 'manual' | 'agent'`
   - `status`
   - `agentLogs`
   - `analysisResult`
   - `latestAiRawText`
   - `latestAiPrompt`
   - `deletedPaths`
   - `addedToSafeListPaths`
   - `actionOverrides`

2. 加载快照后恢复：
   - 会话列表。
   - 当前会话分析报告。
   - Agent 日志。
   - 已删除/安全名单/动作覆盖状态。

3. 兼容旧快照：没有 `sessions` 字段时继续从旧 AI 字段创建 legacy 会话。

验收：
1. 保存快照文件实际包含 Agent 会话和日志。
2. 重启或重新加载快照后，会话列表和报告内容一致。
3. 旧快照仍可加载。
4. 前端 `npx tsc -b --noEmit`、`npm run lint`、`npx vite build` 通过。

---

## 统一验收闸门
1. 前端：`npx tsc -b --noEmit`、`npm run lint`、`npx vite build`
2. 涉及 Rust 时：`cargo check` 通过
3. 功能验收：以"界面行为变化 + 快照文件实际内容"为准
4. 失败回滚：当前步未通过，不进入下一步

---

## 进度记录

| 步骤 | 状态 | 完成日期 | 变更摘要 | 验收结论 |
|------|------|----------|----------|----------|
| H10-Step1 | ✅ 已完成 | 2026-04-21 | 会话数据模型+SessionListPanel+FileExplorer联动+useAnalysisSessions Hook | tsc+lint+build 通过 |
| H10-Step2 | ✅ 已完成 | 2026-04-21 | SuggestionCard两行布局重构（完整路径+大小+时间+操作按钮行） | tsc+lint+build 通过 |
| H10-Step3 | ✅ 已完成 | 2026-04-21 | 快照系统升级：Snapshot/saveSnapshot新增sessions字段，schema_version→4，保存时序列化会话，加载时向后兼容旧版 | tsc+lint+build 通过 |
| H11 | ✅ 已完成 | 2026-04-22 | FileExplorer重构：工具栏合并+多选+AI操作队列+信息展示 | tsc+lint+build 通过 |
| H12 | ✅ 已完成 | 2026-04-22 | 分析报告分组：建议树形分组+AI进一步分析+手动操作兼容 | tsc+lint+build 通过 |
| H10-Step4 | ✅ 已完成 | 2026-04-22 | AI分析下拉菜单（分析全部/分析选中目录）+分析前确认对话框+手动移除建议+i18n bug修复 | tsc+lint+build 通过 |
| C2-0 | ✅ 已完成 | 2026-05-14 | 工具栏新增 AI 深度分析入口；右键询问 AI 接入弹窗，展示目标路径/当前会话/AI 回答；支持多选结果逐条查看并选择性追加到当前或自动创建的 manual 会话；深度分析暂创建 agent 占位会话并提示后续 C2 启用 | tsc+lint+build 通过 |
| C2-1 | ✅ 已完成 | 2026-05-14 | MCP 只读后端工具补齐：list_directory 限制 500 条并返回 truncated/total_count；get_directory_size 增加 10 秒超时与 timed_out；新增 get_file_info 命令和前端 getFileInfo 封装 | cargo check+tsc 通过 |
| C2-2 | ✅ 已完成 | 2026-05-14 | 前端 MCP Tool 执行层：新增 services/mcp-tools.ts，统一封装 list_directory/get_directory_size/get_file_info，生成 AgentToolCallLog；AI 深度分析和右键 AI 自动分析接入初始只读检查并展示工具日志 | tsc+lint+build 通过 |
| C2-3 | ✅ 已完成 | 2026-05-14 | AI Agent 循环核心：新增 services/ai-agent.ts，基于 chat completions tools 多轮调用只读工具，支持 output_suggestions 结构化收敛；深度分析/右键 AI 自动分析接入会话、日志、原文、提示词与 tokenUsage 回写 | tsc+lint+build 通过 |
| C2-4 | 待执行 | - | Agent 安全控制与可观测性收口 | - |
| C2-5 | 待执行 | - | 快照与会话持久化验收 | - |
