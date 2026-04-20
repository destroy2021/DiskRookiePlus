import type { TreemapNode } from '../components/Treemap'
import type { AnalysisResult } from './ai-analysis'
import { invoke } from '@tauri-apps/api/core'
import { readJSON, writeJSON, deleteStorageFile, getStoragePath } from './storage'
import { loadAppSettings, normalizeSnapshotSaveDir } from './settings'

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

export interface SnapshotScanResult {
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

export interface Snapshot {
  id: string
  name: string
  path: string
  timestamp: number
  schema_version: number
  scanResult: SnapshotScanResult
  summary: string
  ai_prompt: string
  ai_raw_text: string
  ai_structured_result: AnalysisResult | null
}

export interface SaveSnapshotInput {
  name: string
  path: string
  scanResult: SnapshotScanResult
  summary?: string
  ai_prompt?: string
  ai_raw_text?: string
  ai_structured_result?: AnalysisResult | null
}

export interface SnapshotMetadata {
  id: string
  name: string
  path: string
  timestamp: number
  file_count: number
  total_size: number
  scan_time_ms: number
  file_path?: string
  file_name?: string
}

const SNAPSHOTS_INDEX = 'snapshots/index.json'
const LEGACY_SNAPSHOT_DIR = 'snapshots'
const SNAPSHOT_SCHEMA_VERSION = 3
const SNAPSHOT_LIMIT = 50
const BROWSER_STORAGE_PREFIX = 'browser://'
const SNAPSHOT_TRUNCATE_SUFFIX = '\n...[snapshot truncated for size]'

interface SnapshotPersistProfile {
  maxSummaryChars: number
  maxAiPromptChars: number
  maxAiRawTextChars: number
  maxSuggestions: number
  maxSuggestionMessageChars: number
  maxAnalysisSummaryChars: number
  maxAnalysisPromptChars: number
  maxAnalysisRawChars: number
  maxTopEntries: number
  maxTreeNodes: number
  maxTreeDepth: number
  maxChildrenPerDir: number
}

const SNAPSHOT_PERSIST_PROFILE_REDUCED: SnapshotPersistProfile = {
  maxSummaryChars: 300_000,
  maxAiPromptChars: 300_000,
  maxAiRawTextChars: 800_000,
  maxSuggestions: 2_000,
  maxSuggestionMessageChars: 2_000,
  maxAnalysisSummaryChars: 100_000,
  maxAnalysisPromptChars: 200_000,
  maxAnalysisRawChars: 600_000,
  maxTopEntries: 8_000,
  maxTreeNodes: 120_000,
  maxTreeDepth: 18,
  maxChildrenPerDir: 2_000,
}

const SNAPSHOT_PERSIST_PROFILE_MINIMAL: SnapshotPersistProfile = {
  maxSummaryChars: 120_000,
  maxAiPromptChars: 100_000,
  maxAiRawTextChars: 200_000,
  maxSuggestions: 500,
  maxSuggestionMessageChars: 1_000,
  maxAnalysisSummaryChars: 50_000,
  maxAnalysisPromptChars: 80_000,
  maxAnalysisRawChars: 150_000,
  maxTopEntries: 2_000,
  maxTreeNodes: 25_000,
  maxTreeDepth: 12,
  maxChildrenPerDir: 600,
}

export type OpenSnapshotDirectoryResult = 'ok' | 'not_found' | 'unsupported'

async function loadSnapshotIndex(): Promise<SnapshotMetadata[]> {
  return await readJSON<SnapshotMetadata[]>(SNAPSHOTS_INDEX, [])
}

async function saveSnapshotIndex(index: SnapshotMetadata[]): Promise<void> {
  await writeJSON(SNAPSHOTS_INDEX, index)
}

function normalizeSnapshot(raw: Partial<Snapshot> | null): Snapshot | null {
  if (!raw || !raw.id || !raw.name || !raw.path || !raw.scanResult) return null
  const scan = raw.scanResult
  if (
    typeof scan.scan_time_ms !== 'number' ||
    typeof scan.file_count !== 'number' ||
    typeof scan.total_size !== 'number' ||
    !scan.root
  ) {
    return null
  }
  return {
    id: raw.id,
    name: raw.name,
    path: raw.path,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
    schema_version: typeof raw.schema_version === 'number' ? raw.schema_version : 1,
    scanResult: scan,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    ai_prompt: typeof raw.ai_prompt === 'string' ? raw.ai_prompt : '',
    ai_raw_text: typeof raw.ai_raw_text === 'string' ? raw.ai_raw_text : '',
    ai_structured_result: raw.ai_structured_result ?? null,
  }
}

function isInvalidStringLengthError(error: unknown): boolean {
  if (error instanceof RangeError) return true
  const text = String(error).toLowerCase()
  return text.includes('invalid string length') || text.includes('out of memory')
}

function truncateText(input: string, maxChars: number): { value: string; truncated: boolean } {
  if (maxChars <= 0) {
    return { value: '', truncated: input.length > 0 }
  }
  if (input.length <= maxChars) {
    return { value: input, truncated: false }
  }
  const keep = Math.max(0, maxChars - SNAPSHOT_TRUNCATE_SUFFIX.length)
  return {
    value: `${input.slice(0, keep)}${SNAPSHOT_TRUNCATE_SUFFIX}`,
    truncated: true,
  }
}

function limitArray<T>(items: T[] | null | undefined, maxCount: number): { value: T[] | undefined; truncated: boolean } {
  if (!items) return { value: items ?? undefined, truncated: false }
  if (items.length <= maxCount) return { value: items, truncated: false }
  return { value: items.slice(0, maxCount), truncated: true }
}

function pruneTreemapRoot(
  root: TreemapNode,
  maxNodes: number,
  maxDepth: number,
  maxChildrenPerDir: number,
): { value: TreemapNode; truncated: boolean } {
  let truncated = false
  let remainingNodes = Math.max(0, maxNodes - 1)

  const cloneNode = (node: TreemapNode, depth: number): TreemapNode => {
    const cloned: TreemapNode = {
      name: node.name,
      path: node.path,
      size: node.size,
      is_dir: node.is_dir,
      modified: node.modified,
    }

    const children = node.children ?? []
    if (children.length === 0) return cloned
    if (depth >= maxDepth || remainingNodes <= 0) {
      truncated = true
      return cloned
    }

    const limitedChildren: TreemapNode[] = []
    for (const child of children) {
      if (limitedChildren.length >= maxChildrenPerDir || remainingNodes <= 0) {
        truncated = true
        break
      }
      remainingNodes -= 1
      limitedChildren.push(cloneNode(child, depth + 1))
    }

    if (limitedChildren.length > 0) {
      cloned.children = limitedChildren
    } else if (children.length > 0) {
      truncated = true
    }

    return cloned
  }

  return { value: cloneNode(root, 0), truncated }
}

function appendSnapshotWarning(existing: string | null | undefined, message: string): string {
  const current = (existing ?? '').trim()
  if (!current) return message
  if (current.includes(message)) return current
  return `${current}; ${message}`
}

function reduceAnalysisResult(
  input: AnalysisResult | null,
  profile: SnapshotPersistProfile,
): { value: AnalysisResult | null; truncated: boolean } {
  if (!input) return { value: null, truncated: false }

  let truncated = false
  const suggestions = input.suggestions.slice(0, profile.maxSuggestions).map((item) => {
    const msg = truncateText(item.message, profile.maxSuggestionMessageChars)
    if (msg.truncated) truncated = true
    return { ...item, message: msg.value }
  })
  if (suggestions.length < input.suggestions.length) {
    truncated = true
  }

  const summary = truncateText(input.summary, profile.maxAnalysisSummaryChars)
  const promptText = truncateText(input.promptText ?? '', profile.maxAnalysisPromptChars)
  const rawText = truncateText(input.rawText ?? '', profile.maxAnalysisRawChars)
  if (summary.truncated || promptText.truncated || rawText.truncated) {
    truncated = true
  }

  return {
    value: {
      ...input,
      suggestions,
      summary: summary.value,
      promptText: input.promptText == null ? undefined : promptText.value,
      rawText: input.rawText == null ? undefined : rawText.value,
    },
    truncated,
  }
}

function reduceSnapshotForPersist(snapshot: Snapshot, profile: SnapshotPersistProfile): { value: Snapshot; truncated: boolean } {
  let truncated = false

  const summary = truncateText(snapshot.summary, profile.maxSummaryChars)
  const aiPrompt = truncateText(snapshot.ai_prompt, profile.maxAiPromptChars)
  const aiRawText = truncateText(snapshot.ai_raw_text, profile.maxAiRawTextChars)
  if (summary.truncated || aiPrompt.truncated || aiRawText.truncated) {
    truncated = true
  }

  const analysis = reduceAnalysisResult(snapshot.ai_structured_result, profile)
  if (analysis.truncated) truncated = true

  const topFiles = limitArray(snapshot.scanResult.top_files ?? undefined, profile.maxTopEntries)
  const topDirectories = limitArray(snapshot.scanResult.top_directories ?? undefined, profile.maxTopEntries)
  const rootChildren = limitArray(snapshot.scanResult.root_children ?? undefined, profile.maxTopEntries)
  const extensionStats = limitArray(snapshot.scanResult.extension_stats ?? undefined, profile.maxTopEntries)
  if (topFiles.truncated || topDirectories.truncated || rootChildren.truncated || extensionStats.truncated) {
    truncated = true
  }

  const root = pruneTreemapRoot(
    snapshot.scanResult.root,
    profile.maxTreeNodes,
    profile.maxTreeDepth,
    profile.maxChildrenPerDir,
  )
  if (root.truncated) truncated = true

  const warningMessage = 'Snapshot payload was truncated to avoid oversized JSON serialization.'
  const scanWarning = truncated
    ? appendSnapshotWarning(snapshot.scanResult.scan_warning, warningMessage)
    : snapshot.scanResult.scan_warning

  return {
    truncated,
    value: {
      ...snapshot,
      summary: summary.value,
      ai_prompt: aiPrompt.value,
      ai_raw_text: aiRawText.value,
      ai_structured_result: analysis.value,
      scanResult: {
        ...snapshot.scanResult,
        root: root.value,
        top_files: topFiles.value ?? null,
        top_directories: topDirectories.value ?? null,
        root_children: rootChildren.value ?? null,
        extension_stats: extensionStats.value ?? null,
        scan_warning: scanWarning,
      },
    },
  }
}

async function writeSnapshotWithFallback(filePath: string, snapshot: Snapshot): Promise<Snapshot> {
  try {
    await writeJSON(filePath, snapshot)
    return snapshot
  } catch (error) {
    if (!isInvalidStringLengthError(error)) {
      throw error
    }
    console.warn('[snapshot] Full snapshot too large, falling back to reduced profile')
  }

  const reduced = reduceSnapshotForPersist(snapshot, SNAPSHOT_PERSIST_PROFILE_REDUCED)
  try {
    await writeJSON(filePath, reduced.value)
    if (reduced.truncated) {
      console.warn('[snapshot] Snapshot saved with reduced profile truncation')
    }
    return reduced.value
  } catch (error) {
    if (!isInvalidStringLengthError(error)) {
      throw error
    }
    console.warn('[snapshot] Reduced profile still too large, falling back to minimal profile')
  }

  const minimal = reduceSnapshotForPersist(snapshot, SNAPSHOT_PERSIST_PROFILE_MINIMAL)
  await writeJSON(filePath, minimal.value)
  if (minimal.truncated) {
    console.warn('[snapshot] Snapshot saved with minimal profile truncation')
  }
  return minimal.value
}

function sanitizeFilePart(input: string): string {
  const cleaned = Array.from(
    input
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_'),
    (ch) => (ch.charCodeAt(0) < 32 ? '_' : ch),
  ).join('')
  return cleaned || 'snapshot'
}

function getSnapshotSourceLabel(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return 'snapshot'
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
  const driveMatch = normalized.match(/^([A-Za-z]):$/)
  if (driveMatch) return driveMatch[1].toUpperCase()
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || 'snapshot'
}

function formatSnapshotTimestamp(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function buildSnapshotFileName(path: string, timestamp: number, seq = 0): string {
  const source = sanitizeFilePart(getSnapshotSourceLabel(path))
  const base = `${source}_snapshot_${formatSnapshotTimestamp(timestamp)}`
  return seq > 0 ? `${base}_${seq}.json` : `${base}.json`
}

function toStoragePath(dir: string, fileName: string): string {
  return `${dir}/${fileName}`.replace(/\/+/g, '/')
}

function getLegacySnapshotPath(id: string): string {
  return `${LEGACY_SNAPSHOT_DIR}/${id}.json`
}

function resolveSnapshotPath(metadata: SnapshotMetadata | undefined, id: string): string {
  return metadata?.file_path?.trim() || getLegacySnapshotPath(id)
}

function candidateSnapshotPaths(metadata: SnapshotMetadata | undefined, id: string): string[] {
  const primary = resolveSnapshotPath(metadata, id)
  const legacy = getLegacySnapshotPath(id)
  return primary === legacy ? [primary] : [primary, legacy]
}

function isPathNotFoundError(error: unknown): boolean {
  const text = String(error).toLowerCase()
  return (
    text.includes('not exist') ||
    text.includes('does not exist') ||
    text.includes('cannot find') ||
    text.includes('no such file') ||
    text.includes('no such path') ||
    text.includes('path not found') ||
    text.includes('路径不存在')
  )
}

function getSnapshotDirectoryPath(relativeFilePath: string): string {
  const normalized = relativeFilePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized) return LEGACY_SNAPSHOT_DIR
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return LEGACY_SNAPSHOT_DIR
  return normalized.slice(0, idx)
}

function joinStoragePath(storageRoot: string, relativePath: string): string {
  const root = storageRoot.trim().replace(/[\\/]+$/, '')
  const relative = relativePath.trim().replace(/^[/\\]+/, '').replace(/\\/g, '/')
  if (!relative) return root
  return `${root}/${relative}`
}

export async function loadSnapshots(): Promise<SnapshotMetadata[]> {
  return await loadSnapshotIndex()
}

export async function saveSnapshot(snapshot: SaveSnapshotInput): Promise<Snapshot> {
  const [index, appSettings] = await Promise.all([loadSnapshotIndex(), loadAppSettings()])
  const snapshotDir = normalizeSnapshotSaveDir(appSettings.snapshotSaveDir)
  const timestamp = Date.now()
  const id = `${timestamp.toString(36)}${Math.random().toString(36).slice(2, 8)}`

  const usedPaths = new Set(index.map((item) => resolveSnapshotPath(item, item.id)))
  let seq = 0
  let fileName = buildSnapshotFileName(snapshot.path, timestamp)
  let filePath = toStoragePath(snapshotDir, fileName)
  while (usedPaths.has(filePath)) {
    seq += 1
    fileName = buildSnapshotFileName(snapshot.path, timestamp, seq)
    filePath = toStoragePath(snapshotDir, fileName)
  }

  const newSnapshot: Snapshot = {
    id,
    timestamp,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    name: snapshot.name,
    path: snapshot.path,
    scanResult: snapshot.scanResult,
    summary: snapshot.summary ?? '',
    ai_prompt: snapshot.ai_prompt ?? '',
    ai_raw_text: snapshot.ai_raw_text ?? '',
    ai_structured_result: snapshot.ai_structured_result ?? null,
  }

  const metadata: SnapshotMetadata = {
    id: newSnapshot.id,
    name: newSnapshot.name,
    path: newSnapshot.path,
    timestamp: newSnapshot.timestamp,
    file_count: newSnapshot.scanResult.file_count,
    total_size: newSnapshot.scanResult.total_size,
    scan_time_ms: newSnapshot.scanResult.scan_time_ms,
    file_path: filePath,
    file_name: fileName,
  }

  const persistedSnapshot = await writeSnapshotWithFallback(filePath, newSnapshot)
  index.unshift(metadata)

  if (index.length > SNAPSHOT_LIMIT) {
    const removed = index.splice(SNAPSHOT_LIMIT)
    for (const old of removed) {
      try {
        await deleteStorageFile(resolveSnapshotPath(old, old.id))
      } catch {
        // ignore stale file cleanup failures
      }
    }
  }

  await saveSnapshotIndex(index)
  return persistedSnapshot
}

export async function deleteSnapshot(id: string): Promise<void> {
  const index = await loadSnapshotIndex()
  const target = index.find((s) => s.id === id)
  const filtered = index.filter((s) => s.id !== id)
  for (const filePath of candidateSnapshotPaths(target, id)) {
    try {
      await deleteStorageFile(filePath)
    } catch {
      // ignore missing snapshot file
    }
  }
  await saveSnapshotIndex(filtered)
}

export async function getSnapshot(id: string): Promise<Snapshot | null> {
  const index = await loadSnapshotIndex()
  const metadata = index.find((s) => s.id === id)
  for (const filePath of candidateSnapshotPaths(metadata, id)) {
    const raw = await readJSON<Partial<Snapshot> | null>(filePath, null)
    const normalized = normalizeSnapshot(raw)
    if (normalized) return normalized
  }
  return null
}

export async function updateSnapshotName(id: string, name: string): Promise<void> {
  const index = await loadSnapshotIndex()
  const metadata = index.find((s) => s.id === id)
  if (metadata) {
    metadata.name = name
    await saveSnapshotIndex(index)
  }

  for (const filePath of candidateSnapshotPaths(metadata, id)) {
    const raw = await readJSON<Partial<Snapshot> | null>(filePath, null)
    const snapshot = normalizeSnapshot(raw)
    if (!snapshot) continue
    snapshot.name = name
    await writeJSON(filePath, snapshot)
    return
  }
}

export async function openSnapshotDirectory(metadata: SnapshotMetadata): Promise<OpenSnapshotDirectoryResult> {
  const storageRoot = await getStoragePath()
  if (!storageRoot || storageRoot.startsWith(BROWSER_STORAGE_PREFIX)) {
    return 'unsupported'
  }

  const relativeFilePath = resolveSnapshotPath(metadata, metadata.id)
  const relativeDir = getSnapshotDirectoryPath(relativeFilePath)
  const absoluteDir = joinStoragePath(storageRoot, relativeDir)

  try {
    await invoke('open_in_file_manager', {
      path: absoluteDir,
      isFile: false,
    })
    return 'ok'
  } catch (error) {
    if (isPathNotFoundError(error)) {
      return 'not_found'
    }
    throw error
  }
}
