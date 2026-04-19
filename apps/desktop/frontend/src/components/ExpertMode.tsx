import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { showNotification } from '../services/notification'
import { Folder, Cpu, MessageSquare, Copy, CheckCircle2, AlertCircle, Settings, Clock, FileStack, HardDrive, Sparkles, Save, Cloud, Play, Shield } from 'lucide-react'
import { Button, TextField, Typography, Fade, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Slider, Box, FormHelperText, Checkbox, FormControlLabel } from '@mui/material'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Treemap, type TreemapNode } from './Treemap'
import { formatBytes, formatDuration } from '../utils/format'
import { loadSettings, resolveEffectiveApiKey } from '../services/ai'
import { analyzeWithAI, deleteItem, type AnalysisResult } from '../services/ai-analysis'
import { SuggestionCard } from './SuggestionCard'
import { saveSnapshot, type Snapshot } from '../services/snapshot'
import { readStorageFile, writeStorageFile } from '../services/storage'
import { loadAppSettings, saveAppSettings, getEnabledCloudStorageConfigs, CLOUD_STORAGE_PROVIDERS, type CloudStorageConfig } from '../services/settings'
import { loadSafeListPaths, isPathInSafeList, addToSafeList } from '../services/safeList'
import { CloudStorageSelector } from './CloudStorageSelector'
import type { Task } from '../services/taskQueue'

interface TopFileEntry {
    path: string
    size: number
    modified?: number | null
}

interface SummaryEntry {
    path: string
    name: string
    size: number
    file_count?: number | null
    dir_count?: number | null
    is_dir: boolean
}

interface ExtensionStat {
    ext: string
    size: number
    count: number
}

interface ScanResult {
    root: TreemapNode
    scan_time_ms: number
    file_count: number
    total_size: number
    scan_warning?: string | null
    volume_total_bytes?: number | null
    volume_free_bytes?: number | null
    top_files?: TopFileEntry[] | null
    top_directories?: SummaryEntry[] | null
    root_children?: SummaryEntry[] | null
    extension_stats?: ExtensionStat[] | null
}

const PROMPT_INSTRUCTION_FILE = 'prompt-instruction.txt'
const FILE_LIST_SUMMARY_CACHE_MAX = 20
const fileListSummaryCache = new Map<string, string>()

function buildSummaryCacheKey(result: ScanResult, fileCount: number): string {
    return [
        result.scan_time_ms,
        result.file_count,
        result.total_size,
        result.root.path || result.root.name || '',
        result.top_files?.length ?? 0,
        result.top_directories?.length ?? 0,
        result.root_children?.length ?? 0,
        result.extension_stats?.length ?? 0,
        fileCount,
    ].join('|')
}

function normalizeScanPath(p: string): string {
  const trimmed = p.trim()
  if (!trimmed) return trimmed

  if (trimmed.startsWith('/')) return trimmed

  if (/^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('\\\\')) {
    const normalized = trimmed.replace(/\//g, '\\')
    if (/^[A-Za-z]:$/.test(normalized)) return normalized + '\\'
    return normalized
  }

  return trimmed
}

function buildDefaultSnapshotName(path: string): string {
  const pathParts = path.split(/[/\\]/).filter(Boolean)
  const source = pathParts[pathParts.length - 1] || 'snapshot'
  const ts = new Date().toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${source} - ${ts}`
}

const DEFAULT_PROMPT_INSTRUCTION = '请基于以上磁盘摘要，识别可安全清理或迁移的候选项，并给出简明理由。'
const SKIP_SAFELIST_CONFIRM_KEY = 'skip-add-to-safelist-confirm'

async function loadPromptInstruction(): Promise<string> {
    try {
        const stored = await readStorageFile(PROMPT_INSTRUCTION_FILE)
        return stored || DEFAULT_PROMPT_INSTRUCTION
    } catch { return DEFAULT_PROMPT_INSTRUCTION }
}

async function savePromptInstruction(instruction: string): Promise<void> {
    try {
        await writeStorageFile(PROMPT_INSTRUCTION_FILE, instruction)
    } catch {
        // ignore storage errors
    }
}

function AIPromptPanel({ result }: { result: ScanResult }) {
    const { t } = useTranslation()
    const [fileListSummary, setFileListSummary] = useState('')
    const [instruction, setInstruction] = useState(DEFAULT_PROMPT_INSTRUCTION)
    const [copied, setCopied] = useState(false)
    const PROMPT_FILE_COUNT_MIN = 20
    const PROMPT_FILE_COUNT_MAX = 2000
    const [fileCount, setFileCount] = useState(100)
    const summaryDepsKey = `${result.scan_time_ms}|${result.file_count}|${result.total_size}|${result.root.path || result.root.name}|${result.top_files?.length ?? 0}|${result.top_directories?.length ?? 0}|${result.root_children?.length ?? 0}|${result.extension_stats?.length ?? 0}|${fileCount}`

    useEffect(() => {
        let cancelled = false
        loadAppSettings().then(s => {
            if (!cancelled) {
                const count = Math.min(PROMPT_FILE_COUNT_MAX, Math.max(PROMPT_FILE_COUNT_MIN, s.promptFileCount))
                setFileCount(count)
            }
        })
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        if (fileCount >= PROMPT_FILE_COUNT_MIN && fileCount <= PROMPT_FILE_COUNT_MAX) {
            loadAppSettings().then(s => void saveAppSettings({ ...s, promptFileCount: fileCount }))
        }
    }, [fileCount])

    useEffect(() => {
        let cancelled = false

        
        buildFileListSummary(result, fileCount).then(summary => {
            
            if (!cancelled) {
                setFileListSummary(summary)
            }
        })
        return () => {
            cancelled = true
        }
    }, [summaryDepsKey, fileCount, result])

    useEffect(() => {
        loadPromptInstruction().then(setInstruction)
    }, [])

    useEffect(() => {
        void savePromptInstruction(instruction)
    }, [instruction])

    const copy = useCallback(() => {
        const fullPrompt = fileListSummary + '\n' + instruction
        void navigator.clipboard.writeText(fullPrompt).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }, [fileListSummary, instruction])

    return (
        <div className="flex flex-col p-6 gap-6 bg-white dark:bg-gray-800 rounded-3xl h-full animate-in fade-in duration-500">
            <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                            <MessageSquare size={20} />
                        </div>
                        <div>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: 'secondary.main' }}>{t('aiAnalysis.suggestionGeneration')}</Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('aiAnalysis.dataReady')}</Typography>
                        </div>
                    </div>
                    <Button
                        onClick={copy}
                        variant="contained"
                        size="small"
                        startIcon={copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                        sx={{
                            borderRadius: '10px',
                            px: 3,
                            py: 0.9,
                            textTransform: 'none',
                            bgcolor: copied ? '#4caf50' : 'primary.main',
                            color: '#1A1A1A',
                            fontWeight: 700,
                            fontSize: '12px',
                            boxShadow: 'none',
                            '&:hover': {
                                bgcolor: copied ? '#45a049' : 'primary.dark',
                                color: '#1A1A1A',
                            }
                        }}
                    >
                        {copied ? t('common.copied') : t('common.copyAll')}
                    </Button>
                </div>
                <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover', borderRadius: '12px', border: '1px solid', borderColor: 'divider' }} className="dark:!bg-gray-700/30 dark:!border-gray-600">
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {t('aiAnalysis.tableRows')}
                        </Typography>
                        <TextField
                            size="small"
                            value={fileCount}
                            onChange={(e) => {
                                const raw = e.target.value.replace(/\D/g, '')
                                if (raw === '') {
                                    setFileCount(PROMPT_FILE_COUNT_MIN)
                                    return
                                }
                                const v = parseInt(raw, 10)
                                if (!isNaN(v)) {
                                    const clamped = Math.min(PROMPT_FILE_COUNT_MAX, Math.max(PROMPT_FILE_COUNT_MIN, v))
                                    setFileCount(clamped)
                                }
                            }}
                            inputProps={{
                                inputMode: 'numeric',
                                style: { textAlign: 'right', fontSize: '12px', fontWeight: 700, width: 56 },
                            }}
                            sx={{
                                '& .MuiInputBase-root': { fontSize: '12px' },
                                '& input': { py: 0.5, fontVariantNumeric: 'tabular-nums' },
                            }}
                        />
                    </Box>
                    <Slider
                        min={PROMPT_FILE_COUNT_MIN}
                        max={PROMPT_FILE_COUNT_MAX}
                        step={10}
                        value={Math.min(PROMPT_FILE_COUNT_MAX, Math.max(PROMPT_FILE_COUNT_MIN, fileCount))}
                        onChange={(_, value) => setFileCount(value as number)}
                        sx={{ 
                            color: 'primary.main',
                            height: 4,
                            '& .MuiSlider-thumb': {
                                width: 14,
                                height: 14,
                            },
                            '& .MuiSlider-track': {
                                height: 4,
                            },
                            '& .MuiSlider-rail': {
                                height: 4,
                            },
                        }}
                        marks={[
                            { value: PROMPT_FILE_COUNT_MIN, label: '20' },
                            { value: 500, label: '500' },
                            { value: 1000, label: '1000' },
                            { value: PROMPT_FILE_COUNT_MAX, label: '2000' },
                        ]}
                    />
                    <FormHelperText sx={{ fontSize: '10px', m: 0, mt: 0.5, color: 'text.secondary' }}>
                        {t('aiAnalysis.controlTableRows', { count: result.file_count })}
                    </FormHelperText>
                </Box>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-400 dark:text-gray-400 uppercase tracking-widest ml-1">{t('aiAnalysis.diskUsageSummary')}</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-gray-700/50 rounded-2xl p-4 border border-slate-100 dark:border-gray-600 flex-1 overflow-y-auto min-h-0 thin-scrollbar" style={{ maxHeight: '100%' }}>
                        <pre className="text-xs text-slate-600 dark:text-gray-300 font-mono leading-relaxed whitespace-pre-wrap">{fileListSummary}</pre>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-gray-400 uppercase tracking-widest ml-1">{t('aiAnalysis.customPrompt')}</span>
                    <TextField
                        multiline fullWidth value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder={t('aiAnalysis.inputPrompt')}
                        sx={{
                            flex: 1,
                            '& .MuiInputBase-root': {
                                height: '100%',
                                borderRadius: '20px',
                                bgcolor: 'background.paper',
                                fontSize: '14px',
                                '& fieldset': {
                                    borderColor: 'divider',
                                },
                                '&:hover fieldset': {
                                    borderColor: 'primary.main',
                                },
                                '&.Mui-focused fieldset': {
                                    borderColor: 'primary.main',
                                },
                            },
                            '& textarea': {
                                height: '100% !important',
                                color: 'text.primary',
                            },
                            '& .MuiInputBase-input::placeholder': {
                                color: 'text.secondary',
                                opacity: 0.6,
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    )
}

function displayPath(raw: string): string {
    return raw.replace(/^\\\\\?\\/, '')
}

function formatCount(n: number): string {
    return n.toLocaleString('zh-CN')
}

function formatModified(ts: number | undefined | null): string {
    if (ts == null) return '-'
    try {
        const d = new Date(ts * 1000)
        return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    } catch {
        return '-'
    }
}

function normalizeExtLabel(ext: string): string {
    if (!ext || ext === '[no_ext]') return '(无扩展名)'
    return ext.startsWith('.') ? ext : `.${ext}`
}

function mdEscape(text: string): string {
    return text.replace(/\|/g, '\\|')
}

function mdTable(headers: string[], rows: string[][]): string {
    const header = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`
    if (rows.length === 0) return `${header}\n| (无数据) | - | - |`
    const body = rows.map((r) => `| ${r.map(mdEscape).join(' | ')} |`).join('\n')
    return `${header}\n${body}`
}

type FileCandidate = { path: string; size: number; modified?: number | null }

function collectFallbackSummary(root: TreemapNode): {
    topDirectories: SummaryEntry[]
    rootChildren: SummaryEntry[]
    extensionStats: ExtensionStat[]
    topFiles: FileCandidate[]
} {
    const topDirectories: SummaryEntry[] = []
    const extAgg = new Map<string, { size: number; count: number }>()
    const countByPath = new Map<string, { files: number; dirs: number }>()
    const topFiles: FileCandidate[] = []

    function walk(node: TreemapNode, isRoot: boolean, depth: number): { files: number; dirs: number } {
        if (depth > 20) return { files: 0, dirs: 0 }
        if (!node.is_dir) {
            const extRaw = node.path?.split('.').pop() ?? ''
            const ext = node.path?.includes('.') ? `.${extRaw.toLowerCase()}` : '[no_ext]'
            const agg = extAgg.get(ext) ?? { size: 0, count: 0 }
            agg.size += node.size
            agg.count += 1
            extAgg.set(ext, agg)
            topFiles.push({ path: node.path || node.name, size: node.size, modified: node.modified ?? null })
            return { files: 1, dirs: 0 }
        }

        let files = 0
        let dirs = 0
        for (const child of node.children ?? []) {
            const childCount = walk(child, false, depth + 1)
            files += childCount.files
            dirs += childCount.dirs
            if (child.is_dir) dirs += 1
        }
        countByPath.set(node.path || node.name, { files, dirs })

        if (!isRoot) {
            topDirectories.push({
                path: node.path || node.name,
                name: node.name,
                size: node.size,
                file_count: files,
                dir_count: dirs,
                is_dir: true,
            })
        }
        return { files, dirs }
    }

    walk(root, true, 0)

    const rootChildren = (root.children ?? []).map((child) => {
        const c = countByPath.get(child.path || child.name) ?? { files: 0, dirs: 0 }
        return {
            path: child.path || child.name,
            name: child.name,
            size: child.size,
            file_count: child.is_dir ? c.files : undefined,
            dir_count: child.is_dir ? c.dirs : undefined,
            is_dir: child.is_dir,
        } as SummaryEntry
    })

    const extensionStats = Array.from(extAgg.entries()).map(([ext, value]) => ({
        ext,
        size: value.size,
        count: value.count,
    }))

    topDirectories.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))
    rootChildren.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))
    extensionStats.sort((a, b) => b.size - a.size || b.count - a.count)
    topFiles.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))

    return { topDirectories, rootChildren, extensionStats, topFiles }
}

