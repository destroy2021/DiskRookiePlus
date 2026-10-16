import type { TreemapNode } from './Treemap'
import type { AnalysisResult, CleanupSuggestion } from '../services/ai-analysis'
import type { CloudStorageConfig } from '../services/settings'
import type { Snapshot } from '../services/snapshot'
import type { Task } from '../services/taskQueue'

export interface SuggestionGroup {
    parentPath: string | null
    parentName: string
    suggestions: CleanupSuggestion[]
    source: 'main' | 'subdir'
}

export type AgentToolCallStatus = 'success' | 'failure' | 'rejected'

export interface AgentToolCallLog {
    toolName: string
    args: Record<string, unknown>
    result?: string
    timestamp: number
    status?: AgentToolCallStatus
    durationMs?: number
    truncated?: boolean
    timedOut?: boolean
}

export interface AgentRunProgress {
    turn: number
    maxTurns: number
    currentTool: string | null
    latestSummary: string | null
    suggestionCount: number
}

export interface AnalysisSession {
    id: string
    name: string
    scanPath: string
    createdAt: number
    source: 'manual' | 'agent'
    status: 'analyzing' | 'done' | 'interrupted' | 'failed'
    analysisResult: AnalysisResult | null
    latestAiRawText: string
    latestAiPrompt: string
    agentLogs: AgentToolCallLog[]
    deletedPaths: string[]
    addedToSafeListPaths: string[]
    actionOverrides: [string, 'delete' | 'move'][]
    totalSuggestions: number
    deleteCount: number
    moveCount: number
    totalSize: string
}

export interface TopFileEntry {
    path: string
    size: number
    modified?: number | null
}

export interface SummaryEntry {
    path: string
    name: string
    size: number
    file_count?: number | null
    dir_count?: number | null
    is_dir: boolean
}

export interface ExtensionStat {
    ext: string
    size: number
    count: number
}

export interface ScanResult {
    root: TreemapNode
    scan_time_ms: number
    file_count: number
    total_size: number
    scan_warning?: string | null
    interrupted?: boolean
    volume_total_bytes?: number | null
    volume_free_bytes?: number | null
    top_files?: TopFileEntry[] | null
    top_directories?: SummaryEntry[] | null
    root_children?: SummaryEntry[] | null
    extension_stats?: ExtensionStat[] | null
}

export type ActiveTab = 'file-browser' | 'file-summary' | 'analysis-report'

export type FileCandidate = { path: string; size: number; modified?: number | null }

export type SnapshotDecisionAction = 'save' | 'skip'

export interface PendingAiSnapshotDecision {
    path: string
    scanResult: ScanResult
    summary: string
    aiPrompt: string
    aiRawText: string
    aiStructuredResult: AnalysisResult
    defaultAction: SnapshotDecisionAction
}

export interface ExpertModeProps {
    onOpenSettings?: () => void
    loadedSnapshot?: Snapshot | null
    onSnapshotLoaded?: () => void
    settingsSavedTrigger?: number
    onAddMigrateTask?: (sourcePath: string, fileSize: number, targetConfigs: CloudStorageConfig[], targetPath: string) => string
    onFileDeleted?: (callback: ((path: string) => void) | null) => void
    tasks?: Task[]
}

export const PROMPT_INSTRUCTION_FILE = 'prompt-instruction.txt'
export const FILE_LIST_SUMMARY_CACHE_MAX = 20
export const DEFAULT_PROMPT_INSTRUCTION = '请基于以上磁盘摘要，识别可安全清理或迁移的候选项，并给出简明理由。'
export const SKIP_SAFELIST_CONFIRM_KEY = 'skip-add-to-safelist-confirm'
