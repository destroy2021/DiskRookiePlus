import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { showNotification } from '../services/notification'
import { loadSettings, resolveEffectiveApiKey } from '../services/ai'
import { analyzeWithAI, scanDirectoryTopN, type DirectoryTopNResult, type CleanupSuggestion } from '../services/ai-analysis'
import { extractSubDirFromCache, buildSubDirSummary } from './ExpertMode.utils'
import type { ScanResult } from './ExpertMode.types'

export interface SubDirState {
    subDirAnalysisPaths: string[]
    subDirScanLoading: boolean
    subDirAiLoading: boolean
    subDirAnalysisResult: DirectoryTopNResult | null
    subDirAnalysisResults: DirectoryTopNResult[]
    handleSubDirScan: (targetPath: string) => Promise<void>
    handleSubDirAiAnalyze: (selectedPaths: string[], scanResult: DirectoryTopNResult) => Promise<void>
    handleBatchSubDirAiAnalyze: (paths: string[]) => Promise<void>
    handleSubDirScanCancel: () => void
    handleSubDirAiCancel: () => void
    handleSubDirAnalysisBack: () => void
    handleSubDirAnalysisClear: () => void
    setSubDirAnalysisPaths: React.Dispatch<React.SetStateAction<string[]>>
    setSubDirScanLoading: (v: boolean) => void
    setSubDirAiLoading: (v: boolean) => void
    setSubDirAnalysisResult: React.Dispatch<React.SetStateAction<DirectoryTopNResult | null>>
    setSubDirAnalysisResults: React.Dispatch<React.SetStateAction<DirectoryTopNResult[]>>
}

interface SubDirDeps {
    result: ScanResult | null
    setAiProgress: (v: string) => void
    appendSuggestions: (newSuggestions: CleanupSuggestion[], additionalSummary: string) => void
}

