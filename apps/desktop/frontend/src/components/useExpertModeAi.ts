import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { showNotification } from '../services/notification'
import { loadSettings, resolveEffectiveApiKey } from '../services/ai'
import { analyzeWithAI, type AnalysisResult } from '../services/ai-analysis'
import { loadAppSettings } from '../services/settings'
import { saveSnapshot } from '../services/snapshot'
import { buildFileListSummary, isAbortError, buildDefaultSnapshotName } from './ExpertMode.utils'
import type { ScanResult, SnapshotDecisionAction, PendingAiSnapshotDecision } from './ExpertMode.types'

export interface AiState {
    aiAnalyzing: boolean
    aiProgress: string
    analysisResult: AnalysisResult | null
    setAnalysisResult: React.Dispatch<React.SetStateAction<AnalysisResult | null>>
    hasAnalyzedOnce: boolean
    latestSummary: string
    latestAiPrompt: string
    latestAiRawText: string
    runAiAnalysis: (scanResult: ScanResult, path: string) => Promise<void>
    cancelAiAnalysis: () => void
    showAiSnapshotDecisionDialog: boolean
    aiSnapshotDecisionRememberForSession: boolean
    setAiSnapshotDecisionRememberForSession: (v: boolean) => void
    aiSnapshotDecisionSaving: boolean
    pendingAiSnapshotDecision: PendingAiSnapshotDecision | null
    handleAiSnapshotDecisionAction: (action: SnapshotDecisionAction) => Promise<void>
    handleAiSnapshotDecisionClose: () => void
    setLatestSummary: (v: string) => void
    setLatestAiPrompt: (v: string) => void
    setLatestAiRawText: (v: string) => void
    setHasAnalyzedOnce: (v: boolean) => void
    setAiProgress: (v: string) => void
}

interface AiDeps {
    setActionFilter: (v: 'all' | 'delete' | 'move') => void
    setActionOverrides: (v: Map<string, 'delete' | 'move'>) => void
    setSelectedItems: (v: Set<string>) => void
}

