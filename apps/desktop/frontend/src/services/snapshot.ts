// 快照服务 - 保存和管理扫描快照（文件系统 + gzip 压缩）
//
// 磁盘策略：
// - 索引 snapshots/index.json 只存元数据，列表展示不需要解压任何快照
// - 单快照存 snapshots/<id>.json.gz：JSON 键名高度重复，gzip 后一般只剩 1/8 ~ 1/12
// - 序列化不加缩进，进一步减少体积
// - 改名只改索引，不重写压缩文件；读取时以索引里的 name 为准

import type { TreemapNode } from '../components/Treemap'
import type { AnalysisResult, CleanupSuggestion } from './ai-analysis'
import {
  readJSON,
  writeJSON,
  deleteStorageFile,
  readStorageFile,
  readStorageFileGzip,
  writeStorageFileGzip,
} from './storage'

/** 按大小排序的前 N 大文件条目（MFT 扫描时由后端填充） */
export interface TopFileEntry {
  path: string
  size: number
  modified?: number | null
}

/** 扫描结果（与后端 ScanResult 对应） */
export interface ScanResult {
  root: TreemapNode
  scan_time_ms: number
  file_count: number
  total_size: number
  /** 当 MFT 扫描失败并回退到普通扫描时，后端会设置此字段 */
  scan_warning?: string | null
  /** 卷总容量（字节） */
  volume_total_bytes?: number | null
  /** 卷剩余可用空间（字节） */
  volume_free_bytes?: number | null
  /** 按大小排序的前 N 大文件，供摘要与 AI 分析用，避免遍历整棵树 */
  top_files?: TopFileEntry[] | null
}

/** 扫描参数（恢复后与一次真实扫描的上下文保持一致） */
export interface SnapshotScanOptions {
  shallowDirs: boolean
  useMft: boolean
  promptFileCount?: number
}

/** 快照里保存的 AI 分析结果 */
export interface SnapshotAI {
  summary: string
  suggestions: CleanupSuggestion[]
  tokenUsage?: AnalysisResult['tokenUsage']
  /** 实际发送给模型的用户消息全文（磁盘摘要 + 自定义指令） */
  prompt?: string
  /** 生成该结果的模型名 */
  model?: string
  /** 分析完成时间（ms） */
  analyzedAt?: number
}

export interface Snapshot {
  version: 2
  id: string
  name: string
  /** 被扫描的路径 */
  path: string
  /** 快照创建时间（ms） */
  timestamp: number
  /** 创建时间 ISO 字符串（冗余保存，便于人工查看） */
  createdAt: string
  /** 最后修改时间（ms） */
  updatedAt?: number
  /** 生成快照时的界面模式 */
  mode?: 'standard' | 'developer'
  scanResult: ScanResult
  scan?: SnapshotScanOptions
  ai?: SnapshotAI | null
  /** 已删除的路径（保留界面状态） */
  deletedPaths?: string[]
  /** 删除 / 迁移的操作覆盖 */
  actionOverrides?: Array<[string, 'delete' | 'move']>
}

/** 快照列表项（仅元数据，不含完整扫描结果） */
export interface SnapshotMetadata {
  id: string
  name: string
  path: string
  timestamp: number
  createdAt?: string
  file_count: number
  total_size: number
  scan_time_ms: number
  /** 是否包含 AI 分析结果 */
  has_ai?: boolean
  /** 快照文件在磁盘上的实际占用（字节，压缩后） */
  size_bytes?: number
}

/** 保存快照的入参 */
export type SnapshotInput = Omit<
  Snapshot,
  'version' | 'id' | 'timestamp' | 'createdAt' | 'updatedAt'
>

const SNAPSHOTS_INDEX = 'snapshots/index.json'
const MAX_SNAPSHOTS = 50

const packedFile = (id: string) => `snapshots/${id}.json.gz`
const legacyFile = (id: string) => `snapshots/${id}.json`

const randomId = () =>
  Date.now().toString(36) + Math.random().toString(36).substring(2, 10)

