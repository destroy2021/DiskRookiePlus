import { useTranslation } from 'react-i18next'
import { Plus, Sparkles, Bot, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material'
import { useState, type MouseEvent } from 'react'
import type { AnalysisSession } from './ExpertMode.types'

interface SessionListPanelProps {
    sessions: AnalysisSession[]
    activeSessionId: string | null
    onSwitchSession: (id: string) => void
    onCreateSession: () => void
    onDeleteSession: (id: string) => void
    collapsed: boolean
    onToggleCollapse: () => void
}

function formatTime(ts: number): string {
    const d = new Date(ts)
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

export function SessionListPanel({
    sessions, activeSessionId, onSwitchSession, onCreateSession, onDeleteSession,
    collapsed, onToggleCollapse,
}: SessionListPanelProps) {
    const { t } = useTranslation()
    const [contextMenu, setContextMenu] = useState<{ id: string; anchorEl: HTMLElement | null } | null>(null)

    if (collapsed) {
        return (
            <div className="w-8 bg-white dark:bg-gray-800 border-r border-slate-200 dark:border-gray-600 flex flex-col items-center py-2 gap-2 shrink-0">
                <button
                    onClick={onToggleCollapse}
                    className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-400 dark:text-gray-500 transition-colors"
                    title={t('session.expandPanel')}
                >
                    <ChevronRight size={14} />
                </button>
                <button
                    onClick={onCreateSession}
                    className="p-1 rounded-md hover:bg-primary/10 text-primary transition-colors"
                    title={t('session.newAnalysis')}
                >
                    <Plus size={14} />
                </button>
            </div>
        )
    }

    return (
        <div className="w-56 bg-white dark:bg-gray-800 border-r border-slate-200 dark:border-gray-600 flex flex-col shrink-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 dark:border-gray-700 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600 dark:text-gray-300">
                    {t('session.title')}
                </span>
                <button
                    onClick={onToggleCollapse}
                    className="p-0.5 rounded-md hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-400 dark:text-gray-500 transition-colors"
                    title={t('session.collapsePanel')}
                >
                    <ChevronLeft size={12} />
                </button>
            </div>

            <button
                onClick={onCreateSession}
                className="mx-2 mt-2 px-2 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-gray-500 text-[11px] font-medium text-slate-500 dark:text-gray-400 hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors flex items-center gap-1.5"
            >
                <Plus size={12} />
                {t('session.newAnalysis')}
            </button>

            <div className="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-0.5">
                {sessions.map(session => (
                    <div
                        key={session.id}
                        onClick={() => onSwitchSession(session.id)}
                        onContextMenu={(e: MouseEvent) => {
                            e.preventDefault()
                            setContextMenu({ id: session.id, anchorEl: e.currentTarget as HTMLElement })
                        }}
                        className={`px-2 py-1.5 rounded-lg cursor-pointer transition-colors group ${
                            session.id === activeSessionId
                                ? 'bg-primary/10 border border-primary/20'
                                : 'hover:bg-slate-50 dark:hover:bg-gray-700/50 border border-transparent'
                        }`}
                    >
                        <div className="flex items-center gap-1.5">
                            {session.source === 'agent' ? (
                                <Bot size={11} className="text-blue-500 shrink-0" />
                            ) : (
                                <Sparkles size={11} className="text-primary shrink-0" />
                            )}
                            <span className={`text-[11px] font-medium truncate ${
                                session.id === activeSessionId
                                    ? 'text-secondary dark:text-primary'
                                    : 'text-slate-600 dark:text-gray-300'
                            }`}>
                                {session.name}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 ml-5">
                            <span className="text-[9px] text-slate-400 dark:text-gray-500">
                                {formatTime(session.createdAt)}
                            </span>
                            {session.status === 'analyzing' && (
                                <span className="text-[9px] text-primary animate-pulse">
                                    {t('session.analyzing')}
                                </span>
                            )}
                            {session.status === 'done' && session.analysisResult && (
                                <span className="text-[9px] text-slate-400 dark:text-gray-500">
                                    {session.analysisResult.suggestions.length}{t('session.suggestionsUnit')}
                                </span>
                            )}
                            {session.status === 'interrupted' && (
                                <span className="text-[9px] text-amber-500">
                                    {t('session.interrupted')}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
                {sessions.length === 0 && (
                    <p className="text-[10px] text-slate-400 dark:text-gray-500 text-center py-4">
                        {t('session.empty')}
                    </p>
                )}
            </div>

            <div className="px-3 py-1.5 border-t border-slate-200 dark:border-gray-700">
                <span className="text-[9px] text-slate-400 dark:text-gray-500">
                    {t('session.total', { count: sessions.length })}
                </span>
            </div>

            <Menu
                open={Boolean(contextMenu)}
                anchorEl={contextMenu?.anchorEl}
                onClose={() => setContextMenu(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{
                    sx: { borderRadius: '10px', minWidth: 140 },
                    className: 'dark:!bg-gray-800',
                }}
            >
                <MenuItem onClick={() => {
                    if (contextMenu) onDeleteSession(contextMenu.id)
                    setContextMenu(null)
                }}>
                    <ListItemIcon><Trash2 size={14} className="text-red-500" /></ListItemIcon>
                    <ListItemText primary={t('session.delete')} primaryTypographyProps={{ fontSize: '12px', color: '#ef4444' }} />
                </MenuItem>
            </Menu>
        </div>
    )
}
