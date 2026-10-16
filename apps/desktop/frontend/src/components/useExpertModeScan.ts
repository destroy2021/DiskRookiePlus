import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { showNotification } from '../services/notification'
import { loadAppSettings } from '../services/settings'
import { normalizeScanPath } from './ExpertMode.utils'
import type { ScanResult } from './ExpertMode.types'

export interface ScanState {
    path: string
    setPath: (p: string) => void
    status: 'idle' | 'scanning' | 'done' | 'error'
    scanCanceling: boolean
    errorMsg: string
    result: ScanResult | null
    progressFiles: number
    shallowDirs: boolean
    setShallowDirs: (v: boolean) => void
    runScan: (targetPath: string) => Promise<void>
    cancelScan: () => Promise<void>
    handleBrowseFolder: () => Promise<void>
    setResult: (r: ScanResult | null) => void
    setStatus: (s: 'idle' | 'scanning' | 'done' | 'error') => void
}

interface ResetCallbacks {
    setAnalysisResult: (v: null) => void
    setHasAnalyzedOnce: (v: boolean) => void
    setLatestSummary: (v: string) => void
    setLatestAiPrompt: (v: string) => void
    setLatestAiRawText: (v: string) => void
    setActionFilter: (v: 'all' | 'delete' | 'move') => void
    setActionOverrides: (v: Map<string, 'delete' | 'move'>) => void
    setSubDirAnalysisPaths: (v: string[]) => void
    setSubDirScanLoading: (v: boolean) => void
    setSubDirAiLoading: (v: boolean) => void
    setSubDirAnalysisResult: (v: null) => void
    setSubDirAnalysisResults: (v: never[]) => void
}

export function useExpertModeScan(reset: ResetCallbacks): ScanState {
    const { t } = useTranslation()
    const isTauriRuntime = typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: { metadata?: unknown } }).__TAURI_INTERNALS__?.metadata)
    const [path, setPath] = useState('')
    const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
    const [scanCanceling, setScanCanceling] = useState(false)
    const [errorMsg, setErrorMsg] = useState('')
    const [result, setResult] = useState<ScanResult | null>(null)
    const [progressFiles, setProgressFiles] = useState(0)
    const [, setProgressMessage] = useState('')
    const [shallowDirs, setShallowDirs] = useState(true)

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
            const [mftPath, usedMft] = ev.payload
            if (usedMft) {
                console.log('[DiskRookie] 本次扫描已使用 MFT 加速，路径:', mftPath)
            } else {
                console.log('[DiskRookie] 本次扫描未使用 MFT（普通目录遍历），路径:', mftPath)
            }
        }).then((fn) => { unlistenMftStatus = fn })
        return () => {
            unlistenProgress?.()
            unlistenMftStatus?.()
        }
    }, [isTauriRuntime])

    const runScan = useCallback(async (targetPath: string) => {
        if (!targetPath) return
        const pathToScan = normalizeScanPath(targetPath)
        setStatus('scanning'); setScanCanceling(false); setErrorMsg(''); setResult(null); setProgressFiles(0); setProgressMessage('')
        reset.setAnalysisResult(null); reset.setHasAnalyzedOnce(false); reset.setLatestSummary(''); reset.setLatestAiPrompt(''); reset.setLatestAiRawText(''); reset.setActionFilter('all'); reset.setActionOverrides(new Map()); reset.setSubDirAnalysisPaths([]); reset.setSubDirScanLoading(false); reset.setSubDirAiLoading(false); reset.setSubDirAnalysisResult(null); reset.setSubDirAnalysisResults([])
        try {
            const appSettings = await loadAppSettings()
            const useMft = appSettings.useMftScan !== false
            const res = await invoke<ScanResult>('scan_path_command', { path: pathToScan, shallowDirs, useMft })
            setResult(res)
            setStatus('done')
            if (res.interrupted) {
                await showNotification(
                    t('expertMode.scanInterrupted'),
                    t('expertMode.scanInterruptedHint', { count: res.file_count })
                )
            }
        } catch (e) {
            setStatus('error'); setErrorMsg(String(e));
        } finally {
            setScanCanceling(false)
        }
    }, [shallowDirs, t, reset])

    const cancelScan = useCallback(async () => {
        if (status !== 'scanning') return
        setScanCanceling(true)
        try {
            const accepted = await invoke<boolean>('cancel_scan_command')
            if (!accepted) {
                setScanCanceling(false)
            }
        } catch (e) {
            setScanCanceling(false)
            await showNotification(t('expertMode.stopScanFailed'), String(e))
        }
    }, [status, t])

    const handleBrowseFolder = useCallback(async () => {
        const selected = await open({ directory: true, multiple: false });
        if (selected) {
            const pathStr = typeof selected === 'string' ? selected : selected[0];
            setPath(pathStr);
        }
    }, [])

    return {
        path, setPath, status, scanCanceling, errorMsg, result, progressFiles,
        shallowDirs, setShallowDirs, runScan, cancelScan, handleBrowseFolder,
        setResult, setStatus,
    }
}
