import { formatBytes } from '../utils/format'
import { loadAppSettings } from '../services/settings'
import { loadSafeListPaths, isPathInSafeList } from '../services/safeList'
import { readStorageFile, writeStorageFile } from '../services/storage'
import type { TreemapNode } from './Treemap'
import type { DirectoryTopNResult, CleanupSuggestion } from '../services/ai-analysis'
import type {
    ScanResult,
    SummaryEntry,
    ExtensionStat,
    FileCandidate,
    SuggestionGroup,
} from './ExpertMode.types'
import {
    PROMPT_INSTRUCTION_FILE,
    FILE_LIST_SUMMARY_CACHE_MAX,
    DEFAULT_PROMPT_INSTRUCTION,
} from './ExpertMode.types'

export { DEFAULT_PROMPT_INSTRUCTION, PROMPT_INSTRUCTION_FILE, FILE_LIST_SUMMARY_CACHE_MAX }

const fileListSummaryCache = new Map<string, string>()

export function buildSummaryCacheKey(result: ScanResult, fileCount: number): string {
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

export function normalizeScanPath(p: string): string {
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

export function findNodeInTree(root: TreemapNode, targetPath: string): TreemapNode | null {
    const norm = normalizeScanPath(targetPath).toLowerCase()
    const queue: TreemapNode[] = [root]
    while (queue.length > 0) {
        const node = queue.shift()!
        if (normalizeScanPath(node.path).toLowerCase() === norm) return node
        if (node.children) {
            for (const child of node.children) queue.push(child)
        }
    }
    return null
}

export function extractSubDirFromCache(root: TreemapNode, targetPath: string) {
    const node = findNodeInTree(root, targetPath)
    if (!node || !node.children) return null
    const dirs: { path: string; name: string; size: number; file_count: number | null; dir_count: number | null; is_dir: boolean }[] = []
    const files: { path: string; size: number; modified: number | null }[] = []
    const extMap = new Map<string, { size: number; count: number }>()
    let totalSize = 0
    let fileCount = 0
    let dirCount = 0
    for (const child of node.children) {
        totalSize += child.size
        if (child.is_dir) {
            dirCount++
            dirs.push({ path: child.path, name: child.name, size: child.size, file_count: null, dir_count: null, is_dir: true })
        } else {
            fileCount++
            files.push({ path: child.path, size: child.size, modified: child.modified ?? null })
            const ext = child.name.includes('.') ? child.name.slice(child.name.lastIndexOf('.')) : '(no ext)'
            const entry = extMap.get(ext) ?? { size: 0, count: 0 }
            entry.size += child.size
            entry.count++
            extMap.set(ext, entry)
        }
    }
    dirs.sort((a, b) => b.size - a.size)
    files.sort((a, b) => b.size - a.size)
    const extensionStats = Array.from(extMap.entries())
        .map(([ext, v]) => ({ ext, size: v.size, count: v.count }))
        .sort((a, b) => b.size - a.size)
    return {
        path: targetPath,
        name: node.name,
        total_size: totalSize,
        file_count: fileCount,
        dir_count: dirCount,
        top_files: files.slice(0, 30),
        top_directories: dirs.slice(0, 20),
        extension_stats: extensionStats.slice(0, 20),
        scan_time_ms: 0,
    }
}

export function buildSubDirSummary(targetPath: string, res: DirectoryTopNResult): string {
    const topDirs = res.top_directories.slice(0, 20).map(d => `${d.path}\t${formatBytes(d.size)}\t${d.file_count ?? '-'} files`).join('\n')
    const topFiles = res.top_files.slice(0, 30).map(f => `${f.path}\t${formatBytes(f.size)}\t${f.modified ? new Date(f.modified * 1000).toLocaleDateString() : '-'}`).join('\n')
    const extStats = res.extension_stats.slice(0, 20).map(e => `${e.ext}\t${formatBytes(e.size)}\t${e.count} files`).join('\n')
    return [
        `[子目录分析摘要]`,
        `分析路径: ${targetPath}`,
        `总大小: ${formatBytes(res.total_size)}`,
        `文件数: ${res.file_count}`,
        `目录数: ${res.dir_count}`,
        '',
        '## 最大目录 Top 20',
        '路径\t大小\t文件数',
        topDirs,
        '',
        `## 最大文件 Top 30`,
        '路径\t大小\t修改时间',
        topFiles,
        '',
        '## 扩展名聚合 Top 20',
        '扩展名\t总大小\t文件数',
        extStats,
    ].join('\n')
}

export function buildDefaultSnapshotName(path: string): string {
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

export function isAbortError(error: unknown): boolean {
    if (!error) return false
    if (error instanceof DOMException && error.name === 'AbortError') return true
    if (error instanceof Error && error.name === 'AbortError') return true
    const text = String(error).toLowerCase()
    return text.includes('aborterror') || text.includes('aborted') || text.includes('interrupted')
}

export async function loadPromptInstruction(): Promise<string> {
    try {
        const stored = await readStorageFile(PROMPT_INSTRUCTION_FILE)
        return stored || DEFAULT_PROMPT_INSTRUCTION
    } catch { return DEFAULT_PROMPT_INSTRUCTION }
}

export async function savePromptInstruction(instruction: string): Promise<void> {
    try {
        await writeStorageFile(PROMPT_INSTRUCTION_FILE, instruction)
    } catch {
        // ignore storage errors
    }
}

export function displayPath(raw: string): string {
    return raw.replace(/^\\\\\?\\/, '')
}

export function formatCount(n: number): string {
    return n.toLocaleString('zh-CN')
}

export function formatModified(ts: number | undefined | null): string {
    if (ts == null) return '-'
    try {
        const d = new Date(ts * 1000)
        return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    } catch {
        return '-'
    }
}

export function normalizeExtLabel(ext: string): string {
    if (!ext || ext === '[no_ext]') return '(无扩展名)'
    return ext.startsWith('.') ? ext : `.${ext}`
}

export function mdEscape(text: string): string {
    return text.replace(/\|/g, '\\|')
}

export function mdTable(headers: string[], rows: string[][]): string {
    const header = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`
    if (rows.length === 0) return `${header}\n| (无数据) | - | - |`
    const body = rows.map((r) => `| ${r.map(mdEscape).join(' | ')} |`).join('\n')
    return `${header}\n${body}`
}

export function collectFallbackSummary(root: TreemapNode): {
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
        if (node.children) {
            for (const child of node.children) {
                const c = walk(child, false, depth + 1)
                files += c.files
                dirs += c.dirs
            }
        }

        if (!isRoot && depth <= 3) {
            topDirectories.push({
                path: node.path || node.name,
                name: node.name,
                size: node.size,
                file_count: files,
                dir_count: dirs,
                is_dir: true,
            })
        }

        countByPath.set(node.path || node.name, { files, dirs })
        return { files, dirs: dirs + 1 }
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

export async function buildFileListSummary(result: ScanResult, fileCount?: number): Promise<string> {
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

export function parseSizeToBytes(sizeStr: string): number {
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

export function groupSuggestionsByParent(suggestions: CleanupSuggestion[]): SuggestionGroup[] {
    const mainGroup: CleanupSuggestion[] = []
    const subDirMap = new Map<string, CleanupSuggestion[]>()

    for (const s of suggestions) {
        const parent = (s as CleanupSuggestion & { _parentPath?: string })._parentPath
        if (!parent) {
            mainGroup.push(s)
        } else {
            const existing = subDirMap.get(parent)
            if (existing) {
                existing.push(s)
            } else {
                subDirMap.set(parent, [s])
            }
        }
    }

    const groups: SuggestionGroup[] = []

    if (mainGroup.length > 0) {
        groups.push({
            parentPath: null,
            parentName: '',
            suggestions: mainGroup,
            source: 'main',
        })
    }

    for (const [parentPath, items] of subDirMap) {
        const sep = parentPath.includes('/') ? '/' : '\\'
        const parentName = parentPath.split(sep).filter(Boolean).pop() || parentPath
        groups.push({
            parentPath,
            parentName,
            suggestions: items,
            source: 'subdir',
        })
    }

    groups.sort((a, b) => {
        if (a.source === 'main' && b.source !== 'main') return -1
        if (a.source !== 'main' && b.source === 'main') return 1
        return (a.parentPath ?? '').localeCompare(b.parentPath ?? '')
    })

    return groups
}