export function useExpertModeSubDir(deps: SubDirDeps): SubDirState {
    const { t } = useTranslation()
    const [subDirAnalysisPaths, setSubDirAnalysisPaths] = useState<string[]>([])
    const [subDirScanLoading, setSubDirScanLoading] = useState(false)
    const [subDirAiLoading, setSubDirAiLoading] = useState(false)
    const [subDirAnalysisResult, setSubDirAnalysisResult] = useState<DirectoryTopNResult | null>(null)
    const [subDirAnalysisResults, setSubDirAnalysisResults] = useState<DirectoryTopNResult[]>([])
    const subDirScanAbortRef = useRef<AbortController | null>(null)
    const subDirAiAbortRef = useRef<AbortController | null>(null)

    const handleSubDirScan = useCallback(async (targetPath: string) => {
        if (subDirScanAbortRef.current) subDirScanAbortRef.current.abort()
        const abortController = new AbortController()
        subDirScanAbortRef.current = abortController
        setSubDirScanLoading(true)
        setSubDirAnalysisResult(null)
        try {
            let res: DirectoryTopNResult | null = null
            if (deps.result?.root) {
                res = extractSubDirFromCache(deps.result.root, targetPath)
            }
            if (!res) {
                res = await scanDirectoryTopN(targetPath)
            }
            if (abortController.signal.aborted) return
            setSubDirAnalysisPaths(prev => [...prev, targetPath])
            setSubDirAnalysisResult(res)
            setSubDirAnalysisResults(prev => [...prev, res])
        } catch (err: unknown) {
            if ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted) return
            await showNotification(t('aiAnalysis.subDirAnalysisFailed'), String(err))
        } finally {
            if (subDirScanAbortRef.current === abortController) {
                subDirScanAbortRef.current = null
            }
            setSubDirScanLoading(false)
        }
    }, [deps.result, t])

    const handleSubDirAiAnalyze = useCallback(async (selectedPaths: string[], scanResult: DirectoryTopNResult) => {
        if (subDirAiAbortRef.current) subDirAiAbortRef.current.abort()
        const abortController = new AbortController()
        subDirAiAbortRef.current = abortController
        setSubDirAiLoading(true)
        try {
            const aiSettings = await loadSettings()
            if (abortController.signal.aborted) return
            if (!(await resolveEffectiveApiKey(aiSettings))?.trim()) {
                await showNotification(t('aiAnalysis.subDirAnalysisFailed'), 'Please configure API key in settings first.')
                return
            }
            if (abortController.signal.aborted) return
            const targetPath = scanResult.path
            const filteredResult: DirectoryTopNResult = {
                ...scanResult,
                top_directories: scanResult.top_directories.filter(d => selectedPaths.includes(d.path)),
                top_files: scanResult.top_files.filter(f => selectedPaths.includes(f.path)),
            }
            const subSummary = buildSubDirSummary(targetPath, filteredResult)
            const aiResult = await analyzeWithAI(subSummary, (msg) => deps.setAiProgress(msg), abortController.signal)
            if (abortController.signal.aborted) return
            if (aiResult.suggestions.length > 0) {
                deps.appendSuggestions(
                    aiResult.suggestions.map(s => ({ ...s, _parentPath: targetPath })),
                    aiResult.summary,
                )
            }
        } catch (err: unknown) {
            if ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted) return
            await showNotification(t('aiAnalysis.subDirAnalysisFailed'), String(err))
        } finally {
            if (subDirAiAbortRef.current === abortController) {
                subDirAiAbortRef.current = null
            }
            setSubDirAiLoading(false)
        }
    }, [t, deps])

    const handleBatchSubDirAiAnalyze = useCallback(async (paths: string[]) => {
        if (subDirAiAbortRef.current) subDirAiAbortRef.current.abort()
        const abortController = new AbortController()
        subDirAiAbortRef.current = abortController
        setSubDirAiLoading(true)
        try {
            const aiSettings = await loadSettings()
            if (abortController.signal.aborted) return
            if (!(await resolveEffectiveApiKey(aiSettings))?.trim()) {
                await showNotification(t('aiAnalysis.subDirAnalysisFailed'), 'Please configure API key in settings first.')
                return
            }
            if (abortController.signal.aborted) return

            const scanResults: { path: string; result: DirectoryTopNResult }[] = []
            for (let i = 0; i < paths.length; i++) {
                if (abortController.signal.aborted) return
                const targetPath = paths[i]
                deps.setAiProgress(t('aiAnalysis.subDirAnalysisScanning') + ` ${i + 1}/${paths.length}: ${targetPath.split(/[/\\]/).pop() || targetPath}`)
                let scanRes: DirectoryTopNResult | null = null
                if (deps.result?.root) {
                    scanRes = extractSubDirFromCache(deps.result.root, targetPath)
                }
                if (!scanRes) {
                    scanRes = await scanDirectoryTopN(targetPath)
                }
                if (abortController.signal.aborted) return
                scanResults.push({ path: targetPath, result: scanRes })
            }

            const combinedSummary = scanResults.map(({ path: p, result: r }) => buildSubDirSummary(p, r)).join('\n\n---\n\n')
            deps.setAiProgress(t('aiAnalysis.subDirAnalysisAnalyzing'))
            const aiResult = await analyzeWithAI(combinedSummary, (msg) => deps.setAiProgress(msg), abortController.signal)
            if (abortController.signal.aborted) return
            if (aiResult.suggestions.length > 0) {
                deps.appendSuggestions(
                    aiResult.suggestions.map(s => ({
                        ...s,
                        _parentPath: paths.find(p => s.path.startsWith(p)) || paths[0],
                    })),
                    aiResult.summary,
                )
            }
        } catch (err: unknown) {
            if ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted) return
            await showNotification(t('aiAnalysis.subDirAnalysisFailed'), String(err))
        } finally {
            if (subDirAiAbortRef.current === abortController) {
                subDirAiAbortRef.current = null
            }
            setSubDirAiLoading(false)
        }
    }, [deps.result, t, deps])

    const handleSubDirScanCancel = useCallback(() => {
        subDirScanAbortRef.current?.abort()
        subDirScanAbortRef.current = null
        setSubDirScanLoading(false)
    }, [])

    const handleSubDirAiCancel = useCallback(() => {
        subDirAiAbortRef.current?.abort()
        subDirAiAbortRef.current = null
        setSubDirAiLoading(false)
        deps.setAiProgress('')
    }, [deps])

    const handleSubDirAnalysisBack = useCallback(() => {
        setSubDirAnalysisPaths(prev => prev.slice(0, -1))
        setSubDirAnalysisResults(prev => {
            const next = prev.slice(0, -1)
            setSubDirAnalysisResult(next.length > 0 ? next[next.length - 1] : null)
            return next
        })
    }, [])

    const handleSubDirAnalysisClear = useCallback(() => {
        subDirScanAbortRef.current?.abort()
        subDirScanAbortRef.current = null
        subDirAiAbortRef.current?.abort()
        subDirAiAbortRef.current = null
        setSubDirScanLoading(false)
        setSubDirAiLoading(false)
        setSubDirAnalysisPaths([])
        setSubDirAnalysisResult(null)
        setSubDirAnalysisResults([])
        deps.setAiProgress('')
    }, [deps])

    return {
        subDirAnalysisPaths, subDirScanLoading, subDirAiLoading,
        subDirAnalysisResult, subDirAnalysisResults,
        handleSubDirScan, handleSubDirAiAnalyze, handleBatchSubDirAiAnalyze,
        handleSubDirScanCancel, handleSubDirAiCancel,
        handleSubDirAnalysisBack, handleSubDirAnalysisClear,
        setSubDirAnalysisPaths, setSubDirScanLoading, setSubDirAiLoading,
        setSubDirAnalysisResult, setSubDirAnalysisResults,
    }
}
