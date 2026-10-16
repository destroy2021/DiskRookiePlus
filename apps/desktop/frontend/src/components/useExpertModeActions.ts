import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { showNotification } from '../services/notification'
import { deleteItem, trashItem, type AnalysisResult } from '../services/ai-analysis'
import { saveSnapshot } from '../services/snapshot'
import { readStorageFile, writeStorageFile } from '../services/storage'
import { loadAppSettings, getEnabledCloudStorageConfigs, CLOUD_STORAGE_PROVIDERS, type CloudStorageConfig } from '../services/settings'
import { addToSafeList } from '../services/safeList'
import { buildDefaultSnapshotName, buildFileListSummary, parseSizeToBytes } from './ExpertMode.utils'
import type { ScanResult, AnalysisSession } from './ExpertMode.types'
import { SKIP_SAFELIST_CONFIRM_KEY } from './ExpertMode.types'

export interface ActionsState {
    deletedPaths: Set<string>
    setDeletedPaths: React.Dispatch<React.SetStateAction<Set<string>>>
    actionFilter: 'all' | 'delete' | 'move'
    setActionFilter: (v: 'all' | 'delete' | 'move') => void
    selectedItems: Set<string>
    setSelectedItems: React.Dispatch<React.SetStateAction<Set<string>>>
    actionOverrides: Map<string, 'delete' | 'move'>
    setActionOverrides: React.Dispatch<React.SetStateAction<Map<string, 'delete' | 'move'>>>
    deleteMode: 'permanent' | 'trash'
    setDeleteMode: (v: 'permanent' | 'trash') => void
    isDragSelecting: boolean
    safeListDialog: { open: boolean; path: string | null; dontRemind: boolean }
    setSafeListDialog: React.Dispatch<React.SetStateAction<{ open: boolean; path: string | null; dontRemind: boolean }>>
    addedToSafeListPaths: Set<string>
    setAddedToSafeListPaths: React.Dispatch<React.SetStateAction<Set<string>>>
    showSaveDialog: boolean
    setShowSaveDialog: (v: boolean) => void
    snapshotName: string
    setSnapshotName: (v: string) => void
    showCloudSelector: boolean
    setShowCloudSelector: (v: boolean) => void
    availableConfigs: CloudStorageConfig[]
    setAvailableConfigs: (v: CloudStorageConfig[]) => void
    selectedMigrationConfigs: CloudStorageConfig[]
    setSelectedMigrationConfigs: (v: CloudStorageConfig[]) => void
    migrationTargetNames: string
    handleDelete: (itemPath: string, mode?: 'trash' | 'permanent') => Promise<void>
    handleSelectChange: (path: string, selected: boolean) => void
    handleSelectionDragStart: (path: string, selected: boolean) => void
    handleSelectionDragEnter: (path: string) => void
    handleSelectionDragEnd: () => void
    handleToggleAction: (path: string, currentAction: 'delete' | 'move') => void
    getActualAction: (path: string, originalAction: 'delete' | 'move') => 'delete' | 'move'
    handleAddToSafeListClick: (itemPath: string) => Promise<void>
    handleSafeListConfirm: () => Promise<void>
    handleSelectAll: () => void
    handleMove: (itemPath: string, configs?: CloudStorageConfig[], targetPath?: string, fileSize?: number) => Promise<void>
    handleBatchExecute: () => Promise<void>
    handleSaveSnapshot: () => void
    handleConfirmSaveSnapshot: () => Promise<void>
    handleSetMigrationTarget: () => Promise<void>
    handleCloudStorageSelected: (configs: CloudStorageConfig[]) => void
}

interface ActionsDeps {
    result: ScanResult | null
    path: string
    analysisResult: AnalysisResult | null
    onAddMigrateTask?: (sourcePath: string, fileSize: number, targetConfigs: CloudStorageConfig[], targetPath: string) => string
    onFileDeleted?: (callback: ((path: string) => void) | null) => void
    getSessionsForSnapshot?: () => AnalysisSession[]
}

