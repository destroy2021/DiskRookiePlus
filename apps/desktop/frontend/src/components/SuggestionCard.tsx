import { useState, useEffect, useRef, useCallback } from 'react'
import { Trash2, MoveRight, File, FolderOpen, Clock, HardDrive, X, Info, Cloud, Settings, Loader2, ArrowLeftRight, Shield, Search } from 'lucide-react'
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, Typography, Box, Chip, Checkbox, FormControlLabel, TextField, CircularProgress, LinearProgress, Snackbar, Alert, Tooltip } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import type { CleanupSuggestion } from '../services/ai-analysis'
import { readStorageFile } from '../services/storage'
import { hasCloudStorageConfig, getDefaultCloudStorageConfig, getEnabledCloudStorageConfigs, CLOUD_STORAGE_PROVIDERS, type CloudStorageConfig } from '../services/settings'
import { CloudStorageSelector } from './CloudStorageSelector'
import type { Task } from '../services/taskQueue'

const SKIP_CONFIRM_KEY = 'skip-action-confirm'

interface Props {
  suggestion: CleanupSuggestion
  onDelete: (path: string, mode: 'trash' | 'permanent') => Promise<void>
  onMove: (path: string, configs?: CloudStorageConfig[], targetPath?: string, fileSize?: number) => Promise<void>
  onOpenCloudSettings?: () => void
  selected?: boolean
  onSelectChange?: (path: string, selected: boolean) => void
  task?: Task
  onToggleAction?: () => void
  originalAction?: 'delete' | 'move'
  onAddToSafeList?: (path: string) => void
  onSelectionDragStart?: (path: string, selected: boolean) => void
  onSelectionDragEnter?: (path: string) => void
  onSelectionDragEnd?: () => void
  onSubDirAnalysis?: (path: string) => void
  deleteMode?: 'permanent' | 'trash'
  onRemove?: (path: string) => void
}

function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const units: Record<string, number> = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024,
  }
  return Math.floor(value * (units[unit] ?? 1))
}

