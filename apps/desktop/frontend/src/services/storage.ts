import { invoke } from '@tauri-apps/api/core'

const WEB_STORAGE_PREFIX = 'disk-rookie:'

function normalizeStoragePath(filename: string): string {
  return filename.trim().replace(/\\/g, '/').replace(/^\/+/, '')
}

function toWebStorageKey(filename: string): string {
  return `${WEB_STORAGE_PREFIX}${normalizeStoragePath(filename)}`
}

function isTauriStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false
  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown; metadata?: unknown } }).__TAURI_INTERNALS__
  return typeof internals?.invoke === 'function' && Boolean(internals?.metadata)
}

/**
 * Read a storage file.
 */
export async function readStorageFile(filename: string): Promise<string> {
  const safeName = normalizeStoragePath(filename)
  if (isTauriStorageAvailable()) {
    try {
      return await invoke<string>('read_storage_file', { filename: safeName })
    } catch (error) {
      console.error(`Read storage file failed ${safeName}:`, error)
      return ''
    }
  }

  try {
    return localStorage.getItem(toWebStorageKey(safeName)) ?? ''
  } catch (error) {
    console.error(`Read web storage failed ${safeName}:`, error)
    return ''
  }
}

/**
 * Write a storage file.
 */
export async function writeStorageFile(filename: string, content: string): Promise<void> {
  const safeName = normalizeStoragePath(filename)
  if (isTauriStorageAvailable()) {
    try {
      await invoke('write_storage_file', { filename: safeName, content })
      return
    } catch (error) {
      console.error(`Write storage file failed ${safeName}:`, error)
      throw error
    }
  }

  try {
    localStorage.setItem(toWebStorageKey(safeName), content)
  } catch (error) {
    console.error(`Write web storage failed ${safeName}:`, error)
    throw error
  }
}

/**
 * Delete a storage file.
 */
export async function deleteStorageFile(filename: string): Promise<void> {
  const safeName = normalizeStoragePath(filename)
  if (isTauriStorageAvailable()) {
    try {
      await invoke('delete_storage_file', { filename: safeName })
      return
    } catch (error) {
      console.error(`Delete storage file failed ${safeName}:`, error)
      throw error
    }
  }

  try {
    localStorage.removeItem(toWebStorageKey(safeName))
  } catch (error) {
    console.error(`Delete web storage failed ${safeName}:`, error)
    throw error
  }
}

/**
 * List files in storage root or a subdir (non-recursive).
 */
export async function listStorageFiles(subdir?: string): Promise<string[]> {
  const safeSubdir = subdir ? normalizeStoragePath(subdir).replace(/\/+$/, '') : undefined
  if (isTauriStorageAvailable()) {
    try {
      return await invoke<string[]>('list_storage_files', { subdir: safeSubdir })
    } catch (error) {
      console.error('List storage files failed:', error)
      return []
    }
  }

  try {
    const result = new Set<string>()
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(WEB_STORAGE_PREFIX)) continue
      const relative = key.slice(WEB_STORAGE_PREFIX.length)
      if (!relative) continue
      const slash = relative.lastIndexOf('/')
      const parent = slash >= 0 ? relative.slice(0, slash) : ''
      const basename = slash >= 0 ? relative.slice(slash + 1) : relative
      if (!basename) continue
      if (safeSubdir) {
        if (parent === safeSubdir) result.add(basename)
      } else if (!parent) {
        result.add(basename)
      }
    }
    return Array.from(result).sort()
  } catch (error) {
    console.error('List web storage files failed:', error)
    return []
  }
}

/**
 * Get storage root path.
 */
export async function getStoragePath(): Promise<string> {
  if (isTauriStorageAvailable()) {
    try {
      return await invoke<string>('get_storage_path')
    } catch (error) {
      console.error('Get storage path failed:', error)
      return ''
    }
  }
  return 'browser://localStorage/.disk-rookie'
}

/**
 * Read a JSON file.
 */
export async function readJSON<T>(filename: string, defaultValue: T): Promise<T> {
  try {
    const content = await readStorageFile(filename)
    if (!content) return defaultValue
    return JSON.parse(content) as T
  } catch (error) {
    console.error(`Read JSON failed ${filename}:`, error)
    return defaultValue
  }
}

/**
 * Write a JSON file.
 */
export async function writeJSON(filename: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2)
  await writeStorageFile(filename, content)
}

