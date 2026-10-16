import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Square, Trash2, Minus, Square as SquareIcon, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, Typography, IconButton, LinearProgress, Box } from '@mui/material'
import type { AiTask } from './useAiTaskQueue'

interface AiOperationPanelProps {
    open: boolean
    onClose: () => void
    tasks: AiTask[]
    currentTask: AiTask | null
    isRunning: boolean
    isPaused: boolean
    onPause: () => void
    onResume: () => void
    onCancel: () => void
    onClear: () => void
}

function TaskStatusBadge({ task }: { task: AiTask }) {
    const { t } = useTranslation()
    const icons = {
        queued: <Loader2 size={12} className="animate-spin text-slate-400" />,
        running: <Loader2 size={12} className="animate-spin text-primary" />,
        paused: <Minus size={12} className="text-amber-500" />,
        done: <CheckCircle2 size={12} className="text-green-500" />,
        failed: <XCircle size={12} className="text-red-500" />,
    }
    const labels = {
        queued: t('aiOperation.queued'),
        running: t('aiOperation.running'),
        paused: t('aiOperation.paused'),
        done: t('aiOperation.done'),
        failed: t('aiOperation.failed'),
    }
    return (
        <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
            {icons[task.status]} {labels[task.status]}
        </span>
    )
}

export function AiOperationPanel({
    open,
    onClose,
    tasks,
    currentTask,
    isRunning,
    isPaused,
    onPause,
    onResume,
    onCancel,
    onClear,
}: AiOperationPanelProps) {
    const { t } = useTranslation()
    const logEndRef = useRef<HTMLDivElement>(null)
    const [isMinimized, setIsMinimized] = useState(false)

    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [currentTask?.streamLogs])

    const waitingTasks = tasks.filter(t => t.status === 'queued' || t.status === 'paused')
    const doneTasks = tasks.filter(t => t.status === 'done' || t.status === 'failed')

    const canContinue = isRunning || isPaused
    const canRegenerate = currentTask?.status === 'done' || currentTask?.status === 'failed'
    const canClear = tasks.length > 0

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="md"
            fullWidth
            slotProps={{
                paper: {
                    sx: {
                        borderRadius: '12px',
                        minHeight: isMinimized ? 48 : 480,
                        transition: 'min-height 0.2s ease',
                    }
                }
            }}
        >
            <DialogTitle sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 14,
                fontWeight: 700,
                pb: 1
            }}>
                <span>{t('aiOperation.title')}</span>
                <div className="flex items-center gap-1">
                    <IconButton size="small" onClick={() => setIsMinimized(v => !v)} sx={{ color: 'text.secondary' }}>
                        {isMinimized ? <SquareIcon size={14} /> : <Minus size={14} />}
                    </IconButton>
                    <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
                        <XCircle size={14} />
                    </IconButton>
                </div>
            </DialogTitle>

            {!isMinimized && (
                <>
                    <DialogContent sx={{ pt: 0, display: 'flex', flexDirection: 'column', gap: 2, minHeight: 320 }}>
                        {currentTask && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                            {t('aiOperation.currentTask')}:
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                            {currentTask.paths.join(', ')}
                                        </Typography>
                                    </div>
                                    <TaskStatusBadge task={currentTask} />
                                </div>
                                {currentTask.status === 'running' && (
                                    <LinearProgress
                                        variant="indeterminate"
                                        sx={{ height: 4, borderRadius: 2 }}
                                    />
                                )}
                            </Box>
                        )}

                        {waitingTasks.length > 0 && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                                    {t('aiOperation.waitingQueue')} ({waitingTasks.length}):
                                </Typography>
                                {waitingTasks.map(task => (
                                    <div key={task.id} className="flex items-center gap-2 px-2 py-1 rounded bg-slate-50 dark:bg-gray-700/30">
                                        <Typography variant="caption" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {task.paths.join(', ')}
                                        </Typography>
                                        <TaskStatusBadge task={task} />
                                    </div>
                                ))}
                            </Box>
                        )}

                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                                {t('aiOperation.realTimeOutput')}:
                            </Typography>
                            <Box
                                sx={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    bgcolor: 'grey.900',
                                    borderRadius: 1,
                                    p: 1.5,
                                    minHeight: 120,
                                    maxHeight: 180,
                                    fontFamily: 'monospace',
                                    fontSize: 11,
                                }}
                            >
                                {(currentTask?.streamLogs ?? []).map((log, i) => (
                                    <Typography
                                        key={i}
                                        component="pre"
                                        sx={{
                                            color: 'grey.300',
                                            fontSize: 11,
                                            fontFamily: 'monospace',
                                            m: 0,
                                            mb: 0.5,
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-all',
                                        }}
                                    >
                                        {log}
                                    </Typography>
                                ))}
                                <div ref={logEndRef} />
                            </Box>
                        </Box>

                        {doneTasks.length > 0 && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                                    {t('aiOperation.completed')} ({doneTasks.length}):
                                </Typography>
                                {doneTasks.slice(0, 5).map(task => (
                                    <div key={task.id} className="flex items-center gap-2 px-2 py-1 rounded bg-slate-50 dark:bg-gray-700/30">
                                        <Typography variant="caption" sx={{ flex: 1 }}>
                                            {task.paths.join(', ')}
                                        </Typography>
                                        <TaskStatusBadge task={task} />
                                    </div>
                                ))}
                                {doneTasks.length > 5 && (
                                    <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                                        +{doneTasks.length - 5} {t('aiOperation.more')}
                                    </Typography>
                                )}
                            </Box>
                        )}
                    </DialogContent>

                    <DialogActions sx={{ px: 2, pb: 1.5, gap: 1 }}>
                        {canContinue ? (
                            <>
                                {isPaused ? (
                                    <Button
                                        onClick={onResume}
                                        variant="contained"
                                        size="small"
                                        startIcon={<Play size={14} />}
                                        sx={{ borderRadius: '8px', textTransform: 'none', fontSize: 12 }}
                                    >
                                        {t('aiOperation.resume')}
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={onPause}
                                        variant="outlined"
                                        size="small"
                                        startIcon={<Square size={14} />}
                                        sx={{ borderRadius: '8px', textTransform: 'none', fontSize: 12 }}
                                    >
                                        {t('aiOperation.pause')}
                                    </Button>
                                )}
                                <Button
                                    onClick={onCancel}
                                    variant="outlined"
                                    size="small"
                                    color="error"
                                    startIcon={<Square size={14} />}
                                    sx={{ borderRadius: '8px', textTransform: 'none', fontSize: 12 }}
                                >
                                    {t('aiOperation.stop')}
                                </Button>
                            </>
                        ) : canRegenerate ? (
                            <Button
                                onClick={onClear}
                                variant="outlined"
                                size="small"
                                startIcon={<Trash2 size={14} />}
                                sx={{ borderRadius: '8px', textTransform: 'none', fontSize: 12 }}
                            >
                                {t('aiOperation.clear')}
                            </Button>
                        ) : null}
                        {canClear && (
                            <Button
                                onClick={onClear}
                                variant="text"
                                size="small"
                                startIcon={<Trash2 size={14} />}
                                sx={{ borderRadius: '8px', textTransform: 'none', fontSize: 12, color: 'text.secondary' }}
                            >
                                {t('aiOperation.clearAll')}
                            </Button>
                        )}
                    </DialogActions>
                </>
            )}
        </Dialog>
    )
}