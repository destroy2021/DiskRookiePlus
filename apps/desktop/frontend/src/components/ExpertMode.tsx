import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { Button, Typography } from '@mui/material'
import { CloudStorageSelector } from './CloudStorageSelector'
import { loadSettings, resolveEffectiveApiKey, sendChatRequest } from '../services/ai'
import type { ExpertModeProps, ActiveTab, AnalysisSession } from './ExpertMode.types'
import type { AnalysisResult, CleanupSuggestion, DirEntry } from '../services/ai-analysis'
import type { Task } from '../services/taskQueue'
import { useExpertModeScan } from './useExpertModeScan'
import { useExpertModeAi } from './useExpertModeAi'
import { useExpertModeSubDir } from './useExpertModeSubDir'
import { useExpertModeActions } from './useExpertModeActions'
import { useAnalysisSessions } from './useAnalysisSessions'
import { ExpertModeToolbar } from './ExpertModeToolbar'
import { ExpertModeDialogs } from './ExpertModeDialogs'
import { AnalysisReportContent } from './AnalysisReportContent'
import { DeveloperModeContent } from './DeveloperModeContent'
import { FileExplorer } from './FileExplorer'
import { ScanProgressIndicator } from './ScanProgressIndicator'
import { AiAnalyzingIndicator } from './AiAnalyzingIndicator'
import { SessionListPanel } from './SessionListPanel'
import { AskAiResultDialog, type AskAiResultItem } from './AskAiResultDialog'
import { analyzeWithAgent } from '../services/ai-agent'
import type { AgentRunProgress } from './ExpertMode.types'

export type { ExpertModeProps } from './ExpertMode.types'

