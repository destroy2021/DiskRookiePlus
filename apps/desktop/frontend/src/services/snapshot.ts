import type { TreemapNode } from '../components/Treemap'
import type { AnalysisResult } from './ai-analysis'
import { readJSON, writeJSON, deleteStorageFile } from './storage'
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

  await writeJSON(filePath, newSnapshot)
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
  return newSnapshot
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
