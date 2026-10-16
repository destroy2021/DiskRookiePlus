import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, CheckCircle2, FileStack, Sparkles, Save, BarChart3, ChevronDown, Zap, Target, StopCircle } from 'lucide-react'
import { Button, Tooltip, Menu, MenuItem, ListItemIcon, ListItemText, Dialog, DialogTitle, DialogContent, DialogActions, Typography } from '@mui/material'
import type { ActiveTab, ScanResult } from './ExpertMode.types'
import type { AnalysisResult, CleanupSuggestion } from '../services/ai-analysis'

interface ExpertModeToolbarProps {
    scanResult: ScanResult | null
    shallowDirs: boolean
    onSetShallowDirs: (v: boolean) => void
    activeTab: ActiveTab
    onSwitchTab: (tab: ActiveTab) => void
    aiAnalyzing: boolean
    onCancelAiAnalysis: () => void
    onRunAiAnalysis: () => void
    onRunAiAnalysisSelected: (paths: string[]) => void
    onRunDeepAiAnalysis: () => void
    aiAnalyzeActionLabel: string
    onSaveSnapshot: () => void
    analysisResult: AnalysisResult | null
    deletedPaths: Set<string>
    addedToSafeListPaths: Set<string>
    actionFilter: 'all' | 'delete' | 'move'
    selectedItems: Set<string>
    deleteMode: 'permanent' | 'trash'
    handleSelectAll: () => void
    setDeleteMode: (v: 'permanent' | 'trash') => void
    handleBatchExecute: () => Promise<void>
    onSubDirBatchAiAnalyze: (paths: string[]) => void
    subDirAiLoading: boolean
    subDirScanLoading: boolean
    scanPath: string
    selectedDirPaths: string[]
    agentRunning?: boolean
    onStopAgent?: () => void
}