function formatEntryDate(timestamp: number | null | undefined): string {
    if (!timestamp) return '-'
    const d = new Date(timestamp * 1000)
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString().slice(0, 5)}`
}

function formatEntrySize(entry: DirEntry): string {
    if (entry.is_dir) return 'Directory'
    if (entry.size < 1024) return `${entry.size} B`
    if (entry.size < 1024 * 1024) return `${(entry.size / 1024).toFixed(1)} KB`
    if (entry.size < 1024 * 1024 * 1024) return `${(entry.size / 1024 / 1024).toFixed(1)} MB`
    return `${(entry.size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function buildAskAiPrompt(entry: DirEntry, language: string): string {
    return `Please analyze this ${entry.is_dir ? 'directory' : 'file'} for a disk cleanup user. Reply in ${language}.\n\nFocus on:\n1. Likely purpose.\n2. Whether it is safer to keep, delete, or migrate.\n3. Risk notes for non-technical users.\n\nPath: ${entry.path}\nName: ${entry.name}\nType: ${entry.is_dir ? 'Directory' : 'File'}\nSize: ${formatEntrySize(entry)}\nModified: ${formatEntryDate(entry.modified)}${entry.child_count != null ? `\nChild items: ${entry.child_count}` : ''}`
}

function buildSuggestionFromAskResult(item: AskAiResultItem): CleanupSuggestion {
    return {
        action: 'move',
        type: item.entry.is_dir ? 'directory' : 'file',
        path: item.entry.path,
        size: formatEntrySize(item.entry),
        updateTime: formatEntryDate(item.entry.modified),
        message: item.answer,
    }
}

export function ExpertMode({ onOpenSettings, loadedSnapshot, onSnapshotLoaded, settingsSavedTrigger, onAddMigrateTask, onFileDeleted, tasks = [] }: ExpertModeProps) {
    const { t } = useTranslation()
    const [activeTab, setActiveTab] = useState<ActiveTab>('file-browser')
    const [sessionPanelCollapsed, setSessionPanelCollapsed] = useState(false)
    const [askAiDialogOpen, setAskAiDialogOpen] = useState(false)
    const [askAiLoading, setAskAiLoading] = useState(false)
    const [askAiError, setAskAiError] = useState<string | null>(null)
    const [askAiResults, setAskAiResults] = useState<AskAiResultItem[]>([])
    const [askAiSelectedIndex, setAskAiSelectedIndex] = useState(0)
    const [agentRunning, setAgentRunning] = useState(false)
    const [agentProgress, setAgentProgress] = useState<AgentRunProgress | null>(null)
    const agentAbortRef = useRef<AbortController | null>(null)
    const openedSettingsForStandardRef = useRef(false)

    const aiSettersRef = useRef<{
        setAnalysisResult: React.Dispatch<React.SetStateAction<AnalysisResult | null>> | null
        setHasAnalyzedOnce: ((v: boolean) => void) | null
        setLatestSummary: ((v: string) => void) | null
        setLatestAiPrompt: ((v: string) => void) | null
        setLatestAiRawText: ((v: string) => void) | null
        setAiProgress: ((v: string) => void) | null
    }>({ setAnalysisResult: null, setHasAnalyzedOnce: null, setLatestSummary: null, setLatestAiPrompt: null, setLatestAiRawText: null, setAiProgress: null })

    const actionsSettersRef = useRef<{
        setActionFilter: ((v: 'all' | 'delete' | 'move') => void) | null
        setActionOverrides: ((v: Map<string, 'delete' | 'move'>) => void) | null
        setSelectedItems: React.Dispatch<React.SetStateAction<Set<string>>> | null
    }>({ setActionFilter: null, setActionOverrides: null, setSelectedItems: null })

    const subDirSettersRef = useRef<{
        setSubDirAnalysisPaths: React.Dispatch<React.SetStateAction<string[]>> | null
        setSubDirScanLoading: ((v: boolean) => void) | null
        setSubDirAiLoading: ((v: boolean) => void) | null
        setSubDirAnalysisResult: React.Dispatch<React.SetStateAction<import('../services/ai-analysis').DirectoryTopNResult | null>> | null
        setSubDirAnalysisResults: React.Dispatch<React.SetStateAction<import('../services/ai-analysis').DirectoryTopNResult[]>> | null
    }>({ setSubDirAnalysisPaths: null, setSubDirScanLoading: null, setSubDirAiLoading: null, setSubDirAnalysisResult: null, setSubDirAnalysisResults: null })

    const scan = useExpertModeScan({
        setAnalysisResult: (v) => aiSettersRef.current.setAnalysisResult?.(v),
        setHasAnalyzedOnce: (v) => aiSettersRef.current.setHasAnalyzedOnce?.(v),
        setLatestSummary: (v) => aiSettersRef.current.setLatestSummary?.(v),
        setLatestAiPrompt: (v) => aiSettersRef.current.setLatestAiPrompt?.(v),
        setLatestAiRawText: (v) => aiSettersRef.current.setLatestAiRawText?.(v),
        setActionFilter: (v) => actionsSettersRef.current.setActionFilter?.(v),
        setActionOverrides: (v) => actionsSettersRef.current.setActionOverrides?.(v),
        setSubDirAnalysisPaths: (v) => subDirSettersRef.current.setSubDirAnalysisPaths?.(v),
        setSubDirScanLoading: (v) => subDirSettersRef.current.setSubDirScanLoading?.(v),
        setSubDirAiLoading: (v) => subDirSettersRef.current.setSubDirAiLoading?.(v),
        setSubDirAnalysisResult: (v) => subDirSettersRef.current.setSubDirAnalysisResult?.(v),
        setSubDirAnalysisResults: (v) => subDirSettersRef.current.setSubDirAnalysisResults?.(v),
    })

    const ai = useExpertModeAi({
        setActionFilter: (v) => actionsSettersRef.current.setActionFilter?.(v),
        setActionOverrides: (v) => actionsSettersRef.current.setActionOverrides?.(v),
        setSelectedItems: (v) => actionsSettersRef.current.setSelectedItems?.(v),
    })

    const sessions = useAnalysisSessions()

    const analysisResultRef = useRef<AnalysisResult | null>(null)
    useEffect(() => {
        analysisResultRef.current = sessions.activeSession?.analysisResult ?? ai.analysisResult
    })

    const subDir = useExpertModeSubDir({
        result: scan.result,
        setAiProgress: ai.setAiProgress,
        appendSuggestions: useCallback((newSuggestions: CleanupSuggestion[], additionalSummary: string) => {
            const currentResult = analysisResultRef.current
            if (!currentResult) return
            const updatedResult = {
                ...currentResult,
                suggestions: [...currentResult.suggestions, ...newSuggestions],
                summary: currentResult.summary + '\n\n' + additionalSummary,
            }
            if (sessions.activeSessionId) {
                sessions.setSessionAnalysisResult(sessions.activeSessionId, updatedResult)
            }
            ai.setAnalysisResult(updatedResult)
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [sessions.activeSessionId, sessions.setSessionAnalysisResult, ai.setAnalysisResult]),
    })

    const actions = useExpertModeActions({
        result: scan.result,
        path: scan.path,
        analysisResult: ai.analysisResult,
        onAddMigrateTask,
        onFileDeleted,
        getSessionsForSnapshot: sessions.getSessionsForSnapshot,
    })

    useEffect(() => {
        aiSettersRef.current = {
            setAnalysisResult: ai.setAnalysisResult,
            setHasAnalyzedOnce: ai.setHasAnalyzedOnce,
            setLatestSummary: ai.setLatestSummary,
            setLatestAiPrompt: ai.setLatestAiPrompt,
            setLatestAiRawText: ai.setLatestAiRawText,
            setAiProgress: ai.setAiProgress,
        }
        actionsSettersRef.current = {
            setActionFilter: actions.setActionFilter,
            setActionOverrides: actions.setActionOverrides,
            setSelectedItems: actions.setSelectedItems,
        }
        subDirSettersRef.current = {
            setSubDirAnalysisPaths: subDir.setSubDirAnalysisPaths,
            setSubDirScanLoading: subDir.setSubDirScanLoading,
            setSubDirAiLoading: subDir.setSubDirAiLoading,
            setSubDirAnalysisResult: subDir.setSubDirAnalysisResult,
            setSubDirAnalysisResults: subDir.setSubDirAnalysisResults,
        }
    })

    const [standardModeNoApi, setStandardModeNoApi] = useState(false)
    const aiAnalyzeActionLabel = ai.hasAnalyzedOnce ? t('aiAnalysis.reanalyze') : t('aiAnalysis.start')
    const prevAnalysisResultRef = useRef<AnalysisResult | null>(null)

    const getTaskForPath = useCallback((filePath: string): Task | undefined => {
        return tasks.find(task => task.sourcePath === filePath && (task.status === 'pending' || task.status === 'uploading'))
    }, [tasks])

    useEffect(() => {
        if (ai.analysisResult && !prevAnalysisResultRef.current) {
            if (sessions.activeSessionId) {
                sessions.setSessionAnalysisResult(sessions.activeSessionId, ai.analysisResult)
            } else {
                const newSession = sessions.createSession(scan.path)
                sessions.updateSession(newSession.id, {
                    latestAiRawText: ai.latestAiRawText,
                    latestAiPrompt: ai.latestAiPrompt,
                    status: 'done',
                })
                sessions.setSessionAnalysisResult(newSession.id, ai.analysisResult)
            }
            setActiveTab('analysis-report')
        }
        prevAnalysisResultRef.current = ai.analysisResult
    }, [ai.analysisResult])

    useEffect(() => {
        if (scan.status === 'done' && scan.result && !ai.analysisResult) {
            setActiveTab('file-browser')
        }
    }, [scan.status, scan.result, ai.analysisResult])

    useEffect(() => {
        if (!loadedSnapshot) return

        scan.setPath(loadedSnapshot.path)
        scan.setResult(loadedSnapshot.scanResult)
        scan.setStatus('done')

        const legacySessions = (loadedSnapshot as unknown as Record<string, unknown>).sessions as AnalysisSession[] | undefined
        if (legacySessions && legacySessions.length > 0) {
            sessions.loadSessionsFromSnapshot(legacySessions)
        } else {
            sessions.loadSessionsFromSnapshot(
                [],
                loadedSnapshot.ai_structured_result ?? null,
                loadedSnapshot.ai_raw_text ?? '',
                loadedSnapshot.ai_prompt ?? '',
                loadedSnapshot.path,
            )
        }

        ai.setAnalysisResult(sessions.activeSession?.analysisResult ?? loadedSnapshot.ai_structured_result ?? null)
        ai.setHasAnalyzedOnce(Boolean(
            sessions.activeSession?.analysisResult
            ?? loadedSnapshot.ai_structured_result
            ?? (loadedSnapshot.ai_raw_text?.trim())
            ?? (loadedSnapshot.ai_prompt?.trim())
        ))
        ai.setLatestSummary(sessions.activeSession?.latestAiRawText ?? loadedSnapshot.summary ?? '')
        ai.setLatestAiPrompt(sessions.activeSession?.latestAiPrompt ?? loadedSnapshot.ai_prompt ?? '')
        ai.setLatestAiRawText(sessions.activeSession?.latestAiRawText ?? loadedSnapshot.ai_raw_text ?? '')

        if (sessions.activeSession) {
            actions.setDeletedPaths(new Set(sessions.activeSession.deletedPaths))
            actions.setAddedToSafeListPaths(new Set(sessions.activeSession.addedToSafeListPaths))
            actions.setActionFilter('all')
            actions.setActionOverrides(new Map(sessions.activeSession.actionOverrides))
        } else {
            actions.setDeletedPaths(new Set())
            actions.setActionFilter('all')
            actions.setActionOverrides(new Map())
        }

        onSnapshotLoaded?.()
    }, [loadedSnapshot, onSnapshotLoaded])

    useEffect(() => {
        if (activeTab === 'file-browser' || activeTab === 'analysis-report') {
            loadSettings().then(async settings => {
                const key = await resolveEffectiveApiKey(settings)
                setStandardModeNoApi(!key?.trim())
            })
        }
    }, [activeTab, settingsSavedTrigger])

    useEffect(() => {
        if ((activeTab === 'file-browser' || activeTab === 'analysis-report') && onOpenSettings && !openedSettingsForStandardRef.current && standardModeNoApi) {
            openedSettingsForStandardRef.current = true
            onOpenSettings()
        }
    }, [activeTab, onOpenSettings, standardModeNoApi])

    const handleSwitchTab = useCallback((tab: ActiveTab) => setActiveTab(tab), [])

    const handleRunAiAnalysis = useCallback(() => {
        if (!scan.result) return
        if (!sessions.activeSessionId) {
            sessions.createSession(scan.path)
        }
        void ai.runAiAnalysis(scan.result!, scan.path)
    }, [scan.result, scan.path, sessions.activeSessionId])

    const handleCreateNewSession = useCallback(() => {
        if (!scan.result) return
        sessions.createSession(scan.path)
        setActiveTab('analysis-report')
        void ai.runAiAnalysis(scan.result!, scan.path)
    }, [scan.result, scan.path])

    const runMcpInspectionForSession = useCallback(async (sessionId: string, path: string) => {
        agentAbortRef.current?.abort()
        const controller = new AbortController()
        agentAbortRef.current = controller
        setAgentRunning(true)
        setAgentProgress({ turn: 0, maxTurns: 6, currentTool: null, latestSummary: null, suggestionCount: 0 })
        sessions.updateSession(sessionId, { source: 'agent', status: 'analyzing', latestAiRawText: '', latestAiPrompt: '', agentLogs: [] })
        try {
            const result = await analyzeWithAgent({
                path,
                signal: controller.signal,
                onLog: (execution) => {
                    sessions.appendAgentLog(sessionId, execution.log)
                },
                onProgress: (progress) => {
                    setAgentProgress(progress)
                },
            })
            sessions.setSessionAnalysisResult(sessionId, result)
            sessions.updateSession(sessionId, {
                source: 'agent',
                status: result.interrupted ? 'interrupted' : 'done',
                latestAiRawText: result.rawText ?? '',
                latestAiPrompt: result.promptText ?? '',
            })
            ai.setAnalysisResult(result)
            ai.setLatestAiRawText(result.rawText ?? '')
            ai.setLatestAiPrompt(result.promptText ?? '')
            ai.setLatestSummary(result.summary)
        } catch (err) {
            sessions.appendAgentLog(sessionId, {
                toolName: 'agent',
                args: { path },
                result: `Error: ${String(err)}`,
                timestamp: Date.now(),
                status: 'failure',
            })
            sessions.updateSession(sessionId, {
                status: 'failed',
                latestAiRawText: String(err),
            })
        } finally {
            setAgentRunning(false)
            setAgentProgress(null)
            if (agentAbortRef.current === controller) {
                agentAbortRef.current = null
            }
        }
    }, [sessions.updateSession, sessions.appendAgentLog, sessions.setSessionAnalysisResult, ai.setAnalysisResult, ai.setLatestAiRawText, ai.setLatestAiPrompt, ai.setLatestSummary])

    const handleStopAgent = useCallback(() => {
        agentAbortRef.current?.abort()
    }, [])

    const handleFileExplorerAiAutoAnalyze = useCallback((path: string) => {
        if (!scan.result) return
        const session = sessions.activeSessionId
            ? sessions.activeSession
            : sessions.createSession(scan.path, 'agent')
        if (session) {
            setActiveTab('analysis-report')
            void runMcpInspectionForSession(session.id, path)
        }
    }, [scan.result, scan.path, sessions.activeSessionId, sessions.activeSession, sessions.createSession, runMcpInspectionForSession])

    const handleRunDeepAiAnalysis = useCallback(() => {
        if (!scan.result) return
        const session = sessions.activeSessionId
            ? sessions.activeSession
            : sessions.createSession(scan.path, 'agent')
        if (session) {
            setActiveTab('analysis-report')
            void runMcpInspectionForSession(session.id, scan.path)
        }
    }, [scan.result, scan.path, sessions.activeSessionId, sessions.activeSession, sessions.createSession, runMcpInspectionForSession])

    const handleAskAiEntries = useCallback(async (entries: DirEntry[]) => {
        if (entries.length === 0) return
        setAskAiDialogOpen(true)
        setAskAiLoading(true)
        setAskAiError(null)
        setAskAiResults([])
        setAskAiSelectedIndex(0)
        try {
            const settings = await loadSettings()
            const language = t('askAi.languageName')
            const results: AskAiResultItem[] = []
            for (const entry of entries) {
                const answer = await sendChatRequest([
                    { role: 'system', content: t('askAi.systemPrompt') },
                    { role: 'user', content: buildAskAiPrompt(entry, language) },
                ], settings)
                results.push({ entry, answer: answer || t('askAi.emptyAnswer'), added: false })
                setAskAiResults([...results])
            }
        } catch (err) {
            setAskAiError(String(err))
        } finally {
            setAskAiLoading(false)
        }
    }, [t])

    const handleAddAskAiResultToSession = useCallback((index: number) => {
        const item = askAiResults[index]
        if (!item || item.added) return
        const session = sessions.activeSessionId
            ? sessions.activeSession
            : sessions.createSession(scan.path, 'manual')
        if (!session) return
        const suggestion = buildSuggestionFromAskResult(item)
        if (session.analysisResult) {
            sessions.addSuggestionToSession(session.id, suggestion)
        } else {
            sessions.setSessionAnalysisResult(session.id, {
                suggestions: [suggestion],
                summary: t('askAi.manualSessionSummary'),
                rawText: item.answer,
            })
            sessions.updateSession(session.id, { latestAiRawText: item.answer })
        }
        setAskAiResults(prev => prev.map((result, i) => i === index ? { ...result, added: true } : result))
        ai.setAnalysisResult({
            ...(session.analysisResult ?? { suggestions: [], summary: t('askAi.manualSessionSummary') }),
            suggestions: [...(session.analysisResult?.suggestions ?? []), suggestion],
        })
        setActiveTab('analysis-report')
    }, [askAiResults, sessions.activeSessionId, sessions.activeSession, sessions.createSession, sessions.addSuggestionToSession, sessions.setSessionAnalysisResult, scan.path, ai.setAnalysisResult, t])

    const handleFileExplorerDelete = useCallback((path: string) => {
        void actions.handleDelete(path, actions.deleteMode)
        if (sessions.activeSessionId) {
            sessions.markPathDeleted(sessions.activeSessionId, path)
        }
    }, [actions.handleDelete, actions.deleteMode, sessions.activeSessionId])

    const activeSessionAnalysisResult = sessions.activeSession?.analysisResult ?? ai.analysisResult

    return (
        <div className="flex-1 flex flex-col gap-6 p-2 min-h-0 text-slate-800 dark:text-gray-200 font-sans">
            <ExpertModeToolbar
                scanResult={scan.result}
                shallowDirs={scan.shallowDirs}
                onSetShallowDirs={scan.setShallowDirs}
                activeTab={activeTab}
                onSwitchTab={handleSwitchTab}
                aiAnalyzing={ai.aiAnalyzing}
                onCancelAiAnalysis={ai.cancelAiAnalysis}
                onRunAiAnalysis={handleRunAiAnalysis}
                onRunDeepAiAnalysis={handleRunDeepAiAnalysis}
                aiAnalyzeActionLabel={aiAnalyzeActionLabel}
                onSaveSnapshot={actions.handleSaveSnapshot}
                analysisResult={activeSessionAnalysisResult}
                deletedPaths={actions.deletedPaths}
                addedToSafeListPaths={actions.addedToSafeListPaths}
                actionFilter={actions.actionFilter}
                selectedItems={actions.selectedItems}
                deleteMode={actions.deleteMode}
                handleSelectAll={actions.handleSelectAll}
                setDeleteMode={actions.setDeleteMode}
                handleBatchExecute={actions.handleBatchExecute}
                onSubDirBatchAiAnalyze={subDir.handleBatchSubDirAiAnalyze}
                subDirAiLoading={subDir.subDirAiLoading}
                subDirScanLoading={subDir.subDirScanLoading}
                scanPath={scan.path}
                agentRunning={agentRunning}
                onStopAgent={handleStopAgent}
                selectedDirPaths={activeSessionAnalysisResult?.suggestions
                    .filter(s => s.type === 'directory' && actions.selectedItems.has(s.path) && !actions.deletedPaths.has(s.path) && !actions.addedToSafeListPaths.has(s.path))
                    .map(s => s.path) ?? []}
                onRunAiAnalysisSelected={(paths: string[]) => {
                    if (subDir.subDirAnalysisResult) {
                        void subDir.handleSubDirAiAnalyze(paths, subDir.subDirAnalysisResult)
                    } else if (scan.result) {
                        void ai.runAiAnalysis(scan.result, scan.path)
                    }
                }}
            />

            {scan.status === 'scanning' && (
                <ScanProgressIndicator
                    progressFiles={scan.progressFiles}
                    scanCanceling={scan.scanCanceling}
                />
            )}

            {ai.aiAnalyzing && (
                <AiAnalyzingIndicator aiProgress={ai.aiProgress} />
            )}

            {scan.result ? (
                <div className="flex-1 flex min-h-0 animate-in slide-in-from-bottom-8 duration-700">
                    {activeTab === 'analysis-report' ? (
                        <div className="flex w-full gap-0">
                            <SessionListPanel
                                sessions={sessions.sessions}
                                activeSessionId={sessions.activeSessionId}
                                onSwitchSession={(id) => { sessions.switchSession(id); handleSwitchTab('analysis-report') }}
                                onCreateSession={handleCreateNewSession}
                                onDeleteSession={(id) => { sessions.deleteSession(id) }}
                                collapsed={sessionPanelCollapsed}
                                onToggleCollapse={() => setSessionPanelCollapsed(v => !v)}
                            />
                            <div className="flex-1 overflow-y-auto pr-1">
                                {activeSessionAnalysisResult ? (
                                    <AnalysisReportContent
                                        scanPath={scan.path}
                                        scanResult={scan.result}
                                        analysisResult={activeSessionAnalysisResult}
                                        latestAiRawText={sessions.activeSession?.latestAiRawText ?? ai.latestAiRawText}
                                        getTaskForPath={getTaskForPath}
                                        deletedPaths={actions.deletedPaths}
                                        addedToSafeListPaths={actions.addedToSafeListPaths}
                                        actionFilter={actions.actionFilter}
                                        selectedItems={actions.selectedItems}
                                        deleteMode={actions.deleteMode}
                                        migrationTargetNames={actions.migrationTargetNames}
                                        getActualAction={actions.getActualAction}
                                        handleDelete={actions.handleDelete}
                                        handleMove={actions.handleMove}
                                        handleSelectChange={actions.handleSelectChange}
                                        handleToggleAction={actions.handleToggleAction}
                                        handleAddToSafeListClick={actions.handleAddToSafeListClick}
                                        handleSelectionDragStart={actions.handleSelectionDragStart}
                                        handleSelectionDragEnter={actions.handleSelectionDragEnter}
                                        handleSelectionDragEnd={actions.handleSelectionDragEnd}
                                        handleSetMigrationTarget={actions.handleSetMigrationTarget}
                                        onOpenCloudSettings={onOpenSettings}
                                        subDirAnalysisResult={subDir.subDirAnalysisResult}
                                        onSubDirScan={subDir.handleSubDirScan}
                                        onSubDirAiAnalyze={subDir.handleSubDirAiAnalyze}
                                        onSwitchTab={handleSwitchTab}
                                        agentLogs={sessions.activeSession?.agentLogs}
                                        agentRunning={agentRunning && sessions.activeSession?.status === 'analyzing'}
                                        agentProgress={agentRunning ? agentProgress : null}
                                        onStopAgent={handleStopAgent}
                                        onRemoveSuggestion={(path: string) => {
                                            const currentResult = activeSessionAnalysisResult
                                            if (!currentResult) return
                                            const updatedResult = {
                                                ...currentResult,
                                                suggestions: currentResult.suggestions.filter(s => s.path !== path),
                                            }
                                            if (sessions.activeSessionId) {
                                                sessions.setSessionAnalysisResult(sessions.activeSessionId, updatedResult)
                                            }
                                            ai.setAnalysisResult(updatedResult)
                                            actions.setSelectedItems(prev => {
                                                const next = new Set(prev)
                                                next.delete(path)
                                                return next
                                            })
                                        }}
                                    />
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500 dark:text-gray-400">
                                        <CheckCircle2 size={44} className="text-primary" />
                                        <Typography variant="body1" sx={{ fontWeight: 700 }}>
                                            {t('expertMode.scanComplete')}
                                        </Typography>
                                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                            {t('aiAnalysis.scanCompleteHint')}
                                        </Typography>
                                        <Button
                                            onClick={handleCreateNewSession}
                                            disabled={ai.aiAnalyzing || standardModeNoApi}
                                            variant="contained"
                                            size="small"
                                            startIcon={<Sparkles size={14} />}
                                            sx={{
                                                borderRadius: '10px', px: 3, py: 0.9,
                                                bgcolor: 'primary.main', color: '#1A1A1A',
                                                fontWeight: 700, fontSize: '12px', textTransform: 'none', boxShadow: 'none',
                                                '&:hover': { bgcolor: 'primary.dark', color: '#1A1A1A' }
                                            }}
                                        >
                                            {aiAnalyzeActionLabel}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col gap-4 min-h-0">
                            {activeTab === 'file-browser' && (
                                <FileExplorer
                                    initialPath={scan.path}
                                    onScanDirectory={subDir.handleSubDirScan}
                                    onAiAutoAnalyze={handleFileExplorerAiAutoAnalyze}
                                    onAskAi={(entry) => { void handleAskAiEntries([entry]) }}
                                    onAskAiMulti={(entries) => { void handleAskAiEntries(entries) }}
                                    onDeleteItem={handleFileExplorerDelete}
                                    activeSession={sessions.activeSession}
                                    deletedPathsFromSession={new Set(sessions.activeSession?.deletedPaths ?? [])}
                                    safeListPathsFromSession={new Set(sessions.activeSession?.addedToSafeListPaths ?? [])}
                                    scanStatus={scan.status}
                                    scanResult={scan.result}
                                    onRunScan={scan.runScan}
                                    onCancelScan={scan.cancelScan}
                                    scanCanceling={scan.scanCanceling}
                                    onBrowseFolder={scan.handleBrowseFolder}
                                />
                            )}
                            {activeTab === 'file-summary' && (
                                <DeveloperModeContent scanResult={scan.result} />
                            )}
                        </div>
                    )}
                </div>
            ) : scan.status === 'idle' ? (
                <div className="flex-1 flex flex-col min-h-0">
                    <FileExplorer
                        initialPath={scan.path}
                        onScanDirectory={subDir.handleSubDirScan}
                        onAiAutoAnalyze={handleFileExplorerAiAutoAnalyze}
                        onAskAi={(entry) => { void handleAskAiEntries([entry]) }}
                        onAskAiMulti={(entries) => { void handleAskAiEntries(entries) }}
                        onDeleteItem={handleFileExplorerDelete}
                        activeSession={sessions.activeSession}
                        deletedPathsFromSession={new Set(sessions.activeSession?.deletedPaths ?? [])}
                        safeListPathsFromSession={new Set(sessions.activeSession?.addedToSafeListPaths ?? [])}
                        scanStatus={scan.status}
                        scanResult={scan.result}
                        onRunScan={scan.runScan}
                        onCancelScan={scan.cancelScan}
                        scanCanceling={scan.scanCanceling}
                        onBrowseFolder={scan.handleBrowseFolder}
                    />
                </div>
            ) : null}

            <AskAiResultDialog
                open={askAiDialogOpen}
                loading={askAiLoading}
                error={askAiError}
                results={askAiResults}
                selectedIndex={askAiSelectedIndex}
                sessionName={sessions.activeSession?.name ?? ''}
                onSelectIndex={setAskAiSelectedIndex}
                onAddToSession={handleAddAskAiResultToSession}
                onClose={() => setAskAiDialogOpen(false)}
            />

            <ExpertModeDialogs
                showAiSnapshotDecisionDialog={ai.showAiSnapshotDecisionDialog}
                aiSnapshotDecisionSaving={ai.aiSnapshotDecisionSaving}
                aiSnapshotDecisionRememberForSession={ai.aiSnapshotDecisionRememberForSession}
                pendingAiSnapshotDecision={ai.pendingAiSnapshotDecision}
                onAiSnapshotDecisionAction={ai.handleAiSnapshotDecisionAction}
                onAiSnapshotDecisionClose={ai.handleAiSnapshotDecisionClose}
                onSetAiSnapshotDecisionRememberForSession={ai.setAiSnapshotDecisionRememberForSession}
                showSaveDialog={actions.showSaveDialog}
                snapshotName={actions.snapshotName}
                onSetSnapshotName={actions.setSnapshotName}
                onConfirmSaveSnapshot={actions.handleConfirmSaveSnapshot}
                onCloseSaveDialog={() => actions.setShowSaveDialog(false)}
                safeListDialog={actions.safeListDialog}
                onSetSafeListDialog={actions.setSafeListDialog}
                onSafeListConfirm={actions.handleSafeListConfirm}
            />

            <CloudStorageSelector
                open={actions.showCloudSelector}
                onClose={() => actions.setShowCloudSelector(false)}
                onConfirm={actions.handleCloudStorageSelected}
                availableConfigs={actions.availableConfigs}
                fileName="迁移文件"
                preselectedConfigs={actions.selectedMigrationConfigs}
                onOpenSettings={onOpenSettings}
            />
        </div>
    );
}