export function useExpertModeActions(deps: ActionsDeps): ActionsState {
    const { t } = useTranslation()
    const [deletedPaths, setDeletedPaths] = useState<Set<string>>(new Set())
    const [actionFilter, setActionFilter] = useState<'all' | 'delete' | 'move'>('all')
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
    const [actionOverrides, setActionOverrides] = useState<Map<string, 'delete' | 'move'>>(new Map())
    const [deleteMode, setDeleteMode] = useState<'permanent' | 'trash'>('trash')
    const dragSelectStateRef = useRef<{ active: boolean; mode: 'select' | 'deselect' }>({
        active: false,
        mode: 'select',
    })
    const [isDragSelecting, setIsDragSelecting] = useState(false)

    const [safeListDialog, setSafeListDialog] = useState<{ open: boolean; path: string | null; dontRemind: boolean }>({ open: false, path: null, dontRemind: false })
    const [addedToSafeListPaths, setAddedToSafeListPaths] = useState<Set<string>>(new Set())

    const [showSaveDialog, setShowSaveDialog] = useState(false)
    const [snapshotName, setSnapshotName] = useState('')

    const [showCloudSelector, setShowCloudSelector] = useState(false)
    const [availableConfigs, setAvailableConfigs] = useState<CloudStorageConfig[]>([])
    const [selectedMigrationConfigs, setSelectedMigrationConfigs] = useState<CloudStorageConfig[]>([])
    const [migrationTargetNames, setMigrationTargetNames] = useState<string>('')

    const handleDelete = useCallback(async (itemPath: string, mode?: 'trash' | 'permanent') => {
        const effectiveDeleteMode = mode ?? deleteMode
        if (effectiveDeleteMode === 'trash') {
            await trashItem(itemPath)
        } else {
            await deleteItem(itemPath)
        }
        setDeletedPaths(prev => new Set([...prev, itemPath]))
        setSelectedItems(prev => {
            const next = new Set(prev)
            next.delete(itemPath)
            return next
        })
    }, [deleteMode])

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

    const applyDragSelection = useCallback((path: string) => {
        const dragState = dragSelectStateRef.current
        if (!dragState.active) return
        setSelectedItems(prev => {
            const next = new Set(prev)
            if (dragState.mode === 'select') {
                next.add(path)
            } else {
                next.delete(path)
            }
            return next
        })
    }, [])

    const handleSelectionDragStart = useCallback((path: string, selected: boolean) => {
        dragSelectStateRef.current = {
            active: true,
            mode: selected ? 'deselect' : 'select',
        }
        setIsDragSelecting(true)
        applyDragSelection(path)
    }, [applyDragSelection])

    const handleSelectionDragEnter = useCallback((path: string) => {
        applyDragSelection(path)
    }, [applyDragSelection])

    const handleSelectionDragEnd = useCallback(() => {
        if (!dragSelectStateRef.current.active) return
        dragSelectStateRef.current.active = false
        setIsDragSelecting(false)
    }, [])

    const handleToggleAction = useCallback((path: string, currentAction: 'delete' | 'move') => {
        setActionOverrides(prev => {
            const next = new Map(prev)
            const newAction = currentAction === 'delete' ? 'move' : 'delete'
            next.set(path, newAction)
            return next
        })
    }, [])

    useEffect(() => {
        const releaseDrag = () => {
            if (!dragSelectStateRef.current.active) return
            dragSelectStateRef.current.active = false
            setIsDragSelecting(false)
        }

        window.addEventListener('mouseup', releaseDrag)
        window.addEventListener('blur', releaseDrag)

        return () => {
            window.removeEventListener('mouseup', releaseDrag)
            window.removeEventListener('blur', releaseDrag)
        }
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

    const handleSelectAll = useCallback(() => {
        if (!deps.analysisResult) return

        const allPaths = deps.analysisResult.suggestions
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
    }, [deps.analysisResult, deletedPaths, addedToSafeListPaths, actionFilter, selectedItems, getActualAction])

    const handleMove = useCallback(async (itemPath: string, configs?: CloudStorageConfig[], targetPath?: string, fileSize?: number) => {
        const targetConfigs = configs || selectedMigrationConfigs
        const cloudPath = targetPath || '/'

        if (!targetConfigs || targetConfigs.length === 0) {
            throw new Error('No cloud storage target selected')
        }

        if (deps.onAddMigrateTask) {
            const size = fileSize || 0
            deps.onAddMigrateTask(itemPath, size, targetConfigs, cloudPath)
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

        console.log('迁移完成:', results)
    }, [selectedMigrationConfigs, deps.onAddMigrateTask])

    const handleBatchExecute = useCallback(async () => {
        if (selectedItems.size === 0 || !deps.analysisResult) return

        const itemsToProcess = deps.analysisResult.suggestions.filter(s =>
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
    }, [selectedItems, deps.analysisResult, deletedPaths, addedToSafeListPaths, handleDelete, handleMove, selectedMigrationConfigs, getActualAction, t])

    const handleSaveSnapshot = useCallback(() => {
        if (!deps.result || !deps.path) return
        setSnapshotName(buildDefaultSnapshotName(deps.path))
        setShowSaveDialog(true)
    }, [deps.result, deps.path])

    const handleConfirmSaveSnapshot = useCallback(async () => {
        if (!deps.result || !deps.path || !snapshotName.trim()) return

        try {
            const appSettings = await loadAppSettings()
            const summary = await buildFileListSummary(deps.result, appSettings.promptFileCount)
            await saveSnapshot({
                name: snapshotName.trim(),
                path: deps.path,
                scanResult: deps.result,
                summary,
                ai_prompt: '',
                ai_raw_text: '',
                ai_structured_result: deps.analysisResult,
                sessions: deps.getSessionsForSnapshot?.() ?? [],
            })
            setShowSaveDialog(false)
            setSnapshotName('')
            showNotification(t('snapshot.saveSuccess'), t('snapshot.savedSnapshot', { name: snapshotName.trim() }))
        } catch (e) {
            showNotification(t('snapshot.saveFailed'), String(e))
        }
    }, [deps, snapshotName, t])

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
        if (deps.onFileDeleted) {
            const handleFileDeleted = (path: string) => {
                setDeletedPaths(prev => new Set([...prev, path]))
                setSelectedItems(prev => {
                    const next = new Set(prev)
                    next.delete(path)
                    return next
                })
            }
            deps.onFileDeleted?.(handleFileDeleted)
            return () => {
                deps.onFileDeleted?.(null)
            }
        }
    }, [deps.onFileDeleted])

    return {
        deletedPaths, setDeletedPaths, actionFilter, setActionFilter,
        selectedItems, setSelectedItems, actionOverrides, setActionOverrides,
        deleteMode, setDeleteMode, isDragSelecting,
        safeListDialog, setSafeListDialog, addedToSafeListPaths, setAddedToSafeListPaths,
        showSaveDialog, setShowSaveDialog, snapshotName, setSnapshotName,
        showCloudSelector, setShowCloudSelector, availableConfigs, setAvailableConfigs,
        selectedMigrationConfigs, setSelectedMigrationConfigs, migrationTargetNames,
        handleDelete, handleSelectChange,
        handleSelectionDragStart, handleSelectionDragEnter, handleSelectionDragEnd,
        handleToggleAction, getActualAction,
        handleAddToSafeListClick, handleSafeListConfirm, handleSelectAll,
        handleMove, handleBatchExecute,
        handleSaveSnapshot, handleConfirmSaveSnapshot,
        handleSetMigrationTarget, handleCloudStorageSelected,
    }
}