export function ExpertModeToolbar({
    scanResult, shallowDirs, onSetShallowDirs,
    activeTab, onSwitchTab,
    aiAnalyzing, onCancelAiAnalysis, onRunAiAnalysis, onRunAiAnalysisSelected, onRunDeepAiAnalysis, aiAnalyzeActionLabel, onSaveSnapshot,
    analysisResult, deletedPaths, addedToSafeListPaths, actionFilter, selectedItems,
    deleteMode, handleSelectAll, setDeleteMode, handleBatchExecute,
    onSubDirBatchAiAnalyze, subDirAiLoading, subDirScanLoading,
    scanPath, selectedDirPaths,
    agentRunning = false, onStopAgent,
}: ExpertModeToolbarProps) {
    const { t } = useTranslation()
    const [aiMenuAnchor, setAiMenuAnchor] = useState<null | HTMLElement>(null)
    const [confirmDialog, setConfirmDialog] = useState<'all' | 'selected' | null>(null)

    const handleAiClick = (e: React.MouseEvent<HTMLElement>) => {
        if (analysisResult) {
            setAiMenuAnchor(e.currentTarget)
        } else {
            setConfirmDialog('all')
        }
    }

    const handleConfirmAnalyze = () => {
        if (confirmDialog === 'all') {
            onRunAiAnalysis()
        } else if (confirmDialog === 'selected') {
            onRunAiAnalysisSelected(selectedDirPaths)
        }
        setConfirmDialog(null)
        setAiMenuAnchor(null)
    }

    const confirmDirCount = confirmDialog === 'selected' ? selectedDirPaths.length : (scanResult?.root_children?.length ?? 0)

    return (
        <div className="space-y-3 shrink-0">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200/80 dark:border-gray-600 bg-slate-50/50 dark:bg-gray-700/30">
                    <label className="flex items-center gap-2 cursor-pointer group w-fit select-none">
                        <div className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${shallowDirs ? 'bg-primary border-primary' : 'border-slate-300 dark:border-gray-500'}`}>
                            {shallowDirs && <CheckCircle2 size={10} className="text-secondary" />}
                        </div>
                        <input type="checkbox" className="hidden" checked={shallowDirs} onChange={(e) => onSetShallowDirs(e.target.checked)} />
                        <span className="text-[11px] font-medium text-slate-500 dark:text-gray-400 group-hover:text-secondary">{t('expertMode.shallowDirs')}</span>
                    </label>
                    <div className="w-px h-5 bg-slate-200 dark:bg-gray-600 shrink-0" aria-hidden />
                    <div className="bg-slate-200/50 dark:bg-gray-600/50 p-0.5 rounded-lg flex gap-0.5 border border-slate-200/80 dark:border-gray-600">
                        <button
                            onClick={() => onSwitchTab('file-browser')}
                            className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1 ${activeTab === 'file-browser' ? 'bg-white dark:bg-gray-600 text-secondary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}
                        >
                            <Folder size={12} />
                            {t('expertMode.fileBrowser')}
                        </button>
                        <button
                            onClick={() => onSwitchTab('file-summary')}
                            disabled={!scanResult}
                            className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1 ${activeTab === 'file-summary' ? 'bg-secondary text-primary shadow-sm' : scanResult ? 'text-slate-500 dark:text-gray-400' : 'text-slate-300 dark:text-gray-600 cursor-not-allowed'}`}
                        >
                            <BarChart3 size={12} />
                            {t('expertMode.fileSummary')}
                        </button>
                        <button
                            onClick={() => onSwitchTab('analysis-report')}
                            disabled={!scanResult}
                            className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1 ${activeTab === 'analysis-report' ? 'bg-primary text-secondary shadow-sm' : scanResult ? 'text-slate-500 dark:text-gray-400' : 'text-slate-300 dark:text-gray-600 cursor-not-allowed'}`}
                        >
                            <Sparkles size={12} />
                            {t('expertMode.analysisReport')}
                        </button>
                    </div>
                </div>
                {analysisResult && (() => {
                    const tooltipTitle = `${analysisResult.suggestions.length} ${t('expertMode.suggestions')}`
                    return (
                        <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-2">
                            {(() => {
                                const visibleItems = analysisResult.suggestions
                                    .filter((s: CleanupSuggestion) => !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path))
                                    .filter((s: CleanupSuggestion) => actionFilter === 'all' || s.action === actionFilter)
                                if (visibleItems.length === 0) return null
                                const allSelected = visibleItems.every((s: CleanupSuggestion) => selectedItems.has(s.path))
                                return (
                                    <Button
                                        onClick={handleSelectAll}
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
                                )
                            })()}
                            {selectedItems.size > 0 && (
                                <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-700/50 rounded-lg p-0.5">
                                    <Button
                                        size="small"
                                        onClick={() => setDeleteMode('trash')}
                                        sx={{
                                            fontSize: '10px', textTransform: 'none', minWidth: 'auto', px: 2, py: 0.8,
                                            borderRadius: '10px',
                                            bgcolor: deleteMode === 'trash' ? 'primary.main' : 'transparent',
                                            color: deleteMode === 'trash' ? '#1A1A1A' : 'text.secondary',
                                            fontWeight: deleteMode === 'trash' ? 700 : 400,
                                            '&:hover': { bgcolor: deleteMode === 'trash' ? 'primary.dark' : 'action.hover' },
                                        }}
                                    >
                                        {t('aiAnalysis.moveToTrash')}
                                    </Button>
                                    <Button
                                        size="small"
                                        onClick={() => setDeleteMode('permanent')}
                                        sx={{
                                            fontSize: '10px', textTransform: 'none', minWidth: 'auto', px: 2, py: 0.8,
                                            borderRadius: '10px',
                                            bgcolor: deleteMode === 'permanent' ? '#ef4444' : 'transparent',
                                            color: deleteMode === 'permanent' ? 'white' : 'text.secondary',
                                            fontWeight: deleteMode === 'permanent' ? 700 : 400,
                                            '&:hover': { bgcolor: deleteMode === 'permanent' ? '#dc2626' : 'action.hover' },
                                        }}
                                    >
                                        {t('aiAnalysis.permanentDelete')}
                                    </Button>
                                </div>
                            )}
                            {selectedItems.size > 0 && (
                                <Button
                                    onClick={handleBatchExecute}
                                    variant="contained"
                                    size="small"
                                    startIcon={<Sparkles size={14} />}
                                    sx={{
                                        borderRadius: '10px', px: 2, py: 0.8,
                                        bgcolor: 'primary.main', color: '#1A1A1A',
                                        fontWeight: 700, fontSize: '11px', textTransform: 'none', boxShadow: 'none',
                                        '&:hover': { bgcolor: 'primary.dark', boxShadow: 'none' }
                                    }}
                                >
                                    {t('common.execute')} ({selectedItems.size})
                                </Button>
                            )}
                            {(() => {
                                const dirs = analysisResult.suggestions
                                    .filter((s: CleanupSuggestion) => s.type === 'directory' && selectedItems.has(s.path) && !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path))
                                    .map((s: CleanupSuggestion) => s.path) ?? []
                                return dirs.length >= 1 && !subDirAiLoading && !subDirScanLoading ? (
                                    <Button
                                        onClick={() => onSubDirBatchAiAnalyze(dirs)}
                                        variant="outlined"
                                        size="small"
                                        sx={{
                                            borderRadius: '10px', px: 2, py: 0.8,
                                            fontWeight: 700, fontSize: '11px', textTransform: 'none',
                                            borderColor: 'primary.main', color: 'primary.main',
                                            '&:hover': { bgcolor: 'primary.main', color: '#1A1A1A', borderColor: 'primary.main' }
                                        }}
                                    >
                                        {t('aiAnalysis.subDirAnalysisBatch')} ({dirs.length})
                                    </Button>
                                ) : null
                            })()}
                            <Tooltip title={tooltipTitle} arrow placement="bottom">
                                <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200/80 dark:border-gray-600 bg-slate-50/50 dark:bg-gray-700/30 cursor-default">
                                    <span className="flex items-center gap-2">
                                        <FileStack size={14} className="text-slate-400 dark:text-gray-400 shrink-0" />
                                        <span className="text-[11px] dark:text-gray-300 font-semibold text-secondary">{analysisResult.suggestions.length} {t('expertMode.suggestions')}</span>
                                    </span>
                                </div>
                            </Tooltip>
                            </div>
                        </div>
                    )
                })()}
            </div>

            {scanResult && !aiAnalyzing && (
                <div className="flex items-center gap-2">
                    <Button
                        onClick={handleAiClick}
                        variant="outlined"
                        size="small"
                        endIcon={analysisResult ? <ChevronDown size={14} /> : undefined}
                        startIcon={<Sparkles size={14} />}
                        sx={{
                            borderRadius: '10px', px: 2, py: 0.9,
                            color: 'primary.main', borderColor: 'primary.main',
                            textTransform: 'none', fontWeight: 600, fontSize: '12px',
                            '&:hover': { bgcolor: 'primary.main', color: '#1A1A1A', borderColor: 'primary.main' }
                        }}
                    >
                        {aiAnalyzeActionLabel}
                    </Button>
                    <Menu
                        open={aiMenuAnchor !== null}
                        onClose={() => setAiMenuAnchor(null)}
                        anchorEl={aiMenuAnchor}
                        slotProps={{ paper: { sx: { minWidth: 200, borderRadius: '10px' } } }}
                    >
                        <MenuItem onClick={() => { setConfirmDialog('all'); setAiMenuAnchor(null) }}>
                            <ListItemIcon><Zap size={16} className="text-primary" /></ListItemIcon>
                            <ListItemText primary={t('aiAnalysis.analyzeAll')} primaryTypographyProps={{ fontSize: 12, fontWeight: 600 }} />
                        </MenuItem>
                        <MenuItem
                            onClick={() => { setConfirmDialog('selected'); setAiMenuAnchor(null) }}
                            disabled={selectedDirPaths.length === 0}
                        >
                            <ListItemIcon><Target size={16} className="text-blue-500" /></ListItemIcon>
                            <ListItemText
                                primary={selectedDirPaths.length > 0 ? t('aiAnalysis.analyzeSelected', { count: selectedDirPaths.length }) : t('aiAnalysis.analyzeSelectedNone')}
                                primaryTypographyProps={{ fontSize: 12, fontWeight: 600 }}
                            />
                        </MenuItem>
                        <MenuItem onClick={() => { onRunDeepAiAnalysis(); setAiMenuAnchor(null) }}>
                            <ListItemIcon><Sparkles size={16} className="text-purple-500" /></ListItemIcon>
                            <ListItemText primary={t('aiAnalysis.deepAnalysis')} primaryTypographyProps={{ fontSize: 12, fontWeight: 600 }} />
                        </MenuItem>
                    </Menu>
                    {analysisResult && (
                        <Tooltip title={t('snapshot.saveSnapshot')} arrow>
                            <Button
                                onClick={onSaveSnapshot}
                                variant="outlined"
                                size="small"
                                startIcon={<Save size={14} />}
                                sx={{
                                    borderRadius: '10px', px: 2, py: 0.9,
                                    color: 'primary.main', borderColor: 'primary.main',
                                    textTransform: 'none', fontWeight: 600, fontSize: '12px',
                                    '&:hover': { bgcolor: 'primary.main', color: '#1A1A1A', borderColor: 'primary.main' }
                                }}
                            >
                                {t('snapshot.saveSnapshot')}
                            </Button>
                        </Tooltip>
                    )}
                </div>
            )}

            {aiAnalyzing && (
                <div className="flex items-center gap-2">
                    <Button
                        onClick={onCancelAiAnalysis}
                        variant="outlined"
                        size="small"
                        sx={{
                            borderRadius: '10px', px: 2, py: 0.9,
                            color: 'error.main', borderColor: 'error.main',
                            textTransform: 'none', fontWeight: 600, fontSize: '12px',
                            '&:hover': { bgcolor: 'error.main', color: '#fff', borderColor: 'error.main' }
                        }}
                    >
                        {t('aiAnalysis.cancel')}
                    </Button>
                </div>
            )}

            {!aiAnalyzing && agentRunning && onStopAgent && (
                <div className="flex items-center gap-2">
                    <Button
                        onClick={onStopAgent}
                        variant="outlined"
                        size="small"
                        startIcon={<StopCircle size={14} />}
                        sx={{
                            borderRadius: '10px', px: 2, py: 0.9,
                            color: 'error.main', borderColor: 'error.main',
                            textTransform: 'none', fontWeight: 600, fontSize: '12px',
                            '&:hover': { bgcolor: 'error.main', color: '#fff', borderColor: 'error.main' }
                        }}
                    >
                        {t('aiAnalysis.agentStop')}
                    </Button>
                </div>
            )}

            <Dialog
                open={confirmDialog !== null}
                onClose={() => setConfirmDialog(null)}
                maxWidth="xs"
                fullWidth
                slotProps={{ paper: { sx: { borderRadius: '12px' } } }}
            >
                <DialogTitle sx={{ fontSize: 14, fontWeight: 700 }}>
                    {confirmDialog === 'selected' ? t('aiAnalysis.confirmAnalyzeSelectedTitle') : t('aiAnalysis.confirmAnalyzeAllTitle')}
                </DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ fontSize: 13, lineHeight: 1.6 }}>
                        {confirmDialog === 'selected'
                            ? t('aiAnalysis.confirmAnalyzeSelectedDesc', { count: confirmDirCount })
                            : t('aiAnalysis.confirmAnalyzeAllDesc', { count: confirmDirCount, path: scanPath })
                        }
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 2, pb: 1.5, gap: 1 }}>
                    <Button onClick={() => setConfirmDialog(null)} size="small" sx={{ textTransform: 'none', fontSize: 12 }}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        onClick={handleConfirmAnalyze}
                        variant="contained"
                        size="small"
                        startIcon={<Sparkles size={14} />}
                        sx={{
                            borderRadius: '10px', px: 2,
                            bgcolor: 'primary.main', color: '#1A1A1A',
                            fontWeight: 700, fontSize: 12, textTransform: 'none', boxShadow: 'none',
                            '&:hover': { bgcolor: 'primary.dark', boxShadow: 'none' }
                        }}
                    >
                        {t('aiAnalysis.startAnalysis')}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    )
}