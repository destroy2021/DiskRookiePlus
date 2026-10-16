import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
    Folder, File, ChevronRight, ChevronLeft, Search, ArrowUp,
    FolderOpen, Sparkles, MessageSquare, Trash2, ExternalLink,
    SortAsc, SortDesc, RefreshCw, Loader2, Shield, Play, StopCircle, FolderPlus,
} from 'lucide-react'
import { Button, TextField, Menu, MenuItem, ListItemIcon, ListItemText, Divider, Tooltip } from '@mui/material'
import { formatBytes } from '../utils/format'
import { listDirectory, getDirectorySize, type DirEntry, type DirectoryListing, type DirectorySizeResult } from '../services/ai-analysis'
import { invoke } from '@tauri-apps/api/core'
import type { AnalysisSession, ScanResult } from './ExpertMode.types'
import { AiOperationPanel } from './AiOperationPanel'
import { useAiTaskQueue } from './useAiTaskQueue'

type SortField = 'name' | 'size' | 'type' | 'modified'
type SortDir = 'asc' | 'desc'

interface FileExplorerProps {
    initialPath: string
    onScanDirectory?: (path: string) => void
    onAiAutoAnalyze?: (path: string) => void
    onAskAi?: (entry: DirEntry) => void
    onDeleteItem?: (path: string, isDir: boolean) => void
    activeSession?: AnalysisSession | null
    deletedPathsFromSession?: Set<string>
    safeListPathsFromSession?: Set<string>
    scanStatus?: string
    scanResult?: ScanResult | null
    onRunScan?: (path: string) => void
    onCancelScan?: () => void
    scanCanceling?: boolean
    onBrowseFolder?: () => void
    onAskAiMulti?: (entries: DirEntry[]) => void
    onScanDirectoryMulti?: (paths: string[]) => void
    onDeleteItemsMulti?: (items: { path: string; isDir: boolean }[]) => void
    onAddToSafeListMulti?: (paths: string[]) => void
}

interface HistoryState {
    past: string[]
    future: string[]
}

const FILE_TYPE_ICONS: Record<string, string> = {
    '.txt': '📄', '.doc': '📝', '.docx': '📝', '.pdf': '📕',
    '.xls': '📊', '.xlsx': '📊', '.csv': '📊',
    '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.gif': '🖼️', '.bmp': '🖼️', '.svg': '🖼️', '.webp': '🖼️',
    '.mp3': '🎵', '.wav': '🎵', '.flac': '🎵', '.aac': '🎵',
    '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬', '.mov': '🎬', '.wmv': '🎬',
    '.zip': '📦', '.rar': '📦', '.7z': '📦', '.tar': '📦', '.gz': '📦',
    '.exe': '⚙️', '.msi': '⚙️', '.dll': '⚙️',
    '.js': '💻', '.ts': '💻', '.py': '💻', '.rs': '💻', '.java': '💻', '.cpp': '💻', '.c': '💻',
    '.json': '📋', '.xml': '📋', '.yaml': '📋', '.yml': '📋', '.toml': '📋',
    '.log': '📃', '.md': '📃', '.html': '🌐', '.css': '🎨',
}

function getFileIcon(name: string): string {
    const ext = name.includes('.') ? '.' + name.split('.').pop()?.toLowerCase() : ''
    return FILE_TYPE_ICONS[ext] || ''
}

function formatDate(timestamp: number | null | undefined): string {
    if (!timestamp) return '--'
    const d = new Date(timestamp * 1000)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString().slice(0, 5)
}