export function useExpertModeAi(deps: AiDeps): AiState {
    const { t } = useTranslation()
    const [aiAnalyzing, setAiAnalyzing] = useState(false)
    const [aiProgress, setAiProgress] = useState('')
    const aiAbortControllerRef = useRef<AbortController | null>(null)
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
    const [hasAnalyzedOnce, setHasAnalyzedOnce] = useState(false)
    const [latestSummary, setLatestSummary] = useState('')
    const [latestAiPrompt, setLatestAiPrompt] = useState('')
    const [latestAiRawText, setLatestAiRawText] = useState('')

    const [showAiSnapshotDecisionDialog, setShowAiSnapshotDecisionDialog] = useState(false)
    const [aiSnapshotDontShowForSession, setAiSnapshotDontShowForSession] = useState(false)
    const [aiSnapshotDecisionDefaultAction, setAiSnapshotDecisionDefaultAction] = useState<SnapshotDecisionAction>('skip')
    const [aiSnapshotDecisionRememberForSession, setAiSnapshotDecisionRememberForSession] = useState(false)
    const [aiSnapshotDecisionSaving, setAiSnapshotDecisionSaving] = useState(false)
    const [pendingAiSnapshotDecision, setPendingAiSnapshotDecision] = useState<PendingAiSnapshotDecision | null>(null)

    const saveAiDecisionSnapshot = useCallback(async (decision: PendingAiSnapshotDecision) => {
        const normalizedPath = decision.path.trim()
        if (!normalizedPath) {
            throw new Error(t('snapshot.pathRequiredForSave'))
        }
        const autoSnapshotName = buildDefaultSnapshotName(normalizedPath)
        await saveSnapshot({
            name: autoSnapshotName,
            path: normalizedPath,
            scanResult: decision.scanResult,
            summary: decision.summary,
            ai_prompt: decision.aiPrompt,
            ai_raw_text: decision.aiRawText,
            ai_structured_result: decision.aiStructuredResult,
        })
        await showNotification(t('snapshot.saveSuccess'), t('snapshot.savedSnapshot', { name: autoSnapshotName }))
    }, [t])

    const triggerAiSnapshotDecision = useCallback(async (
        decision: Omit<PendingAiSnapshotDecision, 'defaultAction'>,
        defaultAction: SnapshotDecisionAction,
    ) => {
        if (aiSnapshotDontShowForSession) {
            if (aiSnapshotDecisionDefaultAction === 'save') {
                try {
                    await saveAiDecisionSnapshot({ ...decision, defaultAction: aiSnapshotDecisionDefaultAction })
                } catch (error) {
                    await showNotification(t('snapshot.saveFailed'), String(error))
                }
            }
            return
        }

        setPendingAiSnapshotDecision({ ...decision, defaultAction })
        setAiSnapshotDecisionRememberForSession(false)
        setShowAiSnapshotDecisionDialog(true)
    }, [aiSnapshotDecisionDefaultAction, aiSnapshotDontShowForSession, saveAiDecisionSnapshot, t])

    const runAiAnalysis = useCallback(async (scanResult: ScanResult, scanPath: string) => {
        if (aiAnalyzing) return

        const abortController = new AbortController()
        aiAbortControllerRef.current = abortController
        setAiAnalyzing(true)
        setAiProgress(t('aiAnalysis.preparing'))
        setAnalysisResult(null)
        deps.setSelectedItems(new Set())
        deps.setActionFilter('all')
        deps.setActionOverrides(new Map())
        setLatestAiPrompt('')
        setLatestAiRawText('')
        try {
            const appSettings = await loadAppSettings()
            const aiSettings = await loadSettings()
            if (!(await resolveEffectiveApiKey(aiSettings))?.trim()) {
                throw new Error('Please configure API key in settings first.')
            }
            const summary = await buildFileListSummary(scanResult, appSettings.promptFileCount)
            if (abortController.signal.aborted) return
            setLatestSummary(summary)
            const aiResult = await analyzeWithAI(summary, (msg) => setAiProgress(msg), abortController.signal)
            if (abortController.signal.aborted) return
            setAnalysisResult(aiResult)
            setHasAnalyzedOnce(true)
            setLatestAiPrompt(aiResult.promptText ?? '')
            setLatestAiRawText(aiResult.rawText ?? '')

            if (aiResult.interrupted) {
                await showNotification(t('aiAnalysis.canceled'), aiResult.summary || t('aiAnalysis.canceled'))
                return
            }

            const suggestionCount = aiResult.suggestions.length
            const notificationBody = suggestionCount > 0
                ? t('aiAnalysis.foundSuggestions', { count: suggestionCount })
                : aiResult.summary || t('aiAnalysis.noSuggestions')
            await showNotification(t('aiAnalysis.complete'), notificationBody)

            const defaultAction: SnapshotDecisionAction = appSettings.autoSaveAfterAi === true ? 'save' : 'skip'
            await triggerAiSnapshotDecision({
                path: scanPath.trim(),
                scanResult,
                summary,
                aiPrompt: aiResult.promptText ?? '',
                aiRawText: aiResult.rawText ?? '',
                aiStructuredResult: aiResult,
            }, defaultAction)
        } catch (aiError) {
            if (isAbortError(aiError)) {
                console.info('[AI] Analysis canceled by user action.')
                return
            }
            await showNotification(t('aiAnalysis.failed'), String(aiError))
        } finally {
            if (aiAbortControllerRef.current === abortController) {
                aiAbortControllerRef.current = null
            }
            setAiAnalyzing(false)
            setAiProgress('')
        }
    }, [aiAnalyzing, t, triggerAiSnapshotDecision, deps])

    const cancelAiAnalysis = useCallback(() => {
        const controller = aiAbortControllerRef.current
        if (!controller) return
        controller.abort()
        aiAbortControllerRef.current = null
        console.info('[AI] Analysis canceled by user.')
    }, [])

    useEffect(() => {
        return () => {
            if (aiAbortControllerRef.current) {
                aiAbortControllerRef.current.abort()
                aiAbortControllerRef.current = null
            }
        }
    }, [])

    const handleAiSnapshotDecisionAction = useCallback(async (action: SnapshotDecisionAction) => {
        const decision = pendingAiSnapshotDecision
        if (!decision || aiSnapshotDecisionSaving) return

        setAiSnapshotDecisionSaving(true)
        try {
            if (action === 'save') {
                await saveAiDecisionSnapshot(decision)
            }

            if (aiSnapshotDecisionRememberForSession) {
                setAiSnapshotDontShowForSession(true)
                setAiSnapshotDecisionDefaultAction(action)
            }

            setShowAiSnapshotDecisionDialog(false)
            setPendingAiSnapshotDecision(null)
            setAiSnapshotDecisionRememberForSession(false)
        } catch (error) {
            await showNotification(t('snapshot.saveFailed'), String(error))
        } finally {
            setAiSnapshotDecisionSaving(false)
        }
    }, [
        aiSnapshotDecisionRememberForSession,
        aiSnapshotDecisionSaving,
        pendingAiSnapshotDecision,
        saveAiDecisionSnapshot,
        t,
    ])

    const handleAiSnapshotDecisionClose = useCallback(() => {
        if (aiSnapshotDecisionSaving) return
        const defaultAction = pendingAiSnapshotDecision?.defaultAction ?? 'skip'
        const canSave = Boolean(pendingAiSnapshotDecision?.path.trim())
        const effectiveAction = defaultAction === 'save' && !canSave ? 'skip' : defaultAction
        void handleAiSnapshotDecisionAction(effectiveAction)
    }, [aiSnapshotDecisionSaving, handleAiSnapshotDecisionAction, pendingAiSnapshotDecision])

    return {
        aiAnalyzing, aiProgress, analysisResult, setAnalysisResult,
        hasAnalyzedOnce, latestSummary, latestAiPrompt, latestAiRawText,
        runAiAnalysis, cancelAiAnalysis,
        showAiSnapshotDecisionDialog, aiSnapshotDecisionRememberForSession,
        setAiSnapshotDecisionRememberForSession,
        aiSnapshotDecisionSaving, pendingAiSnapshotDecision,
        handleAiSnapshotDecisionAction, handleAiSnapshotDecisionClose,
        setLatestSummary, setLatestAiPrompt, setLatestAiRawText,
        setHasAnalyzedOnce, setAiProgress,
    }
}