async function buildFileListSummary(result: ScanResult, fileCount?: number): Promise<string> {
    if (fileCount === undefined) {
        const settings = await loadAppSettings()
        fileCount = settings.promptFileCount
    }

    const count = Math.max(20, fileCount)
    const cacheKey = buildSummaryCacheKey(result, count)
    const cached = fileListSummaryCache.get(cacheKey)
    if (cached) {
        return cached
    }
    let fallback: ReturnType<typeof collectFallbackSummary> | null = null
    const getFallback = () => {
        if (fallback == null) fallback = collectFallbackSummary(result.root)
        return fallback
    }

    const topDirectories = result.top_directories && result.top_directories.length > 0
        ? result.top_directories
        : getFallback().topDirectories
    const rootChildren = result.root_children && result.root_children.length > 0
        ? result.root_children
        : getFallback().rootChildren
    const extensionStats = result.extension_stats && result.extension_stats.length > 0
        ? result.extension_stats
        : getFallback().extensionStats
    const topFileCandidates: FileCandidate[] = result.top_files && result.top_files.length > 0
        ? result.top_files.map((n) => ({ path: n.path, size: n.size, modified: n.modified ?? null }))
        : getFallback().topFiles

    const safeList = await loadSafeListPaths()
    const topFiles = topFileCandidates
        .filter((n) => !isPathInSafeList(n.path, safeList))
        .slice(0, count)

    const scanPath = displayPath(result.root.path || result.root.name || '-')
    const overview = [
        '[磁盘分析摘要]',
        `扫描路径: ${scanPath}`,
        `总大小: ${formatBytes(result.total_size)}`,
        `文件数: ${formatCount(result.file_count)}`,
        `卷容量: ${result.volume_total_bytes && result.volume_total_bytes > 0 ? formatBytes(result.volume_total_bytes) : '-'}`,
        `剩余空间: ${result.volume_free_bytes && result.volume_free_bytes > 0 ? formatBytes(result.volume_free_bytes) : '-'}`,
    ].join('\n')

    const rootChildrenTable = mdTable(
        ['路径', '大小', '类型'],
        rootChildren.slice(0, 10).map((n) => [
            displayPath(n.path),
            formatBytes(n.size),
            n.is_dir ? '目录' : '文件',
        ])
    )

    const topDirsTable = mdTable(
        ['路径', '大小', '文件数'],
        topDirectories.slice(0, 20).map((n) => [
            displayPath(n.path),
            formatBytes(n.size),
            n.file_count != null ? formatCount(n.file_count) : '-',
        ])
    )

    const topFilesTable = mdTable(
        ['路径', '大小', '修改时间'],
        topFiles.map((n) => [
            displayPath(n.path),
            formatBytes(n.size),
            formatModified(n.modified),
        ])
    )

    const extTable = mdTable(
        ['扩展名', '总大小', '文件数'],
        extensionStats.slice(0, 20).map((n) => [
            normalizeExtLabel(n.ext),
            formatBytes(n.size),
            formatCount(n.count),
        ])
    )

    const summary = [
        overview,
        '## 一级分布 Top 10',
        rootChildrenTable,
        '## 最大目录 Top 20',
        topDirsTable,
        `## 最大文件 Top ${count}`,
        topFilesTable,
        '## 扩展名聚合 Top 20',
        extTable,
    ].join('\n\n')
    fileListSummaryCache.set(cacheKey, summary)
    if (fileListSummaryCache.size > FILE_LIST_SUMMARY_CACHE_MAX) {
        const oldestKey = fileListSummaryCache.keys().next().value
        if (oldestKey) fileListSummaryCache.delete(oldestKey)
    }
    return summary
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

export function ExpertMode({ onOpenSettings, loadedSnapshot, onSnapshotLoaded, settingsSavedTrigger, onAddMigrateTask, onFileDeleted, tasks = [] }: ExpertModeProps) {
    const { t } = useTranslation()
    const isTauriRuntime = typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: { metadata?: unknown } }).__TAURI_INTERNALS__?.metadata)
    const [path, setPath] = useState('')
    const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
    const [errorMsg, setErrorMsg] = useState('')
    const [result, setResult] = useState<ScanResult | null>(null)
    const [isAdmin, setIsAdmin] = useState<boolean | null>(false)
    const [hoverNode, setHoverNode] = useState<TreemapNode | null>(null)
    const [progressFiles, setProgressFiles] = useState(0)
    const [, setProgressMessage] = useState('')
    const [viewMode, setViewMode] = useState<'disk' | 'ai-prompt'>('disk')
    const [shallowDirs, setShallowDirs] = useState(true)
    const openedSettingsForStandardRef = useRef(false)

    const [aiAnalyzing, setAiAnalyzing] = useState(false)
    const [aiProgress, setAiProgress] = useState('')
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
    const [latestSummary, setLatestSummary] = useState('')
    const [latestAiPrompt, setLatestAiPrompt] = useState('')
    const [latestAiRawText, setLatestAiRawText] = useState('')
    const [deletedPaths, setDeletedPaths] = useState<Set<string>>(new Set())
    const [actionFilter, setActionFilter] = useState<'all' | 'delete' | 'move'>('all')
    const [hoveredPieIndex, setHoveredPieIndex] = useState<number | null>(null)
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
    const [actionOverrides, setActionOverrides] = useState<Map<string, 'delete' | 'move'>>(new Map())

    const [showSaveDialog, setShowSaveDialog] = useState(false)
    const [snapshotName, setSnapshotName] = useState('')

    const [safeListDialog, setSafeListDialog] = useState<{ open: boolean; path: string | null; dontRemind: boolean }>({ open: false, path: null, dontRemind: false })
    const [addedToSafeListPaths, setAddedToSafeListPaths] = useState<Set<string>>(new Set())

    const [showCloudSelector, setShowCloudSelector] = useState(false)
    const [availableConfigs, setAvailableConfigs] = useState<CloudStorageConfig[]>([])
    const [selectedMigrationConfigs, setSelectedMigrationConfigs] = useState<CloudStorageConfig[]>([])
    const [migrationTargetNames, setMigrationTargetNames] = useState<string>('')

    useEffect(() => {
        if (!isTauriRuntime) return
        let unlistenProgress: (() => void) | undefined
        let unlistenMftStatus: (() => void) | undefined
        getCurrentWindow().listen<[number, string]>('scan-progress', (ev) => {
            setProgressFiles(ev.payload[0])
            if (ev.payload[1]) setProgressMessage(ev.payload[1])
        })
            .then((fn) => { unlistenProgress = fn })
        getCurrentWindow().listen<[string, boolean]>('scan-mft-status', (ev) => {
            const [path, usedMft] = ev.payload
            if (usedMft) {
                console.log('[DiskRookie] 本次扫描已使用 MFT 加速，路径:', path)
            } else {
                console.log('[DiskRookie] 本次扫描未使用 MFT（普通目录遍历），路径:', path)
            }
        }).then((fn) => { unlistenMftStatus = fn })
        return () => {
            unlistenProgress?.()
            unlistenMftStatus?.()
        }
    }, [isTauriRuntime])

    const runAiAnalysis = useCallback(async (scanResult: ScanResult) => {
        setAiAnalyzing(true)
        setAiProgress(t('aiAnalysis.preparing'))
        try {
            const appSettings = await loadAppSettings()
            const aiSettings = await loadSettings()
            if (!(await resolveEffectiveApiKey(aiSettings))?.trim()) {
                throw new Error('Please configure API key in settings first.')
            }
            const summary = await buildFileListSummary(scanResult, appSettings.promptFileCount)
            setLatestSummary(summary)
            const aiResult = await analyzeWithAI(summary, (msg) => setAiProgress(msg))
            setAnalysisResult(aiResult)
            setLatestAiPrompt(aiResult.promptText ?? '')
            setLatestAiRawText(aiResult.rawText ?? '')
            const suggestionCount = aiResult.suggestions.length
            const notificationBody = suggestionCount > 0
                ? t('aiAnalysis.foundSuggestions', { count: suggestionCount })
                : aiResult.summary || t('aiAnalysis.noSuggestions')
            await showNotification(t('aiAnalysis.complete'), notificationBody)
            if (appSettings.autoSaveAfterAi === true && path.trim()) {
                const autoSnapshotName = buildDefaultSnapshotName(path)
                await saveSnapshot({
                    name: autoSnapshotName,
                    path,
                    scanResult,
                    summary,
                    ai_prompt: aiResult.promptText ?? '',
                    ai_raw_text: aiResult.rawText ?? '',
                    ai_structured_result: aiResult,
                })
                await showNotification(t('snapshot.saveSuccess'), t('snapshot.savedSnapshot', { name: autoSnapshotName }))
            }
        } catch (aiError) {
            setErrorMsg(`${t('aiAnalysis.failed')}: ${aiError}`)
            await showNotification(t('aiAnalysis.failed'), String(aiError))
        } finally {
            setAiAnalyzing(false)
            setAiProgress('')
        }
    }, [path, t])

    const runScan = useCallback(async (targetPath: string) => {
        if (!targetPath) return
        const pathToScan = normalizeScanPath(targetPath)
        setStatus('scanning'); setErrorMsg(''); setResult(null); setProgressFiles(0); setProgressMessage(''); setAnalysisResult(null); setLatestSummary(''); setLatestAiPrompt(''); setLatestAiRawText(''); setActionFilter('all'); setActionOverrides(new Map());
        try {
            const appSettings = await loadAppSettings()
            const useMft = appSettings.useMftScan !== false
            const res = await invoke<ScanResult>('scan_path_command', { path: pathToScan, shallowDirs, useMft })
            setResult(res); setStatus('done');
        } catch (e) {
            setStatus('error'); setErrorMsg(String(e));
        }
    }, [shallowDirs])

    const handleBrowseFolder = useCallback(async () => {
        const selected = await open({ directory: true, multiple: false });
        if (selected) {
            const pathStr = typeof selected === 'string' ? selected : selected[0];
            setPath(pathStr); await runScan(pathStr);
        }
    }, [runScan])

    const switchViewMode = useCallback((next: 'disk' | 'ai-prompt') => {
        if (viewMode === next) return
        setViewMode(next)
    }, [viewMode])

    const handleDelete = useCallback(async (itemPath: string) => {
        await deleteItem(itemPath)
        setDeletedPaths(prev => new Set([...prev, itemPath]))
        setSelectedItems(prev => {
            const next = new Set(prev)
            next.delete(itemPath)
            return next
        })
    }, [])

    const handleSelectChange = useCallback((path: string, selected: boolean) => {
        setSelectedItems(prev => {
            const next = new Set(prev)
            if (selected) {
                next.add(path)
            } else {
                next.delete(path)
            }
            return next
        })
    }, [])

    const handleToggleAction = useCallback((path: string, currentAction: 'delete' | 'move') => {
        setActionOverrides(prev => {
            const next = new Map(prev)
            const newAction = currentAction === 'delete' ? 'move' : 'delete'
            next.set(path, newAction)
            return next
        })
    }, [])

    const getActualAction = useCallback((path: string, originalAction: 'delete' | 'move'): 'delete' | 'move' => {
        return actionOverrides.get(path) || originalAction
    }, [actionOverrides])

    const handleAddToSafeListClick = useCallback(async (itemPath: string) => {
        const skipConfirm = await readStorageFile(SKIP_SAFELIST_CONFIRM_KEY)
        if (skipConfirm === 'true') {
            await addToSafeList(itemPath)
            setAddedToSafeListPaths((prev) => new Set([...prev, itemPath]))
            return
        }
        setSafeListDialog({ open: true, path: itemPath, dontRemind: false })
    }, [])

    const handleSafeListConfirm = useCallback(async () => {
        const { path: itemPath, dontRemind } = safeListDialog
        if (!itemPath) {
            setSafeListDialog({ open: false, path: null, dontRemind: false })
            return
        }
        await addToSafeList(itemPath)
        setAddedToSafeListPaths((prev) => new Set([...prev, itemPath]))
        if (dontRemind) {
            await writeStorageFile(SKIP_SAFELIST_CONFIRM_KEY, 'true')
        }
        setSafeListDialog({ open: false, path: null, dontRemind: false })
    }, [safeListDialog])

    const parseSizeToBytes = (sizeStr: string): number => {
        const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i)
        if (!match) return 0
        
        const value = parseFloat(match[1])
        const unit = match[2].toUpperCase()
        
        const units: Record<string, number> = {
            'B': 1,
            'KB': 1024,
            'MB': 1024 * 1024,
            'GB': 1024 * 1024 * 1024,
            'TB': 1024 * 1024 * 1024 * 1024,
        }
        
        return Math.floor(value * (units[unit] || 1))
    }

    const handleSelectAll = useCallback(() => {
        if (!analysisResult) return
        
        const allPaths = analysisResult.suggestions
            .filter(s => !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path))
            .filter(s => {
                const actualAction = getActualAction(s.path, s.action)
                return actionFilter === 'all' || actualAction === actionFilter
            })
            .map(s => s.path)
        
        const allSelected = allPaths.every(p => selectedItems.has(p))
        if (allSelected) {
            setSelectedItems(new Set())
        } else {
            setSelectedItems(new Set(allPaths))
        }
    }, [analysisResult, deletedPaths, addedToSafeListPaths, actionFilter, selectedItems, getActualAction])

    const handleMove = useCallback(async (itemPath: string, configs?: CloudStorageConfig[], targetPath?: string, fileSize?: number) => {
        const targetConfigs = configs || selectedMigrationConfigs
        const cloudPath = targetPath || '/'

        if (!targetConfigs || targetConfigs.length === 0) {
            throw new Error('No cloud storage target selected')
        }

        if (onAddMigrateTask) {
            const size = fileSize || 0
            onAddMigrateTask(itemPath, size, targetConfigs, cloudPath)
            return
        }

        console.log('迁移文件到云存储:', { itemPath, targetConfigs, cloudPath })

        const { refreshGoogleToken } = await import('../services/settings')

        const uploadConfigs = []
        for (const config of targetConfigs) {
            if (!config.accessToken) {
                throw new Error(`${config.name} is not logged in. Please configure cloud storage in settings.`)
            }

            let accessToken = config.accessToken

            if (config.tokenExpiry) {
                const expiryBuffer = 5 * 60 * 1000
                if (config.tokenExpiry - Date.now() < expiryBuffer) {
                    if (!config.refreshToken) {
                        throw new Error(`${config.name} login expired. Please sign in again.`)
                    }
                    console.log(`刷新 ${config.name} 的 token...`)
                    try {
                        const newTokens = await refreshGoogleToken(config.refreshToken)
                        accessToken = newTokens.access_token
                    } catch (e) {
                        throw new Error(`${config.name} token 刷新失败: ${e}`)
                    }
                }
            }

            uploadConfigs.push({
                provider: config.provider,
                name: config.name,
                access_token: accessToken,
                target_path: cloudPath,
            })
        }

        interface UploadResult {
            success: boolean
            provider: string
            file_id: string | null
            message: string
        }

        const results = await invoke<UploadResult[]>('upload_to_cloud', {
            filePath: itemPath,
            configs: uploadConfigs,
        })

        const failed = results.filter(r => !r.success)
        if (failed.length > 0) {
            throw new Error(failed.map(r => r.message).join('\n'))
        }

        console.log('锟较达拷锟缴癸拷:', results)
    }, [selectedMigrationConfigs, onAddMigrateTask])

    const handleBatchExecute = useCallback(async () => {
        if (selectedItems.size === 0 || !analysisResult) return
        
        const itemsToProcess = analysisResult.suggestions.filter(s => 
            selectedItems.has(s.path) && !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path)
        )

        const hasMoveItems = itemsToProcess.some(item => {
            const actualAction = getActualAction(item.path, item.action)
            return actualAction === 'move'
        })
        if (hasMoveItems && selectedMigrationConfigs.length === 0) {
            const configs = await getEnabledCloudStorageConfigs()
            setAvailableConfigs(configs)
            setShowCloudSelector(true)
            return
        }
        
        let successCount = 0
        let failCount = 0

        for (const item of itemsToProcess) {
            try {
                const actualAction = getActualAction(item.path, item.action)
                if (actualAction === 'delete') {
                    await handleDelete(item.path)
                    successCount++
                } else if (actualAction === 'move') {
                    const fileSize = parseSizeToBytes(item.size)
                    await handleMove(item.path, selectedMigrationConfigs, '/', fileSize)
                    successCount++
                }
            } catch (err) {
                console.error(`处理 ${item.path} 失败:`, err)
                failCount++
            }
        }

        if (failCount === 0) {
            showNotification(t('batch.executeComplete'), t('batch.successCount', { count: successCount }))
        } else {
            showNotification(t('batch.executeComplete'), t('batch.successAndFailed', { success: successCount, failed: failCount }))
        }
        
        setSelectedItems(new Set())
    }, [selectedItems, analysisResult, deletedPaths, addedToSafeListPaths, handleDelete, handleMove, selectedMigrationConfigs, getActualAction, t])

    // 保存快照
    const handleSaveSnapshot = useCallback(() => {
        if (!result || !path) return
        setSnapshotName(buildDefaultSnapshotName(path))
        setShowSaveDialog(true)
    }, [result, path])

    const handleConfirmSaveSnapshot = useCallback(async () => {
        if (!result || !path || !snapshotName.trim()) return

        try {
            const appSettings = await loadAppSettings()
            const summary = latestSummary || await buildFileListSummary(result, appSettings.promptFileCount)
            await saveSnapshot({
                name: snapshotName.trim(),
                path,
                scanResult: result,
                summary,
                ai_prompt: latestAiPrompt,
                ai_raw_text: latestAiRawText,
                ai_structured_result: analysisResult,
            })
            setShowSaveDialog(false)
            setSnapshotName('')
            showNotification(t('snapshot.saveSuccess'), t('snapshot.savedSnapshot', { name: snapshotName.trim() }))
        } catch (e) {
            showNotification(t('snapshot.saveFailed'), String(e))
        }
    }, [result, path, snapshotName, latestSummary, latestAiPrompt, latestAiRawText, analysisResult, t])

    const handleSetMigrationTarget = useCallback(async () => {
        const configs = await getEnabledCloudStorageConfigs()
        setAvailableConfigs(configs)
        setShowCloudSelector(true)
    }, [])

    const handleCloudStorageSelected = useCallback((configs: CloudStorageConfig[]) => {
        setSelectedMigrationConfigs(configs)
        setShowCloudSelector(false)

        if (configs.length === 0) {
            setMigrationTargetNames('')
        } else if (configs.length === 1) {
            const providerInfo = CLOUD_STORAGE_PROVIDERS.find(p => p.id === configs[0].provider)
            setMigrationTargetNames(providerInfo?.name || configs[0].provider)
        } else {
            setMigrationTargetNames(`${configs.length} 个云存储`)
        }
    }, [])

    useEffect(() => {
        if (!loadedSnapshot) return

        setPath(loadedSnapshot.path)
        setResult(loadedSnapshot.scanResult)
        setStatus('done')
        setAnalysisResult(loadedSnapshot.ai_structured_result ?? null)
        setLatestSummary(loadedSnapshot.summary ?? '')
        setLatestAiPrompt(loadedSnapshot.ai_prompt ?? '')
        setLatestAiRawText(loadedSnapshot.ai_raw_text ?? '')
        setDeletedPaths(new Set())
        setActionFilter('all')
        setActionOverrides(new Map())

        onSnapshotLoaded?.()
    }, [loadedSnapshot, onSnapshotLoaded])

    const [standardModeNoApi, setStandardModeNoApi] = useState(false)

    const getTaskForPath = useCallback((filePath: string): Task | undefined => {
        return tasks.find(task => task.sourcePath === filePath && (task.status === 'pending' || task.status === 'uploading'))
    }, [tasks])

    useEffect(() => {
        if (onFileDeleted) {
            const handleFileDeleted = (path: string) => {
                setDeletedPaths(prev => new Set([...prev, path]))
                setSelectedItems(prev => {
                    const next = new Set(prev)
                    next.delete(path)
                    return next
                })
            }
            onFileDeleted(handleFileDeleted)
            return () => {
                onFileDeleted(null)
            }
        }
    }, [onFileDeleted])

    useEffect(() => {
        if (isAdmin === false) {
            loadSettings().then(async settings => {
                const key = await resolveEffectiveApiKey(settings)
                setStandardModeNoApi(!key?.trim())
            })
        }
    }, [isAdmin, settingsSavedTrigger])

    useEffect(() => {
        if (isAdmin === false && onOpenSettings && !openedSettingsForStandardRef.current && standardModeNoApi) {
            openedSettingsForStandardRef.current = true
            onOpenSettings()
        }
    }, [isAdmin, onOpenSettings, standardModeNoApi])

    return (
        <div className="flex-1 flex flex-col gap-6 p-2 min-h-0 text-slate-800 dark:text-gray-200 font-sans">
            <div className="space-y-3 shrink-0">
                <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-600 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[260px] relative">
                        <Folder className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-400 pointer-events-none z-10" size={16} />
                        <TextField
                            fullWidth size="small" value={path}
                            onChange={(e) => setPath(e.target.value)}
                            placeholder={t('expertMode.inputOrSelectPath')}
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: '12px', pl: '32px', fontSize: '13px',
                                    bgcolor: (theme) => theme.palette.mode === 'dark' ? '#374151' : '#F3F4F6',
                                    color: (theme) => theme.palette.mode === 'dark' ? '#f3f4f6' : 'inherit',
                                    '& fieldset': { borderColor: 'transparent' },
                                    '&.Mui-focused fieldset': { borderColor: 'primary.main' },
                                    '&:hover': {
                                        bgcolor: (theme) => theme.palette.mode === 'dark' ? '#4b5563' : undefined,
                                    },
                                    '& input::placeholder': { opacity: (theme) => theme.palette.mode === 'dark' ? 0.6 : 1, color: (theme) => theme.palette.mode === 'dark' ? '#9ca3af' : 'inherit' },
                                }
                            }}
                        />
                    </div>
                    <div className="flex gap-1.5">
                        <Button
                            onClick={handleBrowseFolder}
                            disabled={standardModeNoApi}
                            variant="outlined"
                            size="small"
                            startIcon={<Folder size={14} />}
                            sx={{
                                borderRadius: '10px',
                                px: 2,
                                py: 0.9,
                                color: 'primary.main',
                                borderColor: 'primary.main',
                                textTransform: 'none',
                                fontWeight: 600,
                                fontSize: '12px',
                                '&:hover': {
                                    bgcolor: 'primary.main',
                                    color: '#1A1A1A',
                                    borderColor: 'primary.main',
                                }
                            }}
                        >
                            {t('expertMode.selectFolder')}
                        </Button>
                        <Button
                            onClick={() => runScan(path)}
                            disabled={status === 'scanning' || standardModeNoApi || !path}
                            variant="contained"
                            size="small"
                            sx={{
                                borderRadius: '10px', px: 3, py: 0.9, bgcolor: 'primary.main', color: '#1A1A1A',
                                fontWeight: 700, fontSize: '12px', textTransform: 'none', boxShadow: 'none',
                                '&:hover': { bgcolor: 'primary.dark', color: '#1A1A1A' }
                            }}
                        >
                            {status === 'scanning' ? t('expertMode.scanning') : t('expertMode.startScan')}
                        </Button>
                        {result && status === 'done' && isAdmin === false && (
                            <Button
                                onClick={() => void runAiAnalysis(result)}
                                disabled={aiAnalyzing || standardModeNoApi}
                                variant="outlined"
                                size="small"
                                startIcon={<Sparkles size={14} />}
                                sx={{
                                    borderRadius: '10px',
                                    px: 2,
                                    py: 0.9,
                                    color: 'primary.main',
                                    borderColor: 'primary.main',
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    fontSize: '12px',
                                    '&:hover': {
                                        bgcolor: 'primary.main',
                                        color: '#1A1A1A',
                                        borderColor: 'primary.main',
                                    }
                                }}
                            >
                                {aiAnalyzing ? t('aiAnalysis.analyzing') : t('aiAnalysis.start')}
                            </Button>
                        )}
                        {result && status === 'done' && isAdmin && (
                            <Tooltip title={t('snapshot.saveSnapshot')} arrow>
                                <Button
                                    onClick={handleSaveSnapshot}
                                    variant="outlined"
                                    size="small"
                                    startIcon={<Save size={14} />}
                                    sx={{
                                        borderRadius: '10px',
                                        px: 2,
                                        py: 0.9,
                                        color: 'primary.main',
                                        borderColor: 'primary.main',
                                        textTransform: 'none',
                                        fontWeight: 600,
                                        fontSize: '12px',
                                        '&:hover': {
                                            bgcolor: 'primary.main',
                                            color: '#1A1A1A',
                                            borderColor: 'primary.main',
                                        }
                                    }}
                                >
                                    {t('snapshot.saveSnapshot')}
                                </Button>
                            </Tooltip>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200/80 dark:border-gray-600 bg-slate-50/50 dark:bg-gray-700/30">
                        <label className="flex items-center gap-2 cursor-pointer group w-fit select-none">
                            <div className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${shallowDirs ? 'bg-primary border-primary' : 'border-slate-300 dark:border-gray-500'}`}>
                                {shallowDirs && <CheckCircle2 size={10} className="text-secondary" />}
                            </div>
                            <input type="checkbox" className="hidden" checked={shallowDirs} onChange={(e) => setShallowDirs(e.target.checked)} />
                            <span className="text-[11px] font-medium text-slate-500 dark:text-gray-400 group-hover:text-secondary">{t('expertMode.shallowDirs')}</span>
                        </label>
                        <div className="w-px h-5 bg-slate-200 dark:bg-gray-600 shrink-0" aria-hidden />
                        <div className="bg-slate-200/50 dark:bg-gray-600/50 p-0.5 rounded-lg flex gap-0.5 border border-slate-200/80 dark:border-gray-600">
                            <button
                                onClick={() => setIsAdmin(false)}
                                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${!isAdmin ? 'bg-white dark:bg-gray-600 text-secondary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}
                            >
                                {t('expertMode.standardMode')}
                            </button>
                            <button
                                onClick={() => setIsAdmin(true)}
                                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${isAdmin ? 'bg-secondary text-primary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}
                            >
                                {t('expertMode.developerMode')}
                            </button>
                        </div>
                    </div>
                    {result && (() => {
                        const stats = [
                            { label: t('expertMode.processTime'), val: formatDuration(result.scan_time_ms), Icon: Clock },
                            { label: t('expertMode.totalFiles'), val: result.file_count.toLocaleString(), Icon: FileStack },
                            { label: t('expertMode.diskUsage'), val: formatBytes(result.total_size), Icon: HardDrive },
                            ...(result.volume_total_bytes != null && result.volume_total_bytes > 0
                                ? [{ label: t('expertMode.volumeCapacity'), val: formatBytes(result.volume_total_bytes), Icon: HardDrive }]
                                : [])
                        ]
                        const tooltipTitle = stats.map(({ label, val }) => `${label}: ${val}`).join(' · ')
                        return (
                            <div className="flex flex-col items-end gap-1">
                                {result.scan_warning && (
                                    <span className="text-amber-600 dark:text-amber-400 text-xs font-medium" title={result.scan_warning}>
                                        {t('expertMode.scanHasError')}
                                    </span>
                                )}
                                <div className="flex items-center gap-2">
                                {analysisResult && (() => {
                                    const visibleItems = analysisResult.suggestions
                                        .filter(s => !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path))
                                        .filter(s => actionFilter === 'all' || s.action === actionFilter)
                                    if (visibleItems.length === 0) return null
                                    const allSelected = visibleItems.every(s => selectedItems.has(s.path))
                                    return (
                                        <Button
                                            onClick={handleSelectAll}
                                            variant="outlined"
                                            size="small"
                                            sx={{
                                                borderRadius: '10px',
                                                px: 1.5,
                                                py: 0.8,
                                                color: 'primary.main',
                                                borderColor: 'primary.main',
                                                fontWeight: 700,
                                                fontSize: '11px',
                                                textTransform: 'none',
                                                '&:hover': {
                                                    bgcolor: 'primary.main',
                                                    color: '#1A1A1A',
                                                    borderColor: 'primary.main',
                                                }
                                            }}
                                        >
                                            {allSelected ? t('common.deselectAll') : t('common.selectAll')}
                                        </Button>
                                    )
                                })()}
                                {selectedItems.size > 0 && (
                                    <Button
                                        onClick={handleBatchExecute}
                                        variant="contained"
                                        size="small"
                                        startIcon={<Play size={14} />}
                                        sx={{
                                            borderRadius: '10px',
                                            px: 2,
                                            py: 0.8,
                                            bgcolor: 'primary.main',
                                            color: '#1A1A1A',
                                            fontWeight: 700,
                                            fontSize: '11px',
                                            textTransform: 'none',
                                            boxShadow: 'none',
                                            '&:hover': {
                                                bgcolor: 'primary.dark',
                                                boxShadow: 'none',
                                            }
                                        }}
                                    >
                                        {t('common.execute')} ({selectedItems.size})
                                    </Button>
                                )}
                                <Tooltip title={tooltipTitle} arrow placement="bottom">
                                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200/80 dark:border-gray-600 bg-slate-50/50 dark:bg-gray-700/30 cursor-default">
                                        {stats.map(({ label, val, Icon }, idx) => (
                                            <span key={label} className="flex items-center gap-2">
                                                {idx > 0 && <div className="w-px h-5 bg-slate-200 dark:bg-gray-600 shrink-0" aria-hidden />}
                                                <Icon size={14} className="text-slate-400 dark:text-gray-400 shrink-0" />
                                                <span className="text-[11px] dark:text-gray-300 font-semibold text-secondary tabular-nums">{val}</span>
                                            </span>
                                        ))}
                                    </div>
                                </Tooltip>
                                </div>
                            </div>
                        )
                    })()}
                </div>

                <Fade in={status === 'error' || standardModeNoApi}>
                    <div className="space-y-2">
                        {status === 'error' && (
                            <div className="flex items-center gap-3 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl border border-red-100 dark:border-red-800 text-sm">
                                <AlertCircle size={16} />
                                <span className="font-medium">{errorMsg}</span>
                            </div>
                        )}
                        {standardModeNoApi && (
                            <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-xl border border-amber-100 dark:border-amber-800 text-sm">
                                <div className="flex items-center gap-2">
                                    <Settings size={16} />
                                    <span className="font-medium">{t('expertMode.needApiConfig')}</span>
                                </div>
                                <Button size="small" onClick={onOpenSettings} sx={{ fontWeight: 600, fontSize: '11px', color: 'inherit', textDecoration: 'underline', minWidth: 'auto', px: 1 }}>
                                    {t('common.goSettings')}
                                </Button>
                            </div>
                        )}
                    </div>
                </Fade>
            </div>

            {status === 'scanning' && (
                <div className="p-10 flex flex-col items-center justify-center gap-4 animate-in zoom-in-95 duration-500">
                    <div className="relative">
                        <Cpu className="text-primary animate-pulse" size={48} />
                        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                    </div>
                    <div className="text-center">
                        <Typography variant="h4" sx={{ fontWeight: 900, color: 'secondary.main' }}>{progressFiles.toLocaleString()}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 2 }}>{t('expertMode.processedFiles')}</Typography>
                    </div>
                    <div className="flex gap-1 h-2">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div
                                key={i}
                                className="w-4 h-full bg-primary rounded-sm animate-pulse"
                                style={{ animationDelay: `${i * 0.1}s`, animationDuration: '1.2s' }}
                            />
                        ))}
                    </div>
                </div>
            )}

            {aiAnalyzing && (
                <div className="p-10 flex flex-col items-center justify-center gap-4 animate-in zoom-in-95 duration-500">
                    <div className="relative">
                        <Sparkles className="text-primary animate-pulse" size={48} />
                        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                    </div>
                    <div className="text-center">
                        <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }} className="dark:text-gray-200">
                            {aiProgress || t('aiAnalysis.analyzing')}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 2 }}>
                            {t('aiAnalysis.analyzing2')}
                        </Typography>
                    </div>
                    <div className="flex gap-1 h-2">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div
                                key={i}
                                className="w-4 h-full bg-primary rounded-sm animate-pulse"
                                style={{ animationDelay: `${i * 0.1}s`, animationDuration: '1.2s' }}
                            />
                        ))}
                    </div>
                </div>
            )}

            {result && !aiAnalyzing && (
                <div className="flex-1 flex flex-col gap-4 min-h-0 animate-in slide-in-from-bottom-8 duration-700">
                    {isAdmin === false ? (
                        analysisResult ? (
                            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
                                <div className="w-80 flex flex-col gap-3 shrink-0 overflow-y-auto pr-2" style={{ maxHeight: '100%' }}>
                                    <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Sparkles size={18} className="text-primary" />
                                            <span className="text-sm font-semibold text-slate-700 dark:text-gray-200">
                                                {t('aiAnalysis.result')}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                                            {analysisResult.summary}
                                        </p>
                                        {analysisResult.tokenUsage && (
                                            <Tooltip title={`Prompt: ${analysisResult.tokenUsage.prompt_tokens} | Completion: ${analysisResult.tokenUsage.completion_tokens}`} arrow>
                                                <span className="text-[10px] text-slate-400 dark:text-gray-500 font-mono mt-2 inline-block">
                                                    Token: {analysisResult.tokenUsage.total_tokens}
                                                </span>
                                            </Tooltip>
                                        )}

                                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-gray-700">
                                            <Button
                                                size="small"
                                                startIcon={<Cloud size={14} />}
                                                onClick={handleSetMigrationTarget}
                                                sx={{
                                                    fontSize: '11px',
                                                    textTransform: 'none',
                                                    borderRadius: '8px',
                                                    py: 0.75,
                                                    px: 1.5,
                                                    bgcolor: 'action.hover',
                                                    color: 'text.secondary',
                                                    '&:hover': {
                                                        bgcolor: 'action.selected',
                                                    },
                                                    width: '100%',
                                                    justifyContent: 'flex-start',
                                                }}
                                                className="dark:!bg-gray-700/50 dark:!text-gray-300 dark:hover:!bg-gray-700"
                                            >
                                                {migrationTargetNames ? (
                                                    <>
                                                        <span className="text-[10px] text-slate-500 dark:text-gray-400 mr-1">{t('aiAnalysis.migrateTo')}</span>
                                                        <span className="font-medium">{migrationTargetNames}</span>
                                                    </>
                                                ) : (
                                                    t('aiAnalysis.setMigrationTarget')
                                                )}
                                            </Button>
                                        </div>
                                    </div>

                                    {(() => {
                                        const deleteSuggestions = analysisResult.suggestions.filter(s => {
                                            const actualAction = getActualAction(s.path, s.action)
                                            return actualAction === 'delete' && !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path)
                                        })
                                        const moveSuggestions = analysisResult.suggestions.filter(s => {
                                            const actualAction = getActualAction(s.path, s.action)
                                            return actualAction === 'move' && !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path)
                                        })

                                        const parseSize = (sizeStr: string): number => {
                                            const units: { [key: string]: number } = {
                                                'B': 1,
                                                'KB': 1024,
                                                'MB': 1024 * 1024,
                                                'GB': 1024 * 1024 * 1024,
                                                'TB': 1024 * 1024 * 1024 * 1024,
                                            }
                                            const match = sizeStr.match(/^([\d.]+)\s*([A-Z]+)$/i)
                                            if (!match) return 0
                                            const value = parseFloat(match[1])
                                            const unit = match[2].toUpperCase()
                                            return value * (units[unit] || 1)
                                        }

                                        const deleteSize = deleteSuggestions.reduce((sum, s) => sum + parseSize(s.size), 0)
                                        const moveSize = moveSuggestions.reduce((sum, s) => sum + parseSize(s.size), 0)
                                        
                                        const isVolumeScan = /^[A-Za-z]:[\\/]$/.test(path) || path === '/'
                                        const baseCapacity = isVolumeScan && result?.volume_total_bytes != null && result.volume_total_bytes > 0
                                            ? result.volume_total_bytes
                                            : (result?.total_size || 1)
                                        const remainSize = Math.max(0, baseCapacity - deleteSize - moveSize)
                                        const deletePercent = Math.min(100, (deleteSize / baseCapacity) * 100).toFixed(1)
                                        const movePercent = Math.min(100, (moveSize / baseCapacity) * 100).toFixed(1)
                                        const remainPercent = Math.min(100, (remainSize / baseCapacity) * 100).toFixed(1)

                                        const isDarkMode = document.documentElement.classList.contains('dark')

                                        const colors = {
                                            delete: '#ef4444',
                                            move: '#3b82f6',
                                            keep: isDarkMode ? '#4b5563' : '#e2e8f0',
                                        }

                                        const pieData = [
                                            { name: t('aiAnalysis.delete'), value: deleteSize, count: deleteSuggestions.length, percent: deletePercent, action: 'delete' as const, color: colors.delete },
                                            { name: t('aiAnalysis.migrate'), value: moveSize, count: moveSuggestions.length, percent: movePercent, action: 'move' as const, color: colors.move },
                                            { name: t('aiAnalysis.keep'), value: remainSize, count: 0, percent: remainPercent, action: 'keep' as const, color: colors.keep },
                                        ].filter(d => d.value > 0)

                                        const springEasing = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
                                        const smoothEasing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'

                                        return (
                                            <div className="bg-white dark:bg-gray-800 px-4 py-6 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm dark:shadow-gray-900/20 flex flex-col items-center gap-3">
                                                <h3 className="text-sm font-semibold text-slate-700 dark:text-gray-200 self-start">{t('aiAnalysis.suggestedActions')}</h3>
                                                <div className="relative w-full" style={{ height: 200 }}>
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <PieChart>
                                                            <Pie
                                                                data={pieData}
                                                                cx="50%"
                                                                cy="50%"
                                                                innerRadius={hoveredPieIndex !== null && pieData[hoveredPieIndex]?.action !== 'keep' ? 42 : 45}
                                                                outerRadius={65}
                                                                paddingAngle={pieData.length > 1 ? 4 : 0}
                                                                dataKey="value"
                                                                cornerRadius={6}
                                                                onClick={(_, index) => {
                                                                    const clickedAction = pieData[index].action
                                                                    if (clickedAction === 'keep') return
                                                                    if (actionFilter === clickedAction) {
                                                                        setActionFilter('all')
                                                                    } else {
                                                                        setActionFilter(clickedAction)
                                                                    }
                                                                }}
                                                                onMouseEnter={(_, index) => setHoveredPieIndex(index)}
                                                                onMouseLeave={() => setHoveredPieIndex(null)}
                                                                animationBegin={0}
                                                                animationDuration={800}
                                                                animationEasing="ease-out"
                                                            >
                                                                {pieData.map((entry, index) => {
                                                                    const isHovered = hoveredPieIndex === index
                                                                    const isActive = actionFilter === entry.action
                                                                    const isKeep = entry.action === 'keep'
                                                                    const opacity = isKeep
                                                                        ? (isDarkMode ? 0.6 : 0.4)
                                                                        : (actionFilter === 'all' || isActive ? 1 : 0.3)

                                                                    return (
                                                                        <Cell
                                                                            key={`cell-${index}`}
                                                                            fill={entry.color}
                                                                            opacity={opacity}
                                                                            stroke={isHovered && !isKeep ? (isDarkMode ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.9)') : 'none'}
                                                                            strokeWidth={isHovered && !isKeep ? 3 : 0}
                                                                            style={{
                                                                                outline: 'none',
                                                                                cursor: isKeep ? 'default' : 'pointer',
                                                                                filter: isHovered && !isKeep
                                                                                    ? `drop-shadow(0 4px 12px ${entry.color}60)`
                                                                                    : 'none',
                                                                                transition: `all 0.5s ${springEasing}`,
                                                                            }}
                                                                        />
                                                                    )
                                                                })}
                                                            </Pie>
                                                        </PieChart>
                                                    </ResponsiveContainer>
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                        <div className="text-center">
                                                            {(() => {
                                                                const hoveredAction = hoveredPieIndex !== null ? pieData[hoveredPieIndex]?.action : null
                                                                const activeAction = actionFilter !== 'all' ? actionFilter : null
                                                                const displayAction = hoveredAction && hoveredAction !== 'keep' ? hoveredAction : activeAction

                                                                if (displayAction === 'delete') {
                                                                    return (
                                                                        <>
                                                                            <div
                                                                                className="text-2xl font-bold"
                                                                                style={{
                                                                                    color: colors.delete,
                                                                                    transition: `all 0.3s ${smoothEasing}`,
                                                                                }}
                                                                            >
                                                                                {deletePercent}%
                                                                            </div>
                                                                            <div
                                                                                className="text-xs font-medium"
                                                                                style={{
                                                                                    color: colors.delete,
                                                                                    opacity: 0.8,
                                                                                    transition: `all 0.3s ${smoothEasing}`,
                                                                                }}
                                                                            >
                                                                                {t('aiAnalysis.toDelete')}
                                                                            </div>
                                                                        </>
                                                                    )
                                                                } else if (displayAction === 'move') {
                                                                    return (
                                                                        <>
                                                                            <div
                                                                                className="text-2xl font-bold"
                                                                                style={{
                                                                                    color: colors.move,
                                                                                    transition: `all 0.3s ${smoothEasing}`,
                                                                                }}
                                                                            >
                                                                                {movePercent}%
                                                                            </div>
                                                                            <div
                                                                                className="text-xs font-medium"
                                                                                style={{
                                                                                    color: colors.move,
                                                                                    opacity: 0.8,
                                                                                    transition: `all 0.3s ${smoothEasing}`,
                                                                                }}
                                                                            >
                                                                                {t('aiAnalysis.toMigrate')}
                                                                            </div>
                                                                        </>
                                                                    )
                                                                } else {
                                                                    return (
                                                                        <>
                                                                            <div
                                                                                className="text-2xl font-bold text-slate-700 dark:text-gray-100"
                                                                                style={{ transition: `all 0.3s ${smoothEasing}` }}
                                                                            >
                                                                                {(parseFloat(deletePercent) + parseFloat(movePercent)).toFixed(1)}%
                                                                            </div>
                                                                            <div className="text-xs text-slate-500 dark:text-gray-400">{t('aiAnalysis.cleanable')}</div>
                                                                        </>
                                                                    )
                                                                }
                                                            })()}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-2 w-full">
                                                    {pieData.filter(d => d.action !== 'keep').map((item, index) => (
                                                        <button
                                                            key={item.action}
                                                            onClick={() => {
                                                                if (actionFilter === item.action) {
                                                                    setActionFilter('all')
                                                                } else {
                                                                    setActionFilter(item.action)
                                                                }
                                                            }}
                                                            onMouseEnter={() => setHoveredPieIndex(index)}
                                                            onMouseLeave={() => setHoveredPieIndex(null)}
                                                            className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 ${actionFilter === 'all' || actionFilter === item.action
                                                                    ? 'bg-slate-100 dark:bg-gray-700/80 border-transparent'
                                                                    : 'bg-slate-50 dark:bg-gray-800/50 opacity-50 border-transparent'
                                                                }`}
                                                            style={{
                                                                transform: hoveredPieIndex === index ? 'scale(1.03) translateY(-2px)' : 'scale(1) translateY(0)',
                                                                boxShadow: hoveredPieIndex === index
                                                                    ? `0 8px 24px ${item.color}40, 0 0 0 2px ${item.color}30`
                                                                    : 'none',
                                                                borderColor: hoveredPieIndex === index ? `${item.color}50` : 'transparent',
                                                                transition: `all 0.4s ${springEasing}`,
                                                            }}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <div
                                                                    className="w-3 h-3 rounded-full"
                                                                    style={{
                                                                        backgroundColor: item.color,
                                                                        transform: hoveredPieIndex === index ? 'scale(1.4)' : 'scale(1)',
                                                                        boxShadow: hoveredPieIndex === index ? `0 0 8px ${item.color}80` : 'none',
                                                                        transition: `all 0.4s ${springEasing}`,
                                                                    }}
                                                                ></div>
                                                                <span className="text-sm font-medium text-slate-700 dark:text-gray-200">
                                                                    {item.name}
                                                                </span>
                                                            </div>
                                                            <div className="flex flex-col items-end">
                                                                <span
                                                                    className="text-lg font-bold text-slate-700 dark:text-gray-100"
                                                                    style={{
                                                                        color: hoveredPieIndex === index ? item.color : undefined,
                                                                        transition: `color 0.3s ${smoothEasing}`,
                                                                    }}
                                                                >
                                                                    {item.percent}%
                                                                </span>
                                                                <span className="text-xs text-slate-500 dark:text-gray-400">
                                                                    {item.count} {t('aiAnalysis.items')} · {formatBytes(item.value)}
                                                                </span>
                                                            </div>
                                                        </button>
                                                    ))}
                                                    {pieData.find(d => d.action === 'keep') && (
                                                        <div className="flex items-center justify-between px-3 py-2 text-slate-400 dark:text-gray-400">
                                                            <div className="flex items-center gap-2">
                                                                <div
                                                                    className="w-2 h-2 rounded-full"
                                                                    style={{ backgroundColor: colors.keep }}
                                                                ></div>
                                                                <span className="text-xs">{t('aiAnalysis.keep')}</span>
                                                            </div>
                                                            <span className="text-xs">{remainPercent}%</span>
                                                        </div>
                                                    )}
                                                </div>
                                                {actionFilter !== 'all' && (
                                                    <button
                                                        onClick={() => setActionFilter('all')}
                                                        className="text-xs text-primary hover:underline mt-1"
                                                        style={{
                                                            transition: `all 0.3s ${smoothEasing}`,
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.transform = 'scale(1.05)'
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.transform = 'scale(1)'
                                                        }}
                                                    >
                                                        {t('aiAnalysis.showAll')}
                                                    </button>
                                                )}
                                            </div>
                                        )
                                    })()}
                                </div>

                                <div className="flex-1 min-w-0 overflow-auto">
                                    {analysisResult.suggestions.length > 0 ? (
                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 pr-2">
                                            {analysisResult.suggestions
                                                .filter(s => !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path))
                                                .filter(s => {
                                                    const actualAction = getActualAction(s.path, s.action)
                                                    return actionFilter === 'all' || actualAction === actionFilter
                                                })
                                                .map((suggestion, idx) => {
                                                    const actualAction = getActualAction(suggestion.path, suggestion.action)
                                                    const modifiedSuggestion = {
                                                        ...suggestion,
                                                        action: actualAction
                                                    }
                                                    return (
                                                        <SuggestionCard
                                                            key={idx}
                                                            suggestion={modifiedSuggestion}
                                                            onDelete={handleDelete}
                                                            onMove={handleMove}
                                                            selected={selectedItems.has(suggestion.path)}
                                                            onSelectChange={handleSelectChange}
                                                            task={getTaskForPath(suggestion.path)}
                                                            onToggleAction={() => handleToggleAction(suggestion.path, actualAction)}
                                                            originalAction={suggestion.action}
                                                            onAddToSafeList={handleAddToSafeListClick}
                                                        />
                                                    )
                                                })}
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-gray-500">
                                            <CheckCircle2 size={48} className="mb-2" />
                                            <Typography variant="body2">
                                                {actionFilter === 'all'
                                                    ? t('aiAnalysis.noCleanSuggestions')
                                                    : actionFilter === 'delete' 
                                                    ? t('aiAnalysis.noDeleteSuggestions')
                                                    : t('aiAnalysis.noMigrateSuggestions')
                                                }
                                            </Typography>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500 dark:text-gray-400">
                                <CheckCircle2 size={44} className="text-primary" />
                                <Typography variant="body1" sx={{ fontWeight: 700 }}>
                                    {t('expertMode.scanComplete')}
                                </Typography>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                    {t('aiAnalysis.scanCompleteHint')}
                                </Typography>
                                <Button
                                    onClick={() => void runAiAnalysis(result)}
                                    disabled={aiAnalyzing || standardModeNoApi}
                                    variant="contained"
                                    size="small"
                                    startIcon={<Sparkles size={14} />}
                                    sx={{
                                        borderRadius: '10px',
                                        px: 3,
                                        py: 0.9,
                                        bgcolor: 'primary.main',
                                        color: '#1A1A1A',
                                        fontWeight: 700,
                                        fontSize: '12px',
                                        textTransform: 'none',
                                        boxShadow: 'none',
                                        '&:hover': { bgcolor: 'primary.dark', color: '#1A1A1A' }
                                    }}
                                >
                                    {t('aiAnalysis.start')}
                                </Button>
                            </div>
                        )
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-600 overflow-hidden">
                            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-100 dark:border-gray-600 shrink-0">
                                <div className="bg-slate-200/50 dark:bg-gray-600/50 p-0.5 rounded-lg flex gap-0.5 border border-slate-200/80 dark:border-gray-600">
                                    <button onClick={() => switchViewMode('disk')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${viewMode === 'disk' ? 'bg-white dark:bg-gray-600 text-secondary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}>{t('expertMode.diskView')}</button>
                                    <button onClick={() => switchViewMode('ai-prompt')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${viewMode === 'ai-prompt' ? 'bg-secondary text-primary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}>{t('expertMode.aiInstructions')}</button>
                                </div>
                                {hoverNode && viewMode === 'disk' && (
                                    <div className="px-3 py-1.5 bg-secondary text-primary rounded-lg text-[11px] font-semibold flex gap-2 items-center">
                                        <span className="truncate max-w-[200px] text-white/90">{hoverNode.name}</span>
                                        <span className="bg-primary/20 px-1.5 rounded text-[10px] shrink-0">{formatBytes(hoverNode.size)}</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 min-h-0 relative">
                                {viewMode === 'disk' ? (
                                    <div className="absolute inset-0 p-4">
                                        <Treemap root={result.root} width={1000} height={500} onHover={setHoverNode} />
                                    </div>
                                ) : (
                                    <div className="absolute inset-0 overflow-auto">
                                        <AIPromptPanel result={result} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {status === 'idle' && !result && (
                <div className="flex-1 flex flex-col items-center justify-center min-h-0">
                    <button
                        type="button"
                        onClick={handleBrowseFolder}
                        disabled={standardModeNoApi}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-600 bg-slate-50 dark:bg-gray-700/50 text-slate-600 dark:text-gray-300 hover:border-primary/50 hover:bg-primary/5 hover:text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                        <Folder size={18} />
                        <span className="text-sm font-medium">{t('expertMode.selectFolder')}</span>
                    </button>
                    <p className="mt-2 text-xs text-slate-400 dark:text-gray-500">{t('expertMode.analyzeDiskUsage')}</p>
                </div>
            )}

            <Dialog
                open={showSaveDialog}
                onClose={() => setShowSaveDialog(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    sx: { borderRadius: '16px' }
                }}
            >
                <DialogTitle sx={{ pb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Save size={20} />
                        {t('snapshot.saveSnapshot')}
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        label={t('snapshot.snapshotName')}
                        value={snapshotName}
                        onChange={(e) => setSnapshotName(e.target.value)}
                        placeholder={t('snapshot.inputSnapshotName')}
                        sx={{
                            mt: 1,
                            '& .MuiOutlinedInput-root': {
                                borderRadius: '12px',
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && snapshotName.trim()) {
                                handleConfirmSaveSnapshot()
                            }
                        }}
                    />
                    <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'text.secondary' }}>
                        {t('snapshot.saveHint2')}
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5 }}>
                    <Button
                        onClick={() => setShowSaveDialog(false)}
                        sx={{ borderRadius: '10px', textTransform: 'none' }}
                    >
                        {t('common.cancel')}
                    </Button>
                    <Button
                        onClick={handleConfirmSaveSnapshot}
                        variant="contained"
                        disabled={!snapshotName.trim()}
                        sx={{
                            borderRadius: '10px',
                            textTransform: 'none',
                            bgcolor: 'primary.main',
                            color: '#1A1A1A',
                            '&:hover': { bgcolor: 'primary.dark', color: '#1A1A1A' }
                        }}
                    >
                        {t('common.save')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={safeListDialog.open}
                onClose={() => setSafeListDialog({ open: false, path: null, dontRemind: false })}
                maxWidth="sm"
                fullWidth
                PaperProps={{ sx: { borderRadius: '16px' } }}
            >
                <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ width: 36, height: 36, borderRadius: '10px', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Shield size={20} />
                        </Box>
                        <Typography variant="h6" component="span" sx={{ fontSize: '16px', fontWeight: 700 }}>
                            {t('safeList.confirmTitle')}
                        </Typography>
                    </Box>
                </DialogTitle>
                <DialogContent sx={{ px: 3 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                        {t('safeList.confirmMessage')}
                    </Typography>
                    {safeListDialog.path && (
                        <Typography variant="caption" component="div" sx={{ color: 'text.secondary', fontFamily: 'monospace', wordBreak: 'break-all', bgcolor: 'action.hover', p: 1.5, borderRadius: 1 }}>
                            {safeListDialog.path}
                        </Typography>
                    )}
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={safeListDialog.dontRemind}
                                onChange={(_, checked) => setSafeListDialog(prev => ({ ...prev, dontRemind: checked }))}
                                size="small"
                            />
                        }
                        label={t('safeList.dontRemindAgain')}
                        sx={{ mt: 2 }}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5 }}>
                    <Button onClick={() => setSafeListDialog({ open: false, path: null, dontRemind: false })} sx={{ borderRadius: '10px', textTransform: 'none' }}>
                        {t('common.cancel')}
                    </Button>
                    <Button onClick={handleSafeListConfirm} variant="contained" sx={{ borderRadius: '10px', textTransform: 'none' }}>
                        {t('common.confirm')}
                    </Button>
                </DialogActions>
            </Dialog>

            <CloudStorageSelector
                open={showCloudSelector}
                onClose={() => setShowCloudSelector(false)}
                onConfirm={handleCloudStorageSelected}
                availableConfigs={availableConfigs}
                fileName="迁移文件"
                preselectedConfigs={selectedMigrationConfigs}
                onOpenSettings={onOpenSettings}
            />
        </div>
    );
}