export function SuggestionCard({
  suggestion,
  onDelete,
  onMove,
  onOpenCloudSettings,
  selected = false,
  onSelectChange,
  task,
  onToggleAction,
  originalAction,
  onAddToSafeList,
  onSelectionDragStart,
  onSelectionDragEnter,
  onSelectionDragEnd,
  onSubDirAnalysis,
  deleteMode = 'trash',
  onRemove,
}: Props) {
  const { t } = useTranslation()
  const [showConfirm, setShowConfirm] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [skipConfirm, setSkipConfirm] = useState(false)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [hasCloudConfig, setHasCloudConfig] = useState(false)
  const [cloudConfigName, setCloudConfigName] = useState<string | null>(null)
  const [showNoConfigDialog, setShowNoConfigDialog] = useState(false)
  const [showCloudSelector, setShowCloudSelector] = useState(false)
  const [availableConfigs, setAvailableConfigs] = useState<CloudStorageConfig[]>([])
  const [selectedConfigs, setSelectedConfigs] = useState<CloudStorageConfig[]>([])
  const [cloudTargetPath, setCloudTargetPath] = useState('/备份')
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  useEffect(() => {
    readStorageFile(SKIP_CONFIRM_KEY).then(val => {
      setSkipConfirm(val === 'true')
    })
  }, [])

  useEffect(() => {
    const checkCloudConfig = async () => {
      const config = await hasCloudStorageConfig()
      setHasCloudConfig(config)
      if (config) {
        const defaultConfig = await getDefaultCloudStorageConfig()
        if (defaultConfig) {
          const providerInfo = CLOUD_STORAGE_PROVIDERS.find(p => p.id === defaultConfig.provider)
          setCloudConfigName(defaultConfig.name || providerInfo?.name || defaultConfig.provider)
        }
      }
    }
    checkCloudConfig()
  }, [])

  const handleActionClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (suggestion.action === 'move') {
      const configs = await getEnabledCloudStorageConfigs()
      if (configs.length === 0) {
        setShowNoConfigDialog(true)
        return
      }
      if (configs.length > 1) {
        setAvailableConfigs(configs)
        setShowCloudSelector(true)
        return
      }
      setSelectedConfigs(configs)
    }
    if (skipConfirm) {
      await executeAction()
    } else {
      setShowConfirm(true)
    }
  }

  const executeAction = async (deleteActionMode?: 'trash' | 'permanent') => {
    setLoading(true)
    setError('')
    try {
      if (suggestion.action === 'delete') {
        await onDelete(suggestion.path, deleteActionMode ?? deleteMode)
      } else {
        await onMove(
          suggestion.path,
          selectedConfigs.length > 0 ? selectedConfigs : undefined,
          cloudTargetPath,
          parseSizeToBytes(suggestion.size)
        )
      }
      setShowConfirm(false)
    } catch (err) {
      setToastMessage(String(err))
      setToastOpen(true)
      setShowConfirm(false)
    } finally {
      setLoading(false)
    }
  }

  const handleCloudStorageSelected = (configs: CloudStorageConfig[]) => {
    setSelectedConfigs(configs)
    setShowCloudSelector(false)
    if (skipConfirm) {
      executeAction()
    } else {
      setShowConfirm(true)
    }
  }

  const handleConfirm = async () => {
    if (dontAskAgain) {
      setSkipConfirm(true)
    }
    await executeAction()
  }

  const openSuggestionInFileManager = async () => {
    await invoke('open_in_file_manager', {
      path: suggestion.path,
      isFile: suggestion.type === 'file',
    })
  }

  const handleOpenInFileManager = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await openSuggestionInFileManager()
    } catch (err) {
      setToastMessage(String(err))
      setToastOpen(true)
    }
  }

  const ActionIcon = suggestion.action === 'delete' ? Trash2 : MoveRight
  const TypeIcon = suggestion.type === 'file' ? File : FolderOpen
  const actionColor = suggestion.action === 'delete' ? '#ef4444' : '#3b82f6'
  const actionLabel = suggestion.action === 'delete' ? t('aiAnalysis.delete') : t('aiAnalysis.migrate')
  const isActionSwitched = originalAction !== undefined && originalAction !== suggestion.action

  const isTaskPending = task?.status === 'pending'
  const isTaskUploading = task?.status === 'uploading'
  const isTaskInProgress = isTaskPending || isTaskUploading
  const taskProgress = task?.progress || 0
  const canDragSelect = Boolean(onSelectChange && onSelectionDragStart && onSelectionDragEnter)

  const dragStartRef = useRef<{ x: number; y: number; path: string; wasSelected: boolean } | null>(null)
  const dragConsumedRef = useRef(false)

  const handleCheckboxMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || !canDragSelect) return
    e.stopPropagation()
    dragConsumedRef.current = false
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      path: suggestion.path,
      wasSelected: selected,
    }
    const handleMouseMove = (me: MouseEvent) => {
      const start = dragStartRef.current
      if (!start) return
      const dx = Math.abs(me.clientX - start.x)
      const dy = Math.abs(me.clientY - start.y)
      if (dx > 3 || dy > 3) {
        dragConsumedRef.current = true
        onSelectionDragStart?.(start.path, start.wasSelected)
        dragStartRef.current = null
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
    const handleMouseUp = () => {
      dragStartRef.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [canDragSelect, suggestion.path, selected, onSelectionDragStart])

  const displayPath = suggestion.path

  return (
    <>
      <div
        className={`bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl transition-all hover:border-slate-300 dark:hover:border-gray-600 ${selected ? 'ring-2 ring-primary/30 dark:ring-primary/40' : ''}`}
        style={{ borderLeftWidth: 3, borderLeftColor: actionColor }}
        onMouseEnter={() => { onSelectionDragEnter?.(suggestion.path) }}
        onMouseUp={() => { onSelectionDragEnd?.() }}
      >
        <div className="flex items-start gap-2 p-3">
          {onSelectChange && (
            <Checkbox
              size="small"
              checked={selected}
              onChange={(e) => {
                e.stopPropagation()
                if (dragConsumedRef.current) { dragConsumedRef.current = false; return }
                onSelectChange(suggestion.path, e.target.checked)
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={handleCheckboxMouseDown}
              sx={{
                p: 0.5,
                mt: 0.25,
                color: 'text.secondary',
                '&.Mui-checked': { color: actionColor },
              }}
            />
          )}

          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${actionColor}15` }}
              >
                <TypeIcon size={14} style={{ color: actionColor }} />
              </div>
              <Tooltip title={displayPath} placement="top" arrow>
                <span className="text-sm font-medium text-slate-700 dark:text-gray-200 truncate max-w-[60%]">
                  {displayPath}
                </span>
              </Tooltip>
              <Chip
                label={suggestion.size}
                size="small"
                sx={{
                  height: '18px',
                  fontSize: '10px',
                  fontWeight: 700,
                  bgcolor: 'action.hover',
                  color: 'text.secondary',
                }}
                className="dark:!bg-gray-700 dark:!text-gray-300"
              />
              <div className="flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-gray-500">
                <Clock size={10} />
                <span>{suggestion.updateTime}</span>
              </div>
              {isTaskPending && (
                <Chip
                  label={t('taskQueue.pending')}
                  size="small"
                  icon={<Loader2 size={10} className="animate-spin" />}
                  sx={{ height: '18px', fontSize: '10px', fontWeight: 600, bgcolor: '#fef3c7', color: '#f59e0b' }}
                  className="dark:!bg-amber-900/30 dark:!text-amber-400"
                />
              )}
              {isTaskUploading && (
                <Chip
                  label={t('taskQueue.uploading', { progress: taskProgress })}
                  size="small"
                  icon={<Loader2 size={10} className="animate-spin" />}
                  sx={{ height: '18px', fontSize: '10px', fontWeight: 600, bgcolor: '#dbeafe', color: '#3b82f6' }}
                  className="dark:!bg-blue-900/30 dark:!text-blue-400"
                />
              )}
            </div>

            <div className="flex items-center gap-1 pl-9">
              <span className="text-xs text-slate-500 dark:text-gray-400 flex-1 truncate">
                {suggestion.message}
              </span>
            </div>

            <div className="flex items-center gap-1 pl-9 mt-1 flex-wrap">
              {onToggleAction && originalAction !== undefined && (
                <Button
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onToggleAction() }}
                  disabled={loading || isTaskInProgress}
                  sx={{
                    minWidth: 'auto', px: 1, py: 0.25, fontSize: '10px', textTransform: 'none',
                    color: isActionSwitched ? 'primary.main' : 'text.secondary',
                    border: isActionSwitched ? '1px solid' : 'none',
                    borderColor: isActionSwitched ? 'primary.main' : 'transparent',
                    bgcolor: isActionSwitched ? 'primary.main' : 'transparent',
                    borderRadius: '6px',
                    '&:hover': { bgcolor: isActionSwitched ? 'primary.dark' : 'action.hover', color: isActionSwitched ? 'white' : 'text.secondary' },
                    '&.Mui-disabled': { bgcolor: 'transparent', color: 'text.disabled' }
                  }}
                >
                  <ArrowLeftRight size={11} className="mr-0.5" />
                  {t('suggestion.switch')}
                </Button>
              )}
              <Button
                size="small"
                onClick={handleOpenInFileManager}
                sx={{
                  minWidth: 'auto', px: 1, py: 0.25, fontSize: '10px', textTransform: 'none',
                  color: 'text.secondary', borderRadius: '6px',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
              >
                <FolderOpen size={11} className="mr-0.5" />
                {t('suggestion.openDir')}
              </Button>
              {onAddToSafeList && (
                <Button
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onAddToSafeList(suggestion.path) }}
                  sx={{
                    minWidth: 'auto', px: 1, py: 0.25, fontSize: '10px', textTransform: 'none',
                    color: 'text.secondary', borderRadius: '6px',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                >
                  <Shield size={11} className="mr-0.5" />
                  {t('suggestion.safeList')}
                </Button>
              )}
              {onSubDirAnalysis && suggestion.type === 'directory' && (
                <Button
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onSubDirAnalysis(suggestion.path) }}
                  sx={{
                    minWidth: 'auto', px: 1, py: 0.25, fontSize: '10px', textTransform: 'none',
                    color: 'primary.main', borderRadius: '6px',
                    '&:hover': { bgcolor: 'primary.main', color: '#1A1A1A' }
                  }}
                >
                  <Search size={11} className="mr-0.5" />
                  {t('suggestion.scanSubdir')}
                </Button>
              )}
              <Button
                size="small"
                onClick={(e) => { e.stopPropagation(); setShowDetail(true) }}
                sx={{
                  minWidth: 'auto', px: 1, py: 0.25, fontSize: '10px', textTransform: 'none',
                  color: 'text.secondary', borderRadius: '6px',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
              >
                <Info size={11} className="mr-0.5" />
                {t('suggestion.detail')}
              </Button>
              {onRemove && (
                <Button
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onRemove(suggestion.path) }}
                  sx={{
                    minWidth: 'auto', px: 1, py: 0.25, fontSize: '10px', textTransform: 'none',
                    color: 'text.secondary', borderRadius: '6px',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                >
                  <X size={11} className="mr-0.5" />
                  {t('suggestion.remove')}
                </Button>
              )}
              <Button
                size="small"
                onClick={handleActionClick}
                disabled={loading || isTaskInProgress}
                sx={{
                  minWidth: 'auto', px: 2, py: 0.25, fontSize: '10px', fontWeight: 700,
                  textTransform: 'none', bgcolor: actionColor, color: 'white', borderRadius: '6px',
                  ml: 'auto',
                  '&:hover': { bgcolor: actionColor, filter: 'brightness(0.9)' },
                  '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'text.disabled' }
                }}
              >
                {loading ? '...' : isTaskPending ? t('taskQueue.pending') : isTaskUploading ? `${taskProgress}%` : actionLabel}
              </Button>
            </div>

            {isTaskUploading && taskProgress > 0 && (
              <Box sx={{ pl: 9, mt: 0.5 }}>
                <LinearProgress
                  variant="determinate"
                  value={taskProgress}
                  sx={{
                    height: 3, borderRadius: 2, bgcolor: 'action.hover',
                    '& .MuiLinearProgress-bar': { bgcolor: '#3b82f6' }
                  }}
                />
              </Box>
            )}
          </div>
        </div>
      </div>

      <Dialog open={showConfirm} onClose={() => !loading && setShowConfirm(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: '16px', bgcolor: 'background.paper' }, className: 'dark:!bg-gray-800' }}>
        <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }} className="dark:text-gray-100">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: '10px', bgcolor: `${actionColor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ActionIcon size={20} style={{ color: actionColor }} />
            </Box>
            <Typography variant="h6" component="span" sx={{ fontSize: '16px', fontWeight: 700 }}>
              {suggestion.action === 'delete' ? t('suggestion.confirmDelete') : t('suggestion.confirmMigrate')}
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ py: 2, px: 3 }} className="dark:text-gray-100">
          {loading && suggestion.action === 'move' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 3 }}>
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                <CircularProgress size={60} thickness={4} />
                <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Cloud size={24} className="text-primary" />
                </Box>
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('suggestion.uploadingToCloud')}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                {selectedConfigs.length === 1 ? t('suggestion.uploadTo', { name: selectedConfigs[0].name }) : t('suggestion.uploadToMultiple', { count: selectedConfigs.length })}
              </Typography>
              <LinearProgress sx={{ width: '100%', borderRadius: 2, height: 6, bgcolor: 'action.hover' }} />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2, bgcolor: 'action.hover', borderRadius: '10px' }} className="dark:!bg-gray-700">
                <TypeIcon size={16} className="text-slate-500 dark:text-gray-400 shrink-0" />
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }} className="dark:text-gray-300">
                  {suggestion.path}
                </Typography>
              </Box>
              {suggestion.action === 'delete' && (
                <Typography variant="caption" sx={{ fontSize: '11px', color: 'text.secondary' }}>{t('suggestion.selectDeleteMode')}</Typography>
              )}
              {suggestion.action === 'move' && selectedConfigs.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'start', gap: 1, p: 1.5, bgcolor: 'primary.main', color: '#1A1A1A', borderRadius: '8px' }}>
                    <Cloud size={14} className="shrink-0 mt-0.5" />
                    <Typography variant="caption" sx={{ fontSize: '11px' }}>
                      {t('suggestion.willMigrateTo', { target: selectedConfigs.length === 1 ? selectedConfigs[0].name : t('suggestion.uploadToMultiple', { count: selectedConfigs.length }) })}
                    </Typography>
                  </Box>
                  <TextField
                    fullWidth size="small" label={t('suggestion.cloudTargetPath')} value={cloudTargetPath}
                    onChange={(e) => setCloudTargetPath(e.target.value)} placeholder={t('suggestion.cloudTargetPathExample')}
                    helperText={t('suggestion.cloudTargetPathHint')}
                    sx={{
                      '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '12px', mt: 1 },
                      '& .MuiInputLabel-root': { fontSize: '12px', mt: 1 },
                      '& .MuiFormHelperText-root': { fontSize: '10px', mt: 0.5 }
                    }}
                  />
                </Box>
              )}
              {error && (
                <Box sx={{ display: 'flex', alignItems: 'start', gap: 1, p: 1.5, bgcolor: 'error.main', color: 'white', borderRadius: '8px' }}>
                  <X size={14} className="shrink-0 mt-0.5" />
                  <Typography variant="caption" sx={{ fontSize: '11px' }}>{error}</Typography>
                </Box>
              )}
              <FormControlLabel
                control={<Checkbox size="small" checked={dontAskAgain} onChange={(e) => setDontAskAgain(e.target.checked)} sx={{ p: 0.5, '&.Mui-checked': { color: 'primary.main' } }} />}
                label={<Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px' }} className="dark:text-gray-400">{t('suggestion.dontAskAgain')}</Typography>}
                sx={{ ml: 0, mt: 1 }}
              />
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2, gap: 1 }} className="dark:!border-gray-700">
          <Button onClick={() => setShowConfirm(false)} disabled={loading} variant="outlined" size="small"
            sx={{ textTransform: 'none', borderRadius: '8px', fontSize: '12px', color: 'text.secondary', borderColor: 'divider' }}
            className="dark:!border-gray-600 dark:!text-gray-300">
            {t('common.cancel')}
          </Button>
          {suggestion.action === 'delete' ? (
            <>
              <Button onClick={() => executeAction('trash')} disabled={loading} variant="contained" size="small" startIcon={<Trash2 size={14} />}
                sx={{ textTransform: 'none', borderRadius: '8px', bgcolor: 'primary.main', color: '#1A1A1A', fontSize: '12px', fontWeight: 700, boxShadow: 'none', '&:hover': { bgcolor: 'primary.dark', boxShadow: 'none' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground' } }}>
                {loading ? t('suggestion.processing') : t('aiAnalysis.moveToTrash')}
              </Button>
              <Button onClick={() => executeAction('permanent')} disabled={loading} variant="contained" size="small" startIcon={<Trash2 size={14} />}
                sx={{ textTransform: 'none', borderRadius: '8px', bgcolor: '#ef4444', color: 'white', fontSize: '12px', fontWeight: 700, boxShadow: 'none', '&:hover': { bgcolor: '#dc2626', boxShadow: 'none' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground' } }}>
                {loading ? t('suggestion.processing') : t('aiAnalysis.permanentDelete')}
              </Button>
            </>
          ) : (
            <Button onClick={handleConfirm} disabled={loading} variant="contained" size="small"
              sx={{ textTransform: 'none', borderRadius: '8px', bgcolor: actionColor, color: 'white', fontSize: '12px', fontWeight: 700, boxShadow: 'none', '&:hover': { bgcolor: actionColor, filter: 'brightness(0.9)', boxShadow: 'none' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground' } }}>
              {loading ? t('suggestion.processing') : t('suggestion.confirmMigrate')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={showDetail} onClose={() => setShowDetail(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { borderRadius: '16px', bgcolor: 'background.paper' }, className: 'dark:!bg-gray-800' }}>
        <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }} className="dark:text-gray-100">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: '12px', bgcolor: `${actionColor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ActionIcon size={22} style={{ color: actionColor }} />
            </Box>
            <Box>
              <Typography variant="h6" component="span" sx={{ fontSize: '16px', fontWeight: 700 }}>{t('suggestion.details')}</Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }} className="dark:text-gray-400">
                {suggestion.type === 'file' ? t('common.file') : t('common.directory')}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ py: 2, px: 3 }} className="dark:text-gray-100">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }} className="dark:text-gray-400">
                {t('suggestion.path')}
              </Typography>
              <Tooltip title={t('suggestion.openInFileManager')} placement="top">
                <Box
                  onClick={async () => {
                    try {
                      await openSuggestionInFileManager()
                    } catch (err) {
                      setToastMessage(String(err)); setToastOpen(true)
                    }
                  }}
                  sx={{ mt: 0.75, p: 1.5, bgcolor: 'action.hover', borderRadius: '8px', border: '1px solid', borderColor: 'divider', cursor: 'pointer', '&:hover': { bgcolor: 'action.selected' } }}
                  className="dark:!bg-gray-700/50 dark:!border-gray-600"
                >
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all', lineHeight: 1.5 }} className="dark:text-gray-200">
                    {suggestion.path}
                  </Typography>
                </Box>
              </Tooltip>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: '10px', border: '1px solid', borderColor: 'divider' }} className="dark:!bg-gray-700/50 dark:!border-gray-600">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <HardDrive size={14} className="text-slate-400 dark:text-gray-500" />
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '10px' }} className="dark:text-gray-400">{t('suggestion.size')}</Typography>
                </Box>
                <Typography variant="body1" sx={{ fontWeight: 700, fontSize: '18px' }} className="dark:text-gray-100">{suggestion.size}</Typography>
              </Box>
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: '10px', border: '1px solid', borderColor: 'divider' }} className="dark:!bg-gray-700/50 dark:!border-gray-600">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Clock size={14} className="text-slate-400 dark:text-gray-500" />
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '10px' }} className="dark:text-gray-400">{t('suggestion.modifyTime')}</Typography>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '13px' }} className="dark:text-gray-100">{suggestion.updateTime}</Typography>
              </Box>
            </Box>

            <Box sx={{ p: 2, bgcolor: 'primary.main', borderRadius: '10px' }}>
              <Typography variant="caption" sx={{ color: 'rgba(0,0,0,0.6)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('suggestion.description')}</Typography>
              <Typography variant="body2" sx={{ color: '#1A1A1A', fontSize: '13px', lineHeight: 1.6, mt: 0.5, fontWeight: 500 }}>{suggestion.message}</Typography>
            </Box>

            {suggestion.action === 'move' && (
              hasCloudConfig ? (
                <Box sx={{ display: 'flex', alignItems: 'start', gap: 1.5, p: 2, bgcolor: 'primary.main', color: '#1A1A1A', borderRadius: '10px' }}>
                  <Cloud size={16} className="shrink-0 mt-0.5" />
                  <Box>
                    <Typography variant="body2" sx={{ fontSize: '12px', fontWeight: 600 }}>{t('suggestion.willMigrateTo', { target: cloudConfigName })}</Typography>
                    <Typography variant="caption" sx={{ fontSize: '11px', opacity: 0.8 }}>{t('cloudStorage.fileMigrateHint')}</Typography>
                  </Box>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'start', gap: 1.5, p: 2, bgcolor: 'warning.main', color: '#1A1A1A', borderRadius: '10px' }}>
                  <Settings size={16} className="shrink-0 mt-0.5" />
                  <Box>
                    <Typography variant="body2" sx={{ fontSize: '12px', fontWeight: 600 }}>{t('cloudStorage.noConfig')}</Typography>
                    <Typography variant="caption" sx={{ fontSize: '11px', opacity: 0.8 }}>{t('cloudStorage.needConfigFirst')}</Typography>
                  </Box>
                </Box>
              )
            )}
          </Box>
        </DialogContent>

        <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2, gap: 1 }} className="dark:!border-gray-700">
          <Button onClick={() => setShowDetail(false)} variant="outlined" size="small"
            sx={{ textTransform: 'none', borderRadius: '8px', fontSize: '12px', color: 'text.secondary', borderColor: 'divider' }}
            className="dark:!border-gray-600 dark:!text-gray-300">
            {t('common.close')}
          </Button>
          <Button onClick={handleActionClick} variant="contained" size="small"
            sx={{ textTransform: 'none', borderRadius: '8px', bgcolor: actionColor, color: 'white', fontSize: '12px', fontWeight: 700, boxShadow: 'none', '&:hover': { bgcolor: actionColor, filter: 'brightness(0.9)', boxShadow: 'none' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground' } }}>
            {actionLabel}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showNoConfigDialog} onClose={() => setShowNoConfigDialog(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: '16px', bgcolor: 'background.paper' }, className: 'dark:!bg-gray-800' }}>
        <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }} className="dark:text-gray-100">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: '12px', bgcolor: 'warning.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Cloud size={22} className="text-white" />
            </Box>
            <Typography variant="h6" component="span" sx={{ fontSize: '16px', fontWeight: 700 }}>{t('cloudStorage.configCloud')}</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ py: 2, px: 3 }} className="dark:text-gray-100">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.6 }} className="dark:text-gray-300">{t('cloudStorage.needConfigFirst')}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {['Google Drive', 'OneDrive', 'Dropbox', '阿里云盘', '百度网盘', 'WebDAV'].map(name => (
                <Chip key={name} label={name} size="small" sx={{ fontSize: '11px' }} />
              ))}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'start', gap: 1.5, p: 2, bgcolor: 'info.main', color: 'white', borderRadius: '10px', opacity: 0.9 }}>
              <HardDrive size={16} className="shrink-0 mt-0.5" />
              <Typography variant="body2" sx={{ fontSize: '12px' }}>{t('cloudStorage.nasHint')}</Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2, gap: 1 }} className="dark:!border-gray-700">
          <Button onClick={() => setShowNoConfigDialog(false)} variant="outlined" size="small"
            sx={{ textTransform: 'none', borderRadius: '8px', fontSize: '12px', color: 'text.secondary', borderColor: 'divider' }}
            className="dark:!border-gray-600 dark:!text-gray-300">
            {t('common.later')}
          </Button>
          <Button onClick={() => { setShowNoConfigDialog(false); onOpenCloudSettings?.() }} variant="contained" size="small" startIcon={<Settings size={14} />}
            sx={{ textTransform: 'none', borderRadius: '8px', bgcolor: 'primary.main', color: '#1A1A1A', fontSize: '12px', fontWeight: 700, boxShadow: 'none', '&:hover': { bgcolor: 'primary.dark', boxShadow: 'none' } }}>
            {t('cloudStorage.goConfig')}
          </Button>
        </DialogActions>
      </Dialog>

      <CloudStorageSelector
        open={showCloudSelector}
        onClose={() => setShowCloudSelector(false)}
        onConfirm={handleCloudStorageSelected}
        availableConfigs={availableConfigs}
        fileName={suggestion.path.split('/').pop() || suggestion.path}
        onOpenSettings={onOpenCloudSettings}
      />

      <Snackbar open={toastOpen} autoHideDuration={5000} onClose={() => setToastOpen(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setToastOpen(false)} severity="error" variant="filled" sx={{ width: '100%', borderRadius: '10px' }}>
          {toastMessage}
        </Alert>
      </Snackbar>
    </>
  )
}
