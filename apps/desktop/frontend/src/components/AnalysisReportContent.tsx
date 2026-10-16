import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, MoveRight, ChevronDown, ChevronRight, Cloud, Sparkles, File, Folder, Search, StopCircle } from 'lucide-react'
import { Button, Tooltip, Chip } from '@mui/material'
import { AiPieChart } from './AiPieChart'
import { SuggestionCard } from './SuggestionCard'
import type { ScanResult, AgentToolCallLog, AgentRunProgress, SuggestionGroup } from './ExpertMode.types'
import type { AnalysisResult, CleanupSuggestion, DirectoryTopNResult } from '../services/ai-analysis'
import type { Task } from '../services/taskQueue'
import type { CloudStorageConfig } from '../services/settings'
import { groupSuggestionsByParent } from './ExpertMode.utils'

interface AnalysisReportContentProps {
    scanPath: string
    scanResult: ScanResult
    analysisResult: AnalysisResult
    latestAiRawText: string
    getTaskForPath: (filePath: string) => Task | undefined
    deletedPaths: Set<string>
    addedToSafeListPaths: Set<string>
    actionFilter: 'all' | 'delete' | 'move'
    selectedItems: Set<string>
    deleteMode: 'permanent' | 'trash'
    migrationTargetNames: string
    getActualAction: (path: string, originalAction: 'delete' | 'move') => 'delete' | 'move'
    handleDelete: (itemPath: string, mode?: 'trash' | 'permanent') => Promise<void>
    handleMove: (itemPath: string, configs?: CloudStorageConfig[], targetPath?: string, fileSize?: number) => Promise<void>
    handleSelectChange: (path: string, selected: boolean) => void
    handleToggleAction: (path: string, currentAction: 'delete' | 'move') => void
    handleAddToSafeListClick: (itemPath: string) => Promise<void>
    handleSelectionDragStart: (path: string, selected: boolean) => void
    handleSelectionDragEnter: (path: string) => void
    handleSelectionDragEnd: () => void
    handleSetMigrationTarget: () => Promise<void>
    onOpenCloudSettings?: () => void
    subDirAnalysisResult: DirectoryTopNResult | null
    onSubDirScan: (dirPath: string) => void
    onSubDirAiAnalyze: (selectedPaths: string[], scanResult: DirectoryTopNResult) => Promise<void>
    onSwitchTab?: (tab: 'file-browser' | 'file-summary' | 'analysis-report') => void
    agentLogs?: AgentToolCallLog[]
    agentRunning?: boolean
    agentProgress?: AgentRunProgress | null
    onStopAgent?: () => void
    onRemoveSuggestion?: (path: string) => void
    onAddSuggestion?: (suggestion: CleanupSuggestion) => void
}

function AgentLogRow({ log }: { log: AgentToolCallLog }) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    const argsText = useMemo(() => JSON.stringify(log.args), [log.args])
    const argsTooLong = argsText.length > 80
    const resultTooLong = (log.result?.length ?? 0) > 60

    const statusColor = log.status === 'failure' || log.status === 'rejected'
        ? 'text-red-500 dark:text-red-400'
        : log.status === 'success'
            ? 'text-green-600 dark:text-green-400'
            : 'text-slate-500 dark:text-gray-400'
    const statusLabel = log.status === 'success'
        ? t('aiAnalysis.agentLogStatusSuccess')
        : log.status === 'failure'
            ? t('aiAnalysis.agentLogStatusFailure')
            : log.status === 'rejected'
                ? t('aiAnalysis.agentLogStatusRejected')
                : ''

    return (
        <div className="text-[11px]">
            <div className="flex items-start gap-2">
                <span className="text-slate-400 dark:text-gray-500 font-mono shrink-0">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>
                <span className="font-semibold text-primary dark:text-blue-400 shrink-0">
                    {log.toolName}
                </span>
                <span className={`shrink-0 font-mono ${statusColor}`}>
                    {statusLabel}{log.durationMs != null ? ` · ${log.durationMs}ms` : ''}
                </span>
                {(log.truncated || log.timedOut) && (
                    <span className="shrink-0 text-amber-600 dark:text-amber-300 font-mono">
                        {log.truncated ? t('aiAnalysis.agentLogTruncated') : t('aiAnalysis.agentLogTimedOut')}
                    </span>
                )}
                {(argsTooLong || resultTooLong) && (
                    <button
                        onClick={() => setExpanded(v => !v)}
                        className="shrink-0 ml-auto text-slate-400 dark:text-gray-500 hover:text-primary"
                    >
                        {expanded ? t('aiAnalysis.agentLogCollapse') : (argsTooLong ? t('aiAnalysis.agentLogToggleArgs') : t('aiAnalysis.agentLogToggleResult'))}
                    </button>
                )}
            </div>
            <div className="mt-0.5 pl-2 flex flex-col gap-0.5">
                <span className="text-slate-500 dark:text-gray-400 break-all">
                    {expanded ? argsText : argsText.slice(0, 80)}
                </span>
                {log.result && (
                    <span className="text-slate-600 dark:text-gray-300 break-all">
                        → {expanded ? log.result : log.result.slice(0, 60)}
                    </span>
                )}
            </div>
        </div>
    )
}

