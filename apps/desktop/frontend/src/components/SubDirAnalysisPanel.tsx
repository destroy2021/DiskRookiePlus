import { useTranslation } from 'react-i18next'
import { Folder, Search, ChevronRight, X as XIcon, Sparkles } from 'lucide-react'
import { Button } from '@mui/material'
import { formatBytes } from '../utils/format'
import { displayPath } from './ExpertMode.utils'
import type { DirectoryTopNResult } from '../services/ai-analysis'

interface SubDirAnalysisPanelProps {
    path: string
    subDirAnalysisPaths: string[]
    subDirScanLoading: boolean
    subDirAiLoading: boolean
    subDirAnalysisResult: DirectoryTopNResult | null
    subDirAnalysisResults: DirectoryTopNResult[]
    onBack: () => void
    onClear: () => void
    onScanCancel: () => void
    onAiCancel: () => void
    onSubDirScan: (path: string) => void
    onSubDirAiAnalyze: (path: string, result: DirectoryTopNResult) => void
}

export function SubDirAnalysisPanel({
    path, subDirAnalysisPaths, subDirScanLoading, subDirAiLoading,
    subDirAnalysisResult, subDirAnalysisResults,
    onBack, onClear, onScanCancel, onAiCancel,
    onSubDirScan, onSubDirAiAnalyze,
}: SubDirAnalysisPanelProps) {
    const { t } = useTranslation()

    return (
        <>
            {(subDirAnalysisPaths.length > 0 || subDirAnalysisResult) && (
                <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-xl border border-primary/30 dark:border-primary/40 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                            <Search size={14} className="text-primary" />
                            <span className="text-[11px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-widest">
                                {t('aiAnalysis.subDirAnalysisContext')}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            {subDirAnalysisPaths.length > 0 && (
                                <Button
                                    size="small"
                                    onClick={onBack}
                                    startIcon={<ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} />}
                                    sx={{
                                        fontSize: '10px',
                                        textTransform: 'none',
                                        minWidth: 'auto',
                                        px: 1,
                                        py: 0.25,
                                        color: 'text.secondary',
                                        borderRadius: '6px',
                                        '&:hover': { bgcolor: 'action.hover' },
                                    }}
                                >
                                    {t('aiAnalysis.subDirAnalysisBack')}
                                </Button>
                            )}
                            <Button
                                size="small"
                                onClick={onClear}
                                startIcon={<XIcon size={12} />}
                                sx={{
                                    fontSize: '10px',
                                    textTransform: 'none',
                                    minWidth: 'auto',
                                    px: 1,
                                    py: 0.25,
                                    color: 'text.secondary',
                                    borderRadius: '6px',
                                    '&:hover': { bgcolor: 'action.hover' },
                                }}
                            >
                                {t('aiAnalysis.subDirAnalysisClear')}
                            </Button>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300 font-medium">
                            {displayPath(path)}
                        </span>
                        {subDirAnalysisPaths.map((p, i) => (
                            <span key={i} className="flex items-center gap-1">
                                <ChevronRight size={10} className="text-slate-400 dark:text-gray-500" />
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                    {displayPath(p).split(/[/\\]/).pop() || displayPath(p)}
                                </span>
                            </span>
                        ))}
                    </div>
                </div>
            )}
            {subDirScanLoading && (
                <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                        <span className="text-xs text-slate-500 dark:text-gray-400">{t('aiAnalysis.subDirAnalysisScanning')}</span>
                    </div>
                    <Button
                        size="small"
                        onClick={onScanCancel}
                        startIcon={<XIcon size={12} />}
                        sx={{
                            fontSize: '10px',
                            textTransform: 'none',
                            minWidth: 'auto',
                            px: 1,
                            py: 0.25,
                            color: 'text.secondary',
                            borderRadius: '6px',
                            '&:hover': { bgcolor: 'action.hover' },
                        }}
                    >
                        {t('common.cancel')}
                    </Button>
                </div>
            )}
            {subDirAiLoading && (
                <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-xl border border-primary/30 dark:border-primary/40 shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                        <span className="text-xs text-slate-500 dark:text-gray-400">{t('aiAnalysis.subDirAnalysisAnalyzing')}</span>
                    </div>
                    <Button
                        size="small"
                        onClick={onAiCancel}
                        startIcon={<XIcon size={12} />}
                        sx={{
                            fontSize: '10px',
                            textTransform: 'none',
                            minWidth: 'auto',
                            px: 1,
                            py: 0.25,
                            color: 'text.secondary',
                            borderRadius: '6px',
                            '&:hover': { bgcolor: 'action.hover' },
                        }}
                    >
                        {t('common.cancel')}
                    </Button>
                </div>
            )}
            {subDirAnalysisResult && !subDirScanLoading && (
                <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-xl border border-primary/20 dark:border-primary/30 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Folder size={14} className="text-primary" />
                            <span className="text-xs font-semibold text-slate-700 dark:text-gray-200 truncate">
                                {subDirAnalysisResult.name}
                            </span>
                        </div>
                        {!subDirAiLoading && (
                            <Button
                                size="small"
                                onClick={() => {
                                    const currentPath = subDirAnalysisPaths[subDirAnalysisPaths.length - 1] || path
                                    const currentResult = subDirAnalysisResults[subDirAnalysisResults.length - 1] || subDirAnalysisResult
                                    if (currentResult) onSubDirAiAnalyze(currentPath, currentResult)
                                }}
                                startIcon={<Sparkles size={12} />}
                                sx={{
                                    fontSize: '10px',
                                    textTransform: 'none',
                                    minWidth: 'auto',
                                    px: 1.5,
                                    py: 0.25,
                                    color: 'primary.main',
                                    borderRadius: '6px',
                                    border: '1px solid',
                                    borderColor: 'primary.main',
                                    '&:hover': {
                                        bgcolor: 'primary.main',
                                        color: '#1A1A1A',
                                    },
                                }}
                            >
                                AI {t('aiAnalysis.analyze')}
                            </Button>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-slate-50 dark:bg-gray-700/40 rounded-lg px-2 py-1.5">
                            <span className="text-slate-500 dark:text-gray-400">{t('expertMode.diskUsage')}</span>
                            <span className="ml-1 font-semibold text-slate-700 dark:text-gray-200">{formatBytes(subDirAnalysisResult.total_size)}</span>
                        </div>
                        <div className="bg-slate-50 dark:bg-gray-700/40 rounded-lg px-2 py-1.5">
                            <span className="text-slate-500 dark:text-gray-400">{t('expertMode.totalFiles')}</span>
                            <span className="ml-1 font-semibold text-slate-700 dark:text-gray-200">{subDirAnalysisResult.file_count.toLocaleString()}</span>
                        </div>
                    </div>
                    {subDirAnalysisResult.top_directories.length > 0 && (
                        <div className="mt-2">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">Top {Math.min(5, subDirAnalysisResult.top_directories.length)} Dirs</span>
                            <div className="mt-1 flex flex-col gap-0.5">
                                {subDirAnalysisResult.top_directories.slice(0, 5).map((d, i) => (
                                    <div key={i} className="flex items-center justify-between text-[11px] px-1.5 py-1 rounded hover:bg-slate-50 dark:hover:bg-gray-700/30 cursor-pointer group"
                                        onClick={() => onSubDirScan(d.path)}
                                    >
                                        <span className="text-slate-600 dark:text-gray-300 truncate flex-1 mr-2 group-hover:text-primary">{d.name}</span>
                                        <span className="text-slate-400 dark:text-gray-500 font-mono shrink-0">{formatBytes(d.size)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {subDirAnalysisResult.top_files.length > 0 && (
                        <div className="mt-2">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">Top {Math.min(5, subDirAnalysisResult.top_files.length)} Files</span>
                            <div className="mt-1 flex flex-col gap-0.5">
                                {subDirAnalysisResult.top_files.slice(0, 5).map((f, i) => (
                                    <div key={i} className="flex items-center justify-between text-[11px] px-1.5 py-1 rounded">
                                        <span className="text-slate-600 dark:text-gray-300 truncate flex-1 mr-2">
                                            {displayPath(f.path).split(/[/\\]/).pop() || displayPath(f.path)}
                                        </span>
                                        <span className="text-slate-400 dark:text-gray-500 font-mono shrink-0">{formatBytes(f.size)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    )
}
