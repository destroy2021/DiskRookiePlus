import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText, Typography } from '@mui/material'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DirEntry } from '../services/ai-analysis'

export interface AskAiResultItem {
    entry: DirEntry
    answer: string
    added: boolean
}

interface AskAiResultDialogProps {
    open: boolean
    loading: boolean
    error: string | null
    results: AskAiResultItem[]
    selectedIndex: number
    sessionName: string
    onSelectIndex: (index: number) => void
    onAddToSession: (index: number) => void
    onClose: () => void
}

export function AskAiResultDialog({
    open,
    loading,
    error,
    results,
    selectedIndex,
    sessionName,
    onSelectIndex,
    onAddToSession,
    onClose,
}: AskAiResultDialogProps) {
    const { t } = useTranslation()
    const current = results[selectedIndex] ?? null

    return (
        <Dialog
            open={open}
            onClose={loading ? undefined : onClose}
            maxWidth="md"
            fullWidth
            slotProps={{ paper: { sx: { borderRadius: '14px', minHeight: 420 } } }}
        >
            <DialogTitle sx={{ fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Sparkles size={16} />
                {t('askAi.title')}
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', gap: 2, minHeight: 320 }}>
                {results.length > 1 && (
                    <List dense sx={{ width: 220, borderRight: '1px solid', borderColor: 'divider', pr: 1, overflowY: 'auto' }}>
                        {results.map((item, index) => (
                            <ListItemButton
                                key={item.entry.path}
                                selected={index === selectedIndex}
                                onClick={() => onSelectIndex(index)}
                                sx={{ borderRadius: '8px', mb: 0.5 }}
                            >
                                <ListItemText
                                    primary={item.entry.name}
                                    secondary={item.added ? t('askAi.added') : item.entry.path}
                                    slotProps={{
                                        primary: { fontSize: 12, fontWeight: 700, noWrap: true },
                                        secondary: { fontSize: 10, noWrap: true },
                                    }}
                                />
                            </ListItemButton>
                        ))}
                    </List>
                )}
                <div className="flex-1 min-w-0 space-y-3">
                    <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 px-3 py-2 space-y-1">
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                            {t('askAi.currentSession')}: {sessionName || t('session.empty')}
                        </Typography>
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', wordBreak: 'break-all' }}>
                            {t('askAi.targetPath')}: {current?.entry.path ?? '-'}
                        </Typography>
                    </div>
                    {loading && (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            {t('askAi.loading')}
                        </Typography>
                    )}
                    {error && (
                        <Typography variant="body2" sx={{ color: 'error.main', whiteSpace: 'pre-wrap' }}>
                            {error}
                        </Typography>
                    )}
                    {!loading && !error && current && (
                        <div className="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 max-h-[260px] overflow-y-auto">
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 13 }}>
                                {current.answer}
                            </Typography>
                        </div>
                    )}
                </div>
            </DialogContent>
            <DialogActions sx={{ px: 2, py: 1.5, gap: 1 }}>
                <Button onClick={onClose} disabled={loading} size="small" sx={{ textTransform: 'none', fontSize: 12 }}>
                    {t('common.close')}
                </Button>
                <Button
                    onClick={() => onAddToSession(selectedIndex)}
                    disabled={loading || !current || current.added}
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
                    {current?.added ? t('askAi.added') : t('askAi.addToCurrentSession')}
                </Button>
            </DialogActions>
        </Dialog>
    )
}