async function loadSnapshotIndex(): Promise<SnapshotMetadata[]> {
  return await readJSON<SnapshotMetadata[]>(SNAPSHOTS_INDEX, [])
}

async function saveSnapshotIndex(index: SnapshotMetadata[]): Promise<void> {
  await writeJSON(SNAPSHOTS_INDEX, index)
}

/** 加载所有快照元数据（不解压快照文件） */
export async function loadSnapshots(): Promise<SnapshotMetadata[]> {
  return await loadSnapshotIndex()
}

/**
 * 保存快照：完整写入扫描结果、扫描参数、AI 分析与界面状态，gzip 压缩落盘
 */
export async function saveSnapshot(input: SnapshotInput): Promise<Snapshot> {
  const index = await loadSnapshotIndex()
  const now = Date.now()
  const id = randomId()

  const snapshot: Snapshot = {
    version: 2,
    id,
    timestamp: now,
    createdAt: new Date(now).toISOString(),
    updatedAt: now,
    ...input,
  }

  let sizeBytes = 0
  try {
    sizeBytes = await writeStorageFileGzip(packedFile(id), JSON.stringify(snapshot))
  } catch (error) {
    throw new Error(`保存快照数据失败: ${error}`)
  }

  // 元数据直接取自内存中的快照，避免再解压一次
  const metadata: SnapshotMetadata = {
    id,
    name: snapshot.name,
    path: snapshot.path,
    timestamp: snapshot.timestamp,
    createdAt: snapshot.createdAt,
    file_count: snapshot.scanResult.file_count,
    total_size: snapshot.scanResult.total_size,
    scan_time_ms: snapshot.scanResult.scan_time_ms,
    has_ai: !!snapshot.ai,
    size_bytes: sizeBytes,
  }

  index.unshift(metadata)

  // 限制最多保存 50 个快照
  if (index.length > MAX_SNAPSHOTS) {
    for (const old of index.splice(MAX_SNAPSHOTS)) {
      await removeSnapshotFiles(old.id)
    }
  }

  await saveSnapshotIndex(index)
  return snapshot
}

/** 删除快照（索引 + 快照文件，兼容旧版未压缩文件） */
export async function deleteSnapshot(id: string): Promise<void> {
  const index = await loadSnapshotIndex()
  await removeSnapshotFiles(id)
  await saveSnapshotIndex(index.filter((s) => s.id !== id))
}

/** 清空全部快照 */
export async function clearSnapshots(): Promise<void> {
  const index = await loadSnapshotIndex()
  for (const item of index) {
    await removeSnapshotFiles(item.id)
  }
  await saveSnapshotIndex([])
}

async function removeSnapshotFiles(id: string): Promise<void> {
  for (const file of [packedFile(id), legacyFile(id)]) {
    try {
      await deleteStorageFile(file)
    } catch (error) {
      console.warn(`删除快照文件失败: ${file}`, error)
    }
  }
}

/**
 * 读取单个快照（完整数据）。旧版快照是未压缩 json，这里自动回退兼容
 */
export async function getSnapshot(id: string): Promise<Snapshot | null> {
  try {
    const compressed = await readStorageFileGzip(packedFile(id))
    const text = compressed || (await readStorageFile(legacyFile(id)))
    if (!text) return null

    const snapshot = JSON.parse(text) as Snapshot
    // 改名只写入索引，这里以索引为准，避免为了改名重写整个压缩快照
    const meta = (await loadSnapshotIndex()).find((s) => s.id === id)
    if (meta) snapshot.name = meta.name
    return snapshot
  } catch (error) {
    console.error(`加载快照失败: ${id}`, error)
    return null
  }
}

/**
 * 重命名快照：只改索引，不动压缩文件
 */
export async function updateSnapshotName(id: string, name: string): Promise<void> {
  const index = await loadSnapshotIndex()
  const metadata = index.find((s) => s.id === id)
  if (!metadata) return
  metadata.name = name
  await saveSnapshotIndex(index)
}
