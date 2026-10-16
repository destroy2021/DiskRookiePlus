import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Treemap } from './Treemap'
import type { TreemapNode } from './Treemap'
import { AIPromptPanel } from './AIPromptPanel'
import { formatBytes } from '../utils/format'
import type { ScanResult } from './ExpertMode.types'

interface DeveloperModeContentProps {
    scanResult: ScanResult
}

export function DeveloperModeContent({ scanResult }: DeveloperModeContentProps) {
    const { t } = useTranslation()
    const [hoverNode, setHoverNode] = useState<TreemapNode | null>(null)
    const [viewMode, setViewMode] = useState<'disk' | 'ai-prompt'>('disk')

    const switchViewMode = useCallback((next: 'disk' | 'ai-prompt') => {
        if (viewMode === next) return
        setViewMode(next)
    }, [viewMode])

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-600 overflow-hidden">
            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-100 dark:border-gray-600 shrink-0">
                <div className="bg-slate-200/50 dark:bg-gray-600/50 p-0.5 rounded-lg flex gap-0.5 border border-slate-200/80 dark:border-gray-600">
                    <button onClick={() => switchViewMode('disk')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${viewMode === 'disk' ? 'bg-white dark:bg-gray-600 text-secondary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}>{t('expertMode.diskView')}</button>
                    <button onClick={() => switchViewMode('ai-prompt')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${viewMode === 'ai-prompt' ? 'bg-secondary text-primary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}>{t('expertMode.aiInstructions')}</button>
                </div>
                {hoverNode && viewMode === 'disk' && (
                    <div className="px-3 py-1.5 bg-secondary text-primary rounded-lg text-[11px] font-semibold flex gap-2 items-center">
                        <span className="truncate max-w-[200px] text-white/90">{hoverNode.name}</span>
                        <span className="bg-primary/20 px-1.5 rounded text-[10px] shrink-0">{formatBytes(hoverNode.size)}</span>
                    </div>
                )}
            </div>

            <div className="flex-1 min-h-0 relative">
                {viewMode === 'disk' ? (
                    <div className="absolute inset-0 p-4">
                        <Treemap root={scanResult.root} width={1000} height={500} onHover={setHoverNode} />
                    </div>
                ) : (
                    <div className="absolute inset-0 overflow-auto">
                        <AIPromptPanel result={scanResult} />
                    </div>
                )}
            </div>
        </div>
    )
}