export function AnalysisReportContent({
    scanPath, scanResult, analysisResult, latestAiRawText,
    getTaskForPath,
    deletedPaths, addedToSafeListPaths, actionFilter, selectedItems,
    deleteMode, migrationTargetNames, getActualAction,
    handleDelete, handleMove, handleSelectChange, handleToggleAction,
    handleAddToSafeListClick,
    handleSelectionDragStart, handleSelectionDragEnter, handleSelectionDragEnd,
    handleSetMigrationTarget,
    onOpenCloudSettings,
    subDirAnalysisResult: _subDirAnalysisResult,
    onSubDirScan, onSubDirAiAnalyze: _onSubDirAiAnalyze,
    onSwitchTab,
    agentLogs = [],
    agentRunning = false,
    agentProgress = null,
    onStopAgent,
    onRemoveSuggestion,
    onAddSuggestion: _onAddSuggestion,
}: AnalysisReportContentProps) {
    const { t } = useTranslation()
    const [showRawText, setShowRawText] = useState(false)
    const [filterType, setFilterType] = useState<'all' | 'delete' | 'move'>('all')
    const [showAgentLog, setShowAgentLog] = useState(false)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

    const allSuggestions = analysisResult.suggestions

    const visibleSuggestions = useMemo(() => {
        return allSuggestions.filter(s => {
            if (deletedPaths.has(s.path) || addedToSafeListPaths.has(s.path)) return false
            const actualAction = getActualAction(s.path, s.action)
            const effectiveFilter = filterType === 'all' ? actionFilter : filterType
            return effectiveFilter === 'all' || actualAction === effectiveFilter
        })
    }, [allSuggestions, deletedPaths, addedToSafeListPaths, getActualAction, filterType, actionFilter])

    const suggestionGroups = useMemo(() =>
        groupSuggestionsByParent(visibleSuggestions)
    , [visibleSuggestions])

    const toggleGroup = (groupKey: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev)
            if (next.has(groupKey)) next.delete(groupKey)
            else next.add(groupKey)
            return next
        })
    }

    const stats = useMemo(() => {
        const deleteItems = allSuggestions.filter(s => getActualAction(s.path, s.action) === 'delete')
        const moveItems = allSuggestions.filter(s => getActualAction(s.path, s.action) === 'move')
        const deletedCount = allSuggestions.filter(s => deletedPaths.has(s.path)).length
        return { deleteCount: deleteItems.length, moveCount: moveItems.length, deletedCount, total: allSuggestions.length }
    }, [allSuggestions, getActualAction, deletedPaths])

    const allSelected = visibleSuggestions.length > 0 && visibleSuggestions.every(s => selectedItems.has(s.path))

    return (
        <div className="flex flex-col gap-4 pr-1">
            <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm shrink-0">
                <div className="flex items-center gap-2 mb-2">
                    <Sparkles size={16} className="text-primary" />
                    <span className="text-sm font-semibold text-slate-700 dark:text-gray-200">
                        {t('aiAnalysis.result')}
                    </span>
                    {analysisResult.interrupted && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            {t('aiAnalysis.interruptedTag')}
                        </span>
                    )}
                </div>
                <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                    {analysisResult.summary}
                </p>
                {analysisResult.continueContextHint && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-300 leading-relaxed mt-2">
                        {analysisResult.continueContextHint}
                    </p>
                )}
                {analysisResult.partial && (
                    <p className="text-[10px] text-slate-500 dark:text-gray-400 leading-relaxed mt-1">
                        {t('aiAnalysis.partialTag', { count: analysisResult.droppedSuggestions ?? 0 })}
                    </p>
                )}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        {analysisResult.tokenUsage && (
                            <Tooltip title={`Prompt: ${analysisResult.tokenUsage.prompt_tokens} | Completion: ${analysisResult.tokenUsage.completion_tokens}`} arrow>
                                <span className="text-[10px] text-slate-400 dark:text-gray-500 font-mono">
                                    Token: {analysisResult.tokenUsage.total_tokens}
                                </span>
                            </Tooltip>
                        )}
                    </div>
                    <Button
                        size="small"
                        startIcon={<Cloud size={14} />}
                        onClick={handleSetMigrationTarget}
                        sx={{
                            fontSize: '11px', textTransform: 'none', borderRadius: '8px',
                            py: 0.75, px: 1.5, bgcolor: 'action.hover', color: 'text.secondary',
                            '&:hover': { bgcolor: 'action.selected' },
                        }}
                        className="dark:!bg-gray-700/50 dark:!text-gray-300 dark:hover:!bg-gray-700"
                    >
                        {migrationTargetNames ? (
                            <>
                                <span className="text-[10px] text-slate-500 dark:text-gray-400 mr-1">{t('aiAnalysis.migrateTo')}</span>
                                <span className="font-medium">{migrationTargetNames}</span>
                            </>
                        ) : (
                            t('aiAnalysis.setMigrationTarget')
                        )}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3 shrink-0">
                <div className="bg-white dark:bg-gray-800 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-50 dark:bg-red-900/20">
                        <Trash2 size={16} className="text-red-500" />
                    </div>
                    <div>
                        <p className="text-[10px] text-slate-400 dark:text-gray-500 font-medium">{t('aiAnalysis.delete')}</p>
                        <p className="text-sm font-bold text-slate-700 dark:text-gray-200">{stats.deleteCount}</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50 dark:bg-blue-900/20">
                        <MoveRight size={16} className="text-blue-500" />
                    </div>
                    <div>
                        <p className="text-[10px] text-slate-400 dark:text-gray-500 font-medium">{t('aiAnalysis.migrate')}</p>
                        <p className="text-sm font-bold text-slate-700 dark:text-gray-200">{stats.moveCount}</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-50 dark:bg-green-900/20">
                        <File size={16} className="text-green-500" />
                    </div>
                    <div>
                        <p className="text-[10px] text-slate-400 dark:text-gray-500 font-medium">{t('aiAnalysis.processed')}</p>
                        <p className="text-sm font-bold text-slate-700 dark:text-gray-200">{stats.deletedCount}/{stats.total}</p>
                    </div>
                </div>
            </div>

            <div className="shrink-0">
                <AiPieChart
                    analysisResult={analysisResult}
                    result={scanResult}
                    path={scanPath}
                    deletedPaths={deletedPaths}
                    addedToSafeListPaths={addedToSafeListPaths}
                    actionFilter={actionFilter}
                    setActionFilter={() => {}}
                    getActualAction={getActualAction}
                />
            </div>

            {allSuggestions.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-700 dark:text-gray-200">
                                {t('aiAnalysis.suggestions')} ({visibleSuggestions.length}/{allSuggestions.length})
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="bg-slate-100 dark:bg-gray-700/50 p-0.5 rounded-lg flex gap-0.5">
                                {(['all', 'delete', 'move'] as const).map(ft => (
                                    <button
                                        key={ft}
                                        onClick={() => setFilterType(ft)}
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all ${
                                            (ft === 'all' ? filterType === 'all' || filterType === actionFilter : filterType === ft)
                                                ? 'bg-white dark:bg-gray-600 text-secondary shadow-sm'
                                                : 'text-slate-500 dark:text-gray-400'
                                        }`}
                                    >
                                        {ft === 'all' ? t('aiAnalysis.showAll') : ft === 'delete' ? t('aiAnalysis.delete') : t('aiAnalysis.migrate')}
                                    </button>
                                ))}
                            </div>
                            <Button
                                onClick={() => {
                                    visibleSuggestions.forEach(s => handleSelectChange(s.path, !allSelected))
                                }}
                                variant="outlined"
                                size="small"
                                sx={{
                                    borderRadius: '10px', px: 1.5, py: 0.8,
                                    color: 'primary.main', borderColor: 'primary.main',
                                    fontWeight: 700, fontSize: '11px', textTransform: 'none',
                                    '&:hover': { bgcolor: 'primary.main', color: '#1A1A1A', borderColor: 'primary.main' }
                                }}
                            >
                                {allSelected ? t('common.deselectAll') : t('common.selectAll')}
                            </Button>
                        </div>
                    </div>

                    <div className="p-3 flex flex-col gap-3">
                        {visibleSuggestions.length === 0 && allSuggestions.length > 0 && (
                            <div className="text-center py-6 text-slate-400 dark:text-gray-500 text-xs">
                                {t('aiAnalysis.noMatchingSuggestions')}
                            </div>
                        )}

                        {suggestionGroups.map((group: SuggestionGroup) => {
                            const groupKey = group.source === 'main' ? '__main__' : (group.parentPath ?? '')
                            const isExpanded = !collapsedGroups.has(groupKey)

                            return (
                                <div key={groupKey} className="rounded-xl border border-slate-100 dark:border-gray-700 overflow-hidden">
                                    <button
                                        onClick={() => toggleGroup(groupKey)}
                                        className="w-full px-3 py-2 flex items-center gap-2 bg-slate-50 dark:bg-gray-700/30 hover:bg-slate-100 dark:hover:bg-gray-700/50 transition-colors"
                                    >
                                        {isExpanded ? (
                                            <ChevronDown size={14} className="text-slate-400 dark:text-gray-500 shrink-0" />
                                        ) : (
                                            <ChevronRight size={14} className="text-slate-400 dark:text-gray-500 shrink-0" />
                                        )}

                                        {group.source === 'main' ? (
                                            <>
                                                <Sparkles size={14} className="text-primary shrink-0" />
                                                <span className="text-[12px] font-semibold text-slate-600 dark:text-gray-300">
                                                    {t('suggestion.mainAnalysis')}
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                <Folder size={14} className="text-primary shrink-0" />
                                                <Tooltip title={group.parentPath ?? ''} arrow placement="top">
                                                    <span className="text-[12px] font-semibold text-slate-600 dark:text-gray-300 truncate max-w-[60%]">
                                                        {group.parentName}
                                                    </span>
                                                </Tooltip>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300 font-medium">
                                                    {t('suggestion.subDirAnalysis')}
                                                </span>
                                            </>
                                        )}

                                        <Chip
                                            label={t('suggestion.groupSuggestions', { count: group.suggestions.length })}
                                            size="small"
                                            sx={{
                                                height: '18px', fontSize: '10px', fontWeight: 600,
                                                bgcolor: 'action.hover', color: 'text.secondary',
                                            }}
                                            className="dark:!bg-gray-600 dark:!text-gray-300 ml-auto"
                                        />
                                    </button>

                                    {isExpanded && (
                                        <div className="p-2 flex flex-col gap-2">
                                            {group.suggestions.map((suggestion: CleanupSuggestion, idx: number) => {
                                                const actualAction = getActualAction(suggestion.path, suggestion.action)
                                                const task = getTaskForPath(suggestion.path)
                                                const effectiveSuggestion: CleanupSuggestion = { ...suggestion, action: actualAction }

                                                return (
                                                    <SuggestionCard
                                                        key={`${suggestion.path}-${idx}`}
                                                        suggestion={effectiveSuggestion}
                                                        onDelete={handleDelete}
                                                        onMove={handleMove}
                                                        onOpenCloudSettings={onOpenCloudSettings}
                                                        selected={selectedItems.has(suggestion.path)}
                                                        onSelectChange={handleSelectChange}
                                                        task={task}
                                                        onToggleAction={() => handleToggleAction(suggestion.path, actualAction)}
                                                        originalAction={suggestion.action}
                                                        onAddToSafeList={handleAddToSafeListClick}
                                                        onSelectionDragStart={handleSelectionDragStart}
                                                        onSelectionDragEnter={handleSelectionDragEnter}
                                                        onSelectionDragEnd={handleSelectionDragEnd}
                                                        onSubDirAnalysis={(path) => {
                                                            onSubDirScan(path)
                                                        }}
                                                        deleteMode={deleteMode}
                                                        onRemove={onRemoveSuggestion}
                                                    />
                                                )
                                            })}

                                            {group.source === 'subdir' && group.parentPath && (
                                                <div className="flex items-center gap-2 px-2 py-1.5">
                                                    <Button
                                                        size="small"
                                                        onClick={() => onSubDirScan(group.parentPath!)}
                                                        startIcon={<Sparkles size={11} />}
                                                        sx={{
                                                            minWidth: 'auto', px: 1.5, py: 0.3,
                                                            fontSize: '10px', textTransform: 'none',
                                                            color: 'primary.main', borderRadius: '6px',
                                                            border: '1px dashed', borderColor: 'primary.main',
                                                            '&:hover': { bgcolor: 'primary.main', color: '#1A1A1A' }
                                                        }}
                                                    >
                                                        {t('suggestion.furtherAnalyze')}
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        onClick={() => {
                                                            if (group.parentPath) onSubDirScan(group.parentPath)
                                                            onSwitchTab?.('file-browser')
                                                        }}
                                                        startIcon={<Search size={11} />}
                                                        sx={{
                                                            minWidth: 'auto', px: 1.5, py: 0.3,
                                                            fontSize: '10px', textTransform: 'none',
                                                            color: 'text.secondary', borderRadius: '6px',
                                                            '&:hover': { bgcolor: 'action.hover' }
                                                        }}
                                                    >
                                                        {t('suggestion.scanMoreSubdir')}
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {(agentLogs.length > 0 || agentRunning) && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm overflow-hidden shrink-0">
                    <button
                        onClick={() => setShowAgentLog(v => !v)}
                        className="w-full px-4 py-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-gray-700/30 transition-colors"
                    >
                        {showAgentLog ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                        <Sparkles size={14} className="text-primary" />
                        <span className="text-sm font-semibold text-slate-700 dark:text-gray-200">
                            {t('aiAnalysis.agentLog')}
                        </span>
                        {agentRunning && (
                            <Chip label={t('aiAnalysis.agentRunning')} size="small" sx={{ height: 18, fontSize: '10px', fontWeight: 600, bgcolor: '#dbeafe', color: '#3b82f6' }} className="dark:!bg-blue-900/30 dark:!text-blue-400" />
                        )}
                        <span className="text-[10px] text-slate-400 dark:text-gray-500 ml-auto">
                            {agentLogs.length} {t('aiAnalysis.agentToolCalls')}
                        </span>
                    </button>
                    {agentRunning && agentProgress && (
                        <div className="px-4 pb-3 border-t border-slate-100 dark:border-gray-700">
                            <div className="flex items-center flex-wrap gap-3 pt-3 text-[11px] text-slate-600 dark:text-gray-300">
                                <span className="font-mono font-semibold text-primary dark:text-blue-400">
                                    {t('aiAnalysis.agentTurnProgress', { turn: agentProgress.turn, max: agentProgress.maxTurns })}
                                </span>
                                <span className="text-slate-500 dark:text-gray-400">
                                    {agentProgress.currentTool
                                        ? t('aiAnalysis.agentCurrentTool', { name: agentProgress.currentTool })
                                        : t('aiAnalysis.agentWaitingModel')}
                                </span>
                                <span className="text-slate-500 dark:text-gray-400">
                                    {t('aiAnalysis.agentSuggestionCount', { count: agentProgress.suggestionCount })}
                                </span>
                                {onStopAgent && (
                                    <Button
                                        onClick={onStopAgent}
                                        size="small"
                                        startIcon={<StopCircle size={12} />}
                                        sx={{
                                            ml: 'auto', minWidth: 'auto', px: 1.5, py: 0.4,
                                            fontSize: '10px', textTransform: 'none', borderRadius: '8px',
                                            color: '#ef4444',
                                            border: '1px solid', borderColor: '#ef4444',
                                            '&:hover': { bgcolor: '#ef4444', color: '#fff' }
                                        }}
                                    >
                                        {t('aiAnalysis.agentStop')}
                                    </Button>
                                )}
                            </div>
                            {agentProgress.latestSummary && (
                                <p className="mt-1.5 text-[10px] text-slate-500 dark:text-gray-400 leading-relaxed">
                                    {t('aiAnalysis.agentLatestResult')}: {agentProgress.latestSummary.slice(0, 120)}
                                </p>
                            )}
                        </div>
                    )}
                    {showAgentLog && (
                        <div className="px-4 pb-3">
                            <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-700/40 p-3 space-y-2">
                                {agentLogs.map((log, idx) => (
                                    <AgentLogRow key={idx} log={log} />
                                ))}
                                {agentRunning && (
                                    <div className="flex items-center gap-2 text-[11px] text-primary dark:text-blue-400">
                                        <span className="animate-pulse">●</span>
                                        <span>{t('aiAnalysis.agentThinking')}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm overflow-hidden shrink-0">
                <button
                    onClick={() => setShowRawText(v => !v)}
                    className="w-full px-4 py-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-gray-700/30 transition-colors"
                >
                    {showRawText ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                    <span className="text-sm font-semibold text-slate-700 dark:text-gray-200">
                        {t('aiAnalysis.rawText')}
                    </span>
                </button>
                {showRawText && (
                    <div className="px-4 pb-3">
                        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-700/40 p-3">
                            {latestAiRawText.trim() ? (
                                <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-slate-600 dark:text-gray-300 font-mono">
                                    {latestAiRawText}
                                </pre>
                            ) : (
                                <p className="text-xs text-slate-400 dark:text-gray-500">
                                    {t('aiAnalysis.rawTextEmpty')}
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
