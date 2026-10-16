import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { formatBytes } from '../utils/format'
import { parseSizeToBytes } from './ExpertMode.utils'
import type { AnalysisResult, CleanupSuggestion } from '../services/ai-analysis'
import type { ScanResult } from './ExpertMode.types'

interface AiPieChartProps {
    analysisResult: AnalysisResult
    result: ScanResult
    path: string
    deletedPaths: Set<string>
    addedToSafeListPaths: Set<string>
    actionFilter: 'all' | 'delete' | 'move'
    setActionFilter: (v: 'all' | 'delete' | 'move') => void
    getActualAction: (path: string, originalAction: 'delete' | 'move') => 'delete' | 'move'
}

export function AiPieChart({
    analysisResult, result, path, deletedPaths, addedToSafeListPaths,
    actionFilter, setActionFilter, getActualAction,
}: AiPieChartProps) {
    const { t } = useTranslation()
    const [hoveredPieIndex, setHoveredPieIndex] = useState<number | null>(null)

    const deleteSuggestions = analysisResult.suggestions.filter((s: CleanupSuggestion) => {
        const actualAction = getActualAction(s.path, s.action)
        return actualAction === 'delete' && !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path)
    })
    const moveSuggestions = analysisResult.suggestions.filter((s: CleanupSuggestion) => {
        const actualAction = getActualAction(s.path, s.action)
        return actualAction === 'move' && !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path)
    })

    const deleteSize = deleteSuggestions.reduce((sum: number, s: CleanupSuggestion) => sum + parseSizeToBytes(s.size), 0)
    const moveSize = moveSuggestions.reduce((sum: number, s: CleanupSuggestion) => sum + parseSizeToBytes(s.size), 0)

    const isVolumeScan = /^[A-Za-z]:[\\/]$/.test(path) || path === '/'
    const baseCapacity = isVolumeScan && result?.volume_total_bytes != null && result.volume_total_bytes > 0
        ? result.volume_total_bytes
        : (result?.total_size || 1)
    const remainSize = Math.max(0, baseCapacity - deleteSize - moveSize)
    const deletePercent = Math.min(100, (deleteSize / baseCapacity) * 100).toFixed(1)
    const movePercent = Math.min(100, (moveSize / baseCapacity) * 100).toFixed(1)
    const remainPercent = Math.min(100, (remainSize / baseCapacity) * 100).toFixed(1)

    const isDarkMode = document.documentElement.classList.contains('dark')

    const colors = {
        delete: '#ef4444',
        move: '#3b82f6',
        keep: isDarkMode ? '#4b5563' : '#e2e8f0',
    }

    const pieData = [
        { name: t('aiAnalysis.delete'), value: deleteSize, count: deleteSuggestions.length, percent: deletePercent, action: 'delete' as const, color: colors.delete },
        { name: t('aiAnalysis.migrate'), value: moveSize, count: moveSuggestions.length, percent: movePercent, action: 'move' as const, color: colors.move },
        { name: t('aiAnalysis.keep'), value: remainSize, count: 0, percent: remainPercent, action: 'keep' as const, color: colors.keep },
    ].filter(d => d.value > 0)

    const springEasing = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    const smoothEasing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'

    return (
        <div className="bg-white dark:bg-gray-800 px-4 py-6 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm dark:shadow-gray-900/20 flex flex-col items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-gray-200 self-start">{t('aiAnalysis.suggestedActions')}</h3>
            <div className="relative w-full" style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={hoveredPieIndex !== null && pieData[hoveredPieIndex]?.action !== 'keep' ? 42 : 45}
                            outerRadius={65}
                            paddingAngle={pieData.length > 1 ? 4 : 0}
                            dataKey="value"
                            cornerRadius={6}
                            onClick={(_, index) => {
                                const clickedAction = pieData[index].action
                                if (clickedAction === 'keep') return
                                if (actionFilter === clickedAction) {
                                    setActionFilter('all')
                                } else {
                                    setActionFilter(clickedAction)
                                }
                            }}
                            onMouseEnter={(_, index) => setHoveredPieIndex(index)}
                            onMouseLeave={() => setHoveredPieIndex(null)}
                            animationBegin={0}
                            animationDuration={800}
                            animationEasing="ease-out"
                        >
                            {pieData.map((entry, index) => {
                                const isHovered = hoveredPieIndex === index
                                const isActive = actionFilter === entry.action
                                const isKeep = entry.action === 'keep'
                                const opacity = isKeep
                                    ? (isDarkMode ? 0.6 : 0.4)
                                    : (actionFilter === 'all' || isActive ? 1 : 0.3)

                                return (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={entry.color}
                                        opacity={opacity}
                                        stroke={isHovered && !isKeep ? (isDarkMode ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.9)') : 'none'}
                                        strokeWidth={isHovered && !isKeep ? 3 : 0}
                                        style={{
                                            outline: 'none',
                                            cursor: isKeep ? 'default' : 'pointer',
                                            filter: isHovered && !isKeep
                                                ? `drop-shadow(0 4px 12px ${entry.color}60)`
                                                : 'none',
                                            transition: `all 0.5s ${springEasing}`,
                                        }}
                                    />
                                )
                            })}
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                        {(() => {
                            const hoveredAction = hoveredPieIndex !== null ? pieData[hoveredPieIndex]?.action : null
                            const activeAction = actionFilter !== 'all' ? actionFilter : null
                            const displayAction = hoveredAction && hoveredAction !== 'keep' ? hoveredAction : activeAction

                            if (displayAction === 'delete') {
                                return (
                                    <>
                                        <div className="text-2xl font-bold" style={{ color: colors.delete, transition: `all 0.3s ${smoothEasing}` }}>{deletePercent}%</div>
                                        <div className="text-xs font-medium" style={{ color: colors.delete, opacity: 0.8, transition: `all 0.3s ${smoothEasing}` }}>{t('aiAnalysis.toDelete')}</div>
                                    </>
                                )
                            } else if (displayAction === 'move') {
                                return (
                                    <>
                                        <div className="text-2xl font-bold" style={{ color: colors.move, transition: `all 0.3s ${smoothEasing}` }}>{movePercent}%</div>
                                        <div className="text-xs font-medium" style={{ color: colors.move, opacity: 0.8, transition: `all 0.3s ${smoothEasing}` }}>{t('aiAnalysis.toMigrate')}</div>
                                    </>
                                )
                            } else {
                                return (
                                    <>
                                        <div className="text-2xl font-bold text-slate-700 dark:text-gray-100" style={{ transition: `all 0.3s ${smoothEasing}` }}>
                                            {(parseFloat(deletePercent) + parseFloat(movePercent)).toFixed(1)}%
                                        </div>
                                        <div className="text-xs text-slate-500 dark:text-gray-400">{t('aiAnalysis.cleanable')}</div>
                                    </>
                                )
                            }
                        })()}
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-2 w-full">
                {pieData.filter(d => d.action !== 'keep').map((item, index) => (
                    <button
                        key={item.action}
                        onClick={() => {
                            if (actionFilter === item.action) {
                                setActionFilter('all')
                            } else {
                                setActionFilter(item.action)
                            }
                        }}
                        onMouseEnter={() => setHoveredPieIndex(index)}
                        onMouseLeave={() => setHoveredPieIndex(null)}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 ${actionFilter === 'all' || actionFilter === item.action
                                ? 'bg-slate-100 dark:bg-gray-700/80 border-transparent'
                                : 'bg-slate-50 dark:bg-gray-800/50 opacity-50 border-transparent'
                            }`}
                        style={{
                            transform: hoveredPieIndex === index ? 'scale(1.03) translateY(-2px)' : 'scale(1) translateY(0)',
                            boxShadow: hoveredPieIndex === index
                                ? `0 8px 24px ${item.color}40, 0 0 0 2px ${item.color}30`
                                : 'none',
                            borderColor: hoveredPieIndex === index ? `${item.color}50` : 'transparent',
                            transition: `all 0.4s ${springEasing}`,
                        }}
                    >
                        <div className="flex items-center gap-2">
                            <div
                                className="w-3 h-3 rounded-full"
                                style={{
                                    backgroundColor: item.color,
                                    transform: hoveredPieIndex === index ? 'scale(1.4)' : 'scale(1)',
                                    boxShadow: hoveredPieIndex === index ? `0 0 8px ${item.color}80` : 'none',
                                    transition: `all 0.4s ${springEasing}`,
                                }}
                            ></div>
                            <span className="text-sm font-medium text-slate-700 dark:text-gray-200">{item.name}</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span
                                className="text-lg font-bold text-slate-700 dark:text-gray-100"
                                style={{
                                    color: hoveredPieIndex === index ? item.color : undefined,
                                    transition: `color 0.3s ${smoothEasing}`,
                                }}
                            >
                                {item.percent}%
                            </span>
                            <span className="text-xs text-slate-500 dark:text-gray-400">
                                {item.count} {t('aiAnalysis.items')} · {formatBytes(item.value)}
                            </span>
                        </div>
                    </button>
                ))}
                {pieData.find(d => d.action === 'keep') && (
                    <div className="flex items-center justify-between px-3 py-2 text-slate-400 dark:text-gray-400">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.keep }}></div>
                            <span className="text-xs">{t('aiAnalysis.keep')}</span>
                        </div>
                        <span className="text-xs">{remainPercent}%</span>
                    </div>
                )}
            </div>
            {actionFilter !== 'all' && (
                <button
                    onClick={() => setActionFilter('all')}
                    className="text-xs text-primary hover:underline mt-1"
                    style={{ transition: `all 0.3s ${smoothEasing}` }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                >
                    {t('aiAnalysis.showAll')}
                </button>
            )}
        </div>
    )
}