export function FileExplorer({
    initialPath,
    onScanDirectory,
    onAiAutoAnalyze,
    onAskAi,
    onDeleteItem,
    activeSession: _activeSession,
    deletedPathsFromSession = new Set(),
    safeListPathsFromSession = new Set(),
    scanStatus = 'idle',
    scanResult = null,
    onRunScan,
    onCancelScan,
    scanCanceling = false,
    onBrowseFolder,
    onAskAiMulti,
    onScanDirectoryMulti,
    onDeleteItemsMulti,
    onAddToSafeListMulti,
}: FileExplorerProps) {
    const { t } = useTranslation()
    const isTauri = typeof window !== 'undefined' && '__TAURI__' in window
    const defaultPath = initialPath || (isTauri ? '' : 'C:\\')
    const [currentPath, setCurrentPath] = useState(defaultPath)
    const [listing, setListing] = useState<DirectoryListing | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [sortField, setSortField] = useState<SortField>('name')
    const [sortDir, setSortDir] = useState<SortDir>('asc')
    const [history, setHistory] = useState<HistoryState>({ past: [], future: [] })
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
    const [lastClickedPath, setLastClickedPath] = useState<string | null>(null)
    const [dirSizes, setDirSizes] = useState<Map<string, DirectorySizeResult>>(new Map())
    const [contextMenu, setContextMenu] = useState<{ entry: DirEntry; x: number; y: number } | null>(null)
    const [pathEditActive, setPathEditActive] = useState(false)
    const [pathEditValue, setPathEditValue] = useState('')
    const [currentPathInput, setCurrentPathInput] = useState(currentPath || defaultPath)
    const [showAiPanel, setShowAiPanel] = useState(false)
    const [hoverCard, setHoverCard] = useState<{ entry: DirEntry; x: number; y: number } | null>(null)
    const [analyzedPaths, setAnalyzedPaths] = useState<Set<string>>(new Set())
    const aiResultCacheRef = useRef<Map<string, string>>(new Map())
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const listContainerRef = useRef<HTMLDivElement>(null)
    const aiTaskQueue = useAiTaskQueue()

    useEffect(() => {
        setCurrentPathInput(currentPath || defaultPath)
    }, [currentPath, defaultPath])

    useEffect(() => {
        const doneTasks = aiTaskQueue.tasks.filter(t => t.status === 'done' && t.type === 'ask')
        for (const task of doneTasks) {
            for (const path of task.paths) {
                if (!aiResultCacheRef.current.has(path) && task.result) {
                    const result = task.result as { summary?: string }
                    if (result?.summary) {
                        aiResultCacheRef.current.set(path, result.summary)
                        setAnalyzedPaths(prev => new Set(prev).add(path))
                    }
                }
            }
        }
    }, [aiTaskQueue.tasks])

    const loadDirectory = useCallback(async (path: string, addToHistory = true) => {
        if (!path) return
        setLoading(true)
        setError(null)
        setSearchQuery('')
        setSelectedPaths(new Set())
        try {
            const result = await listDirectory(path)
            setListing(result)
            setCurrentPath(path)
            setCurrentPathInput(path)
            if (addToHistory) {
                setHistory(prev => ({
                    past: [...prev.past, currentPath],
                    future: [],
                }))
            }
        } catch (err) {
            setError(String(err))
        } finally {
            setLoading(false)
        }
    }, [currentPath])

    const initialPathRef = useRef(initialPath)
    initialPathRef.current = initialPath

    useEffect(() => {
        const path = initialPathRef.current || defaultPath
        if (path) void loadDirectory(path, false)
    }, [defaultPath])

    const navigateTo = useCallback((path: string) => {
        void loadDirectory(path, true)
    }, [loadDirectory])

    const goBack = useCallback(() => {
        if (history.past.length === 0) return
        const prev = history.past[history.past.length - 1]
        setHistory(h => ({
            past: h.past.slice(0, -1),
            future: [currentPath, ...h.future],
        }))
        void loadDirectory(prev, false)
    }, [history, currentPath, loadDirectory])

    const goForward = useCallback(() => {
        if (history.future.length === 0) return
        const next = history.future[0]
        setHistory(h => ({
            past: [...h.past, currentPath],
            future: h.future.slice(1),
        }))
        void loadDirectory(next, false)
    }, [history, currentPath, loadDirectory])

    const goUp = useCallback(() => {
        const sep = currentPath.includes('/') ? '/' : '\\'
        const parts = currentPath.replace(/[\\/]+$/, '').split(sep)
        if (parts.length <= 1) return
        const parent = parts.slice(0, -1).join(sep)
        if (parent) void navigateTo(parent + sep)
    }, [currentPath, navigateTo])

    const handlePathSubmit = useCallback(() => {
        const p = pathEditValue.trim()
        if (p) {
            void navigateTo(p)
            setPathEditActive(false)
        }
    }, [pathEditValue, navigateTo])

    const handlePathInputSubmit = useCallback(() => {
        const p = currentPathInput.trim()
        if (p) {
            void navigateTo(p)
        }
    }, [currentPathInput, navigateTo])

    const handleSort = useCallback((field: SortField) => {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDir('asc')
        }
    }, [sortField])

    const fetchDirSize = useCallback(async (path: string) => {
        if (dirSizes.has(path)) return
        try {
            const result = await getDirectorySize(path)
            setDirSizes(prev => new Map(prev).set(path, result))
        } catch { /* ignore */ }
    }, [dirSizes])

    const filteredAndSorted = useMemo(() => {
        if (!listing) return []
        let items = listing.items
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            items = items.filter(i => i.name.toLowerCase().includes(q))
        }
        return [...items].sort((a, b) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
            let cmp = 0
            switch (sortField) {
                case 'name': cmp = a.name.localeCompare(b.name); break
                case 'size': {
                    const aSize = a.is_dir ? (dirSizes.get(a.path)?.total_size ?? 0) : a.size
                    const bSize = b.is_dir ? (dirSizes.get(b.path)?.total_size ?? 0) : b.size
                    cmp = aSize - bSize; break
                }
                case 'type': cmp = a.is_dir ? 0 : (b.is_dir ? 0 : a.name.localeCompare(b.name)); break
                case 'modified': cmp = (a.modified ?? 0) - (b.modified ?? 0); break
            }
            return sortDir === 'asc' ? cmp : -cmp
        })
    }, [listing, searchQuery, sortField, sortDir, dirSizes])

    const pathSegments = useMemo(() => {
        const sep = currentPath.includes('/') ? '/' : '\\'
        const clean = currentPath.replace(/[\\/]+$/, '')
        const parts = clean.split(sep).filter(Boolean)
        return parts.map((name, i) => ({
            name: name.includes(':') ? name.toUpperCase() : name,
            path: parts.slice(0, i + 1).join(sep) + (i === 0 && name.includes(':') ? '\\' : ''),
        }))
    }, [currentPath])

    const handleDoubleClick = useCallback((entry: DirEntry) => {
        if (entry.is_dir) {
            navigateTo(entry.path)
        }
    }, [navigateTo])

    const handleContextMenu = useCallback((e: React.MouseEvent, entry: DirEntry) => {
        e.preventDefault()
        setContextMenu({ entry, x: e.clientX - 2, y: e.clientY - 4 })
    }, [])

    const handleSelectClick = useCallback((e: React.MouseEvent, entry: DirEntry) => {
        if (e.shiftKey && lastClickedPath) {
            const items = filteredAndSorted
            const lastIdx = items.findIndex(i => i.path === lastClickedPath)
            const currIdx = items.findIndex(i => i.path === entry.path)
            if (lastIdx !== -1 && currIdx !== -1) {
                const [start, end] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx]
                setSelectedPaths(new Set(items.slice(start, end + 1).map(i => i.path)))
            }
        } else if (e.ctrlKey || e.metaKey) {
            setSelectedPaths(prev => {
                const next = new Set(prev)
                if (next.has(entry.path)) next.delete(entry.path)
                else next.add(entry.path)
                return next
            })
        } else {
            setSelectedPaths(new Set([entry.path]))
        }
        setLastClickedPath(entry.path)
    }, [lastClickedPath, filteredAndSorted])

    const selectedEntries = useMemo(() => {
        return filteredAndSorted.filter(e => selectedPaths.has(e.path))
    }, [filteredAndSorted, selectedPaths])

    const handleAskAi = useCallback(async (entry: DirEntry) => {
        setContextMenu(null)
        if (onAskAi) {
            onAskAi(entry)
            return
        }
        const paths = [entry.path]
        setShowAiPanel(true)
        aiTaskQueue.enqueue(paths, 'ask', async (_taskId, onLog) => {
            onLog(`> ${entry.is_dir ? t('contextMenu.askAiDir') : t('contextMenu.askAiFile')}: ${entry.name}`)
            const { analyzeWithAI } = await import('../services/ai-analysis')
            const { loadSettings, resolveEffectiveApiKey } = await import('../services/ai')
            const aiSettings = await loadSettings()
            const apiKey = await resolveEffectiveApiKey(aiSettings)
            if (!apiKey?.trim()) {
                onLog(`> ${t('expertMode.needApiConfig')}`)
                throw new Error(t('expertMode.needApiConfig'))
            }
            const sizeStr = entry.is_dir ? 'Directory' : formatBytes(entry.size)
            const prompt = `Analyze this ${entry.is_dir ? 'directory' : 'file'} and tell me:\n1. What is its likely purpose?\n2. Is it safe to delete or should it be migrated?\n3. Why?\n\nPath: ${entry.path}\nName: ${entry.name}\nType: ${entry.is_dir ? 'Directory' : 'File'}\nSize: ${sizeStr}\nModified: ${formatDate(entry.modified)}${entry.child_count != null ? `\nChild items: ${entry.child_count}` : ''}`
            const result = await analyzeWithAI(prompt, (msg) => onLog(`> ${msg}`), new AbortController().signal)
            onLog(`> ${t('aiAnalysis.processed')}`)
            return result
        })
    }, [onAskAi, aiTaskQueue, t])

    const handleOpenInFileManager = useCallback(async (path: string, isFile: boolean) => {
        setContextMenu(null)
        try {
            await invoke('open_in_file_manager', { path, isFile })
        } catch { /* ignore */ }
    }, [])

    const handleScanDirectory = useCallback((path: string) => {
        setContextMenu(null)
        onScanDirectory?.(path)
    }, [onScanDirectory])

    const handleScanDirectoryMulti = useCallback((paths: string[]) => {
        setContextMenu(null)
        setSelectedPaths(new Set())
        onScanDirectoryMulti?.(paths)
    }, [onScanDirectoryMulti])

    const handleDeleteItemsMulti = useCallback(() => {
        setContextMenu(null)
        const items = selectedEntries.map(e => ({ path: e.path, isDir: e.is_dir }))
        setSelectedPaths(new Set())
        onDeleteItemsMulti?.(items)
    }, [selectedEntries, onDeleteItemsMulti])

    const handleAddToSafeList = useCallback((paths: string[]) => {
        setContextMenu(null)
        setSelectedPaths(new Set())
        onAddToSafeListMulti?.(paths)
    }, [onAddToSafeListMulti])

    const handleAskAiMulti = useCallback(() => {
        setContextMenu(null)
        if (onAskAiMulti) {
            onAskAiMulti(selectedEntries)
            return
        }
        const paths = selectedEntries.map(e => e.path)
        setShowAiPanel(true)
        aiTaskQueue.enqueue(paths, 'ask', async (_taskId, onLog) => {
            onLog(`> ${t('contextMenu.askAi')} (${paths.length})`)
            const { analyzeWithAI } = await import('../services/ai-analysis')
            const { loadSettings, resolveEffectiveApiKey } = await import('../services/ai')
            const aiSettings = await loadSettings()
            const apiKey = await resolveEffectiveApiKey(aiSettings)
            if (!apiKey?.trim()) {
                onLog(`> ${t('expertMode.needApiConfig')}`)
                throw new Error(t('expertMode.needApiConfig'))
            }
            for (const entry of selectedEntries) {
                const sizeStr = entry.is_dir ? 'Directory' : formatBytes(entry.size)
                const prompt = `Analyze this ${entry.is_dir ? 'directory' : 'file'} and tell me:\n1. What is its likely purpose?\n2. Is it safe to delete or should it be migrated?\n3. Why?\n\nPath: ${entry.path}\nName: ${entry.name}\nType: ${entry.is_dir ? 'Directory' : 'File'}\nSize: ${sizeStr}\nModified: ${formatDate(entry.modified)}${entry.child_count != null ? `\nChild items: ${entry.child_count}` : ''}`
                onLog(`> Analyzing: ${entry.name}...`)
                const result = await analyzeWithAI(prompt, (msg) => onLog(`> ${msg}`), new AbortController().signal)
                onLog(`> ${entry.name}: ${result.summary.substring(0, 100)}...`)
            }
            onLog(`> ${t('aiAnalysis.processed')}`)
            return selectedEntries.length
        })
    }, [selectedEntries, onAskAiMulti, aiTaskQueue, t])

    const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
        <button
            onClick={() => handleSort(field)}
            className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest hover:text-slate-600 dark:hover:text-gray-300 transition-colors select-none"
        >
            {label}
            {sortField === field && (sortDir === 'asc' ? <SortAsc size={10} /> : <SortDesc size={10} />)}
        </button>
    )

    const isScanning = scanStatus === 'scanning'
    const hasResult = scanResult !== null
    const scanDisabled = !currentPathInput

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-750 shrink-0">
                <Button
                    size="small"
                    onClick={goBack}
                    disabled={history.past.length === 0}
                    sx={{ minWidth: 28, width: 28, height: 28, p: 0, borderRadius: '6px', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' }, '&.Mui-disabled': { opacity: 0.3 } }}
                >
                    <ChevronLeft size={16} />
                </Button>
                <Button
                    size="small"
                    onClick={goForward}
                    disabled={history.future.length === 0}
                    sx={{ minWidth: 28, width: 28, height: 28, p: 0, borderRadius: '6px', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' }, '&.Mui-disabled': { opacity: 0.3 } }}
                >
                    <ChevronRight size={16} />
                </Button>
                <Button
                    size="small"
                    onClick={goUp}
                    sx={{ minWidth: 28, width: 28, height: 28, p: 0, borderRadius: '6px', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
                >
                    <ArrowUp size={16} />
                </Button>
                <Button
                    size="small"
                    onClick={() => void loadDirectory(currentPath, false)}
                    sx={{ minWidth: 28, width: 28, height: 28, p: 0, borderRadius: '6px', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
                >
                    <RefreshCw size={14} />
                </Button>

                {pathEditActive ? (
                    <TextField
                        autoFocus
                        size="small"
                        value={pathEditValue}
                        onChange={(e) => setPathEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handlePathSubmit(); if (e.key === 'Escape') setPathEditActive(false) }}
                        onBlur={() => setPathEditActive(false)}
                        sx={{
                            flex: 1, '& .MuiOutlinedInput-root': {
                                fontSize: '12px', borderRadius: '6px', py: 0.25,
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? '#374151' : '#fff',
                            }
                        }}
                    />
                ) : (
                    <div
                        className="flex-1 flex items-center gap-0.5 px-2 py-1 rounded-md bg-white dark:bg-gray-700 border border-slate-200 dark:border-gray-600 cursor-text min-w-0 overflow-hidden"
                        onClick={() => { setPathEditActive(true); setPathEditValue(currentPath) }}
                    >
                        {pathSegments.map((seg, i) => (
                            <span key={i} className="flex items-center shrink-0">
                                {i > 0 && <ChevronRight size={10} className="text-slate-400 dark:text-gray-500 mx-0.5" />}
                                <button
                                    onClick={(e) => { e.stopPropagation(); navigateTo(seg.path) }}
                                    className="text-[12px] px-1 py-0.5 rounded hover:bg-primary/10 hover:text-primary transition-colors text-slate-600 dark:text-gray-300 truncate max-w-[120px]"
                                >
                                    {seg.name}
                                </button>
                            </span>
                        ))}
                    </div>
                )}

                <div className="relative shrink-0">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <TextField
                        size="small"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('common.search')}
                        sx={{
                            width: 120, '& .MuiOutlinedInput-root': {
                                fontSize: '11px', borderRadius: '6px', pl: '24px', py: 0.25,
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? '#374151' : '#fff',
                            },
                            '& input::placeholder': { fontSize: '11px' }
                        }}
                    />
                </div>

                <div className="flex items-center gap-1 shrink-0 border-l border-slate-200 dark:border-gray-600 pl-2">
                    <TextField
                        size="small"
                        value={currentPathInput}
                        onChange={(e) => setCurrentPathInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handlePathInputSubmit() }}
                        placeholder={t('expertMode.inputOrSelectPath')}
                        sx={{
                            width: 160, '& .MuiOutlinedInput-root': {
                                fontSize: '11px', borderRadius: '6px', py: 0.25,
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? '#374151' : '#fff',
                            },
                            '& input::placeholder': { fontSize: '11px' }
                        }}
                    />
                    {onBrowseFolder && (
                        <Button
                            size="small"
                            onClick={onBrowseFolder}
                            sx={{
                                minWidth: 28, width: 28, height: 28, p: 0, borderRadius: '6px',
                                color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' }
                            }}
                        >
                            <FolderPlus size={14} />
                        </Button>
                    )}
                    {isScanning ? (
                        <Button
                            onClick={() => onCancelScan?.()}
                            disabled={scanCanceling}
                            size="small"
                            startIcon={<StopCircle size={12} />}
                            sx={{
                                borderRadius: '6px', px: 1.5, py: 0.6,
                                bgcolor: '#ef4444', color: '#fff',
                                fontWeight: 700, fontSize: '11px', textTransform: 'none', boxShadow: 'none',
                                '&:hover': { bgcolor: '#dc2626', boxShadow: 'none' },
                                '&:disabled': { bgcolor: '#f87171', color: '#fff' },
                                '& .MuiButton-startIcon': { mx: 0.5 }
                            }}
                        >
                            {scanCanceling ? t('expertMode.stoppingScan') : t('expertMode.stopScan')}
                        </Button>
                    ) : (
                        <Button
                            onClick={() => onRunScan?.(currentPathInput)}
                            disabled={scanDisabled}
                            size="small"
                            startIcon={<Play size={12} />}
                            sx={{
                                borderRadius: '6px', px: 1.5, py: 0.6,
                                bgcolor: 'primary.main', color: '#1A1A1A',
                                fontWeight: 700, fontSize: '11px', textTransform: 'none', boxShadow: 'none',
                                '&:hover': { bgcolor: 'primary.dark', color: '#1A1A1A', boxShadow: 'none' },
                                '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' },
                                '& .MuiButton-startIcon': { mx: 0.5 }
                            }}
                        >
                            {hasResult ? t('expertMode.rescan') : t('expertMode.startScan')}
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-[1fr_90px_70px_120px] gap-1 px-3 py-1.5 border-b border-slate-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800/50 shrink-0">
                <SortHeader field="name" label={t('common.name')} />
                <SortHeader field="size" label={t('common.size')} />
                <SortHeader field="type" label={t('common.type')} />
                <SortHeader field="modified" label={t('common.modified')} />
            </div>

            <div ref={listContainerRef} className="flex-1 overflow-y-auto min-h-0">
                {loading && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={20} className="animate-spin text-primary" />
                        <span className="ml-2 text-xs text-slate-500">{t('common.loading')}</span>
                    </div>
                )}
                {!currentPath && !loading && (
                    <div className="px-4 py-8 text-center text-xs text-slate-400">
                        {t('expertMode.selectFolderToBrowse')}
                    </div>
                )}
                {error && (
                    <div className="px-4 py-8 text-center">
                        <p className="text-xs text-red-500">{error}</p>
                        <Button size="small" onClick={() => void loadDirectory(currentPath, false)} sx={{ mt: 1, fontSize: '11px', textTransform: 'none' }}>
                            {t('common.retry')}
                        </Button>
                    </div>
                )}
                {!loading && !error && filteredAndSorted.length === 0 && (
                    <div className="px-4 py-8 text-center text-xs text-slate-400">
                        {searchQuery ? t('common.noResults') : t('common.emptyDirectory')}
                    </div>
                )}
                {!loading && !error && filteredAndSorted.map((entry) => {
                    const isSelected = selectedPaths.has(entry.path)
                    const dirSize = entry.is_dir ? dirSizes.get(entry.path) : null
                    const sizeDisplay = entry.is_dir
                        ? (dirSize ? formatBytes(dirSize.total_size) : '--')
                        : formatBytes(entry.size)
                    const isDeleted = deletedPathsFromSession.has(entry.path)
                    const isSafeListed = safeListPathsFromSession.has(entry.path)

                    return (
                        <div
                            key={entry.path}
                            className={`grid grid-cols-[1fr_90px_70px_120px] gap-1 px-3 py-1.5 text-[12px] cursor-pointer border-b border-transparent hover:bg-slate-50 dark:hover:bg-gray-700/30 transition-colors ${isSelected ? 'bg-primary/10 dark:bg-primary/20 border-l-2 border-l-primary' : ''} ${isDeleted ? 'opacity-40' : ''}`}
                            onClick={(e) => handleSelectClick(e, entry)}
                            onDoubleClick={() => handleDoubleClick(entry)}
                            onContextMenu={(e) => handleContextMenu(e, entry)}
                            onMouseEnter={(e) => {
                                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
                                hoverTimerRef.current = setTimeout(() => {
                                    if (!hoverCard || hoverCard.entry.path !== entry.path) {
                                        setHoverCard({ entry, x: e.clientX, y: e.clientY })
                                    }
                                }, 600)
                            }}
                            onMouseLeave={() => {
                                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
                                setHoverCard(null)
                            }}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                {entry.is_dir ? (
                                    <Folder size={14} className="text-primary shrink-0" />
                                ) : (
                                    <span className="shrink-0 text-[12px] w-[14px] text-center">{getFileIcon(entry.name) || <File size={14} className="text-slate-400" />}</span>
                                )}
                                <span className={`truncate ${isDeleted ? 'line-through text-slate-400 dark:text-gray-500' : 'text-slate-700 dark:text-gray-200'}`}>{entry.name}</span>
                                {isSafeListed && <Shield size={11} className="text-green-500 shrink-0" />}
                                {analyzedPaths.has(entry.path) && (
                                    <Tooltip title={aiResultCacheRef.current.get(entry.path)?.slice(0, 80) ?? ''} arrow placement="top">
                                        <span><Sparkles size={11} className="text-purple-400 shrink-0 cursor-help" /></span>
                                    </Tooltip>
                                )}
                            </div>
                            <span
                                className={`font-mono text-slate-500 dark:text-gray-400 ${entry.is_dir && !dirSize ? 'cursor-pointer hover:text-primary' : ''}`}
                                onClick={(e) => { if (entry.is_dir && !dirSize) { e.stopPropagation(); void fetchDirSize(entry.path) } }}
                            >
                                {sizeDisplay}
                            </span>
                            <span className="text-slate-500 dark:text-gray-400">
                                {entry.is_dir ? t('common.directory') : (entry.name.includes('.') ? entry.name.split('.').pop()?.toUpperCase() : t('common.file'))}
                            </span>
                            <span className="text-slate-500 dark:text-gray-400 font-mono">{formatDate(entry.modified)}</span>
                        </div>
                    )
                })}
            </div>

            {listing && (
                <div className="flex items-center justify-between px-3 py-1 border-t border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-750 text-[10px] text-slate-400 dark:text-gray-500 shrink-0">
                    <span>{listing.items.length} {t('common.items')}</span>
                    {selectedPaths.size > 0 && <span className="text-primary font-medium">{selectedPaths.size} {t('common.selected')}</span>}
                </div>
            )}

            <Menu
                open={contextMenu !== null}
                onClose={() => setContextMenu(null)}
                anchorReference="anchorPosition"
                anchorPosition={contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined}
                slotProps={{ paper: { sx: { minWidth: 200, borderRadius: '10px', boxShadow: 3 } } }}
            >
                <MenuItem onClick={() => { if (contextMenu) { onAiAutoAnalyze?.(contextMenu.entry.path); setContextMenu(null) } }} sx={{ py: 0.75 }}>
                    <ListItemIcon><Sparkles size={16} className="text-primary" /></ListItemIcon>
                    <ListItemText primary={t('contextMenu.aiAutoAnalyze')} primaryTypographyProps={{ fontSize: 12 }} />
                </MenuItem>
                {selectedPaths.size > 1 ? (
                    <MenuItem onClick={() => void handleAskAiMulti()} sx={{ py: 0.75 }}>
                        <ListItemIcon><MessageSquare size={16} className="text-blue-500" /></ListItemIcon>
                        <ListItemText primary={`${t('contextMenu.askAi')} (${selectedPaths.size})`} primaryTypographyProps={{ fontSize: 12 }} />
                    </MenuItem>
                ) : (
                    <MenuItem onClick={() => { if (contextMenu) void handleAskAi(contextMenu.entry) }} sx={{ py: 0.75 }}>
                        <ListItemIcon><MessageSquare size={16} className="text-blue-500" /></ListItemIcon>
                        <ListItemText primary={t('contextMenu.askAi')} primaryTypographyProps={{ fontSize: 12 }} />
                    </MenuItem>
                )}
                <Divider />
                {contextMenu?.entry.is_dir && (
                    selectedPaths.size > 1 && selectedEntries.some(e => e.is_dir) ? (
                        <MenuItem onClick={() => handleScanDirectoryMulti(selectedEntries.filter(e => e.is_dir).map(e => e.path))} sx={{ py: 0.75 }}>
                            <ListItemIcon><FolderOpen size={16} className="text-amber-500" /></ListItemIcon>
                            <ListItemText primary={`${t('contextMenu.scanDirectory')} (${selectedEntries.filter(e => e.is_dir).length})`} primaryTypographyProps={{ fontSize: 12 }} />
                        </MenuItem>
                    ) : (
                        <MenuItem onClick={() => handleScanDirectory(contextMenu.entry.path)} sx={{ py: 0.75 }}>
                            <ListItemIcon><FolderOpen size={16} className="text-amber-500" /></ListItemIcon>
                            <ListItemText primary={t('contextMenu.scanDirectory')} primaryTypographyProps={{ fontSize: 12 }} />
                        </MenuItem>
                    )
                )}
                <MenuItem onClick={() => { if (contextMenu) void handleOpenInFileManager(contextMenu.entry.path, !contextMenu.entry.is_dir) }} sx={{ py: 0.75 }}>
                    <ListItemIcon><ExternalLink size={16} className="text-slate-500" /></ListItemIcon>
                    <ListItemText primary={t('contextMenu.openInFileManager')} primaryTypographyProps={{ fontSize: 12 }} />
                </MenuItem>
                <Divider />
                {selectedPaths.size > 1 ? (
                    <>
                        <MenuItem onClick={() => handleAddToSafeList(Array.from(selectedPaths))} sx={{ py: 0.75 }}>
                            <ListItemIcon><Shield size={16} className="text-green-500" /></ListItemIcon>
                            <ListItemText primary={`${t('contextMenu.safeListed')} (${selectedPaths.size})`} primaryTypographyProps={{ fontSize: 12 }} />
                        </MenuItem>
                        <MenuItem onClick={() => void handleDeleteItemsMulti()} sx={{ py: 0.75 }}>
                            <ListItemIcon><Trash2 size={16} className="text-red-500" /></ListItemIcon>
                            <ListItemText primary={`${t('contextMenu.delete')} (${selectedPaths.size})`} primaryTypographyProps={{ fontSize: 12, color: 'error.main' }} />
                        </MenuItem>
                    </>
                ) : (
                    <MenuItem onClick={() => { if (contextMenu) { onDeleteItem?.(contextMenu.entry.path, contextMenu.entry.is_dir); setContextMenu(null) } }} sx={{ py: 0.75 }}>
                        <ListItemIcon><Trash2 size={16} className="text-red-500" /></ListItemIcon>
                        <ListItemText primary={t('contextMenu.delete')} primaryTypographyProps={{ fontSize: 12, color: 'error.main' }} />
                    </MenuItem>
                )}
            </Menu>

            <AiOperationPanel
                open={showAiPanel}
                onClose={() => setShowAiPanel(false)}
                tasks={aiTaskQueue.tasks}
                currentTask={aiTaskQueue.currentTask}
                isRunning={aiTaskQueue.isRunning}
                isPaused={aiTaskQueue.isPaused}
                onPause={aiTaskQueue.pause}
                onResume={aiTaskQueue.resume}
                onCancel={aiTaskQueue.cancel}
                onClear={aiTaskQueue.clear}
            />

            {hoverCard && (
                <div
                    className="fixed z-50 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-slate-200 dark:border-gray-600 p-3 max-w-sm pointer-events-none"
                    style={{
                        left: Math.min(hoverCard.x + 12, window.innerWidth - 340),
                        top: Math.min(hoverCard.y + 12, window.innerHeight - 200),
                    }}
                >
                    <div className="flex items-start gap-2 mb-2">
                        {hoverCard.entry.is_dir ? (
                            <Folder size={16} className="text-primary shrink-0 mt-0.5" />
                        ) : (
                            <File size={16} className="text-slate-400 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-bold text-slate-700 dark:text-gray-200 truncate">{hoverCard.entry.name}</p>
                            <p className="text-[10px] text-slate-400 dark:text-gray-500 truncate">{hoverCard.entry.path}</p>
                        </div>
                    </div>
                    {(() => {
                        const cached = aiResultCacheRef.current.get(hoverCard.entry.path)
                        if (cached) {
                            return (
                                <div className="border-t border-slate-100 dark:border-gray-700 pt-2 mt-2">
                                    <div className="flex items-center gap-1 mb-1">
                                        <Sparkles size={10} className="text-purple-400" />
                                        <span className="text-[10px] font-semibold text-slate-500 dark:text-gray-400">{t('aiOperation.completed')}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed line-clamp-4">{cached}</p>
                                    <button
                                        onClick={() => setHoverCard(null)}
                                        className="mt-2 text-[10px] text-primary hover:text-primary-dark font-medium"
                                    >
                                        {t('common.close')}
                                    </button>
                                </div>
                            )
                        }
                        return (
                            <div className="border-t border-slate-100 dark:border-gray-700 pt-2 mt-2">
                                <div className="flex items-center gap-1 mb-1">
                                    <Sparkles size={10} className="text-slate-300 dark:text-gray-600" />
                                    <span className="text-[10px] text-slate-400 dark:text-gray-500">{t('expertMode.scanCompleteHint')}</span>
                                </div>
                                <p className="text-[10px] text-slate-400 dark:text-gray-500">
                                    {t('aiOperation.currentTask')}: {hoverCard.entry.path}
                                </p>
                            </div>
                        )
                    })()}
                </div>
            )}
        </div>
    )
}