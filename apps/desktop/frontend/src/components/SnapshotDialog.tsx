import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { showNotification } from '../services/notification'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  Tooltip,
  InputAdornment,
  CircularProgress,
  Button,
} from '@mui/material'
import {
  X,
  Search,
  Trash2,
  FolderOpen,
  Clock,
  HardDrive,
  FileStack,
  Save,
  Pencil,
  Archive,
  Sparkles,
} from 'lucide-react'
import {
  loadSnapshots,
  deleteSnapshot,
  clearSnapshots,
  getSnapshot,
  updateSnapshotName,
  type Snapshot,
  type SnapshotMetadata,
} from '../services/snapshot'
import { formatBytes } from '../utils/format'

interface Props {
  open: boolean
  onClose: () => void
  onLoadSnapshot: (snapshot: Snapshot) => void
  /** 当前存在扫描结果时提供「保存当前扫描」入口 */
  onSaveCurrent?: () => void
  canSaveCurrent?: boolean
}

export function SnapshotDialog({ open, onClose, onLoadSnapshot, onSaveCurrent, canSaveCurrent }: Props) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [renameTarget, setRenameTarget] = useState<SnapshotMetadata | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  const refresh = async () => {
    setSnapshots(await loadSnapshots())
  }

  // 加载快照列表
  useEffect(() => {
    if (open) {
      setLoading(true)
      loadSnapshots().then(data => {
        setSnapshots(data)
        setLoading(false)
      })
    }
  }, [open])

  const filteredSnapshots = useMemo(() => {
    if (!searchQuery.trim()) return snapshots
    const query = searchQuery.toLowerCase()
    return snapshots.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.path.toLowerCase().includes(query)
    )
  }, [snapshots, searchQuery])

  const handleDelete = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (!confirm(t('snapshot.confirmDelete'))) return
    setBusy(true)
    try {
      await deleteSnapshot(id)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleLoad = async (metadata: SnapshotMetadata) => {
    setLoading(true)
    try {
      const snapshot = await getSnapshot(metadata.id)
      if (snapshot) {
        onLoadSnapshot(snapshot)
        onClose()
      } else {
        showNotification(t('snapshot.loadFailed'), t('snapshot.dataNotExist'))
      }
    } catch (error) {
      showNotification(t('snapshot.loadFailed'), String(error))
    } finally {
      setLoading(false)
    }
  }

  const openRename = (snapshot: SnapshotMetadata, event: React.MouseEvent) => {
    event.stopPropagation()
    setRenameTarget(snapshot)
    setRenameValue(snapshot.name)
  }

  const handleRenameConfirm = async () => {
    if (!renameTarget || !renameValue.trim()) return
    setBusy(true)
    try {
      await updateSnapshotName(renameTarget.id, renameValue.trim())
      setRenameTarget(null)
      await refresh()
    } catch (error) {
      showNotification(t('snapshot.renameFailed'), String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleClearAll = async () => {
    setClearConfirmOpen(false)
    setBusy(true)
    try {
      await clearSnapshots()
      await refresh()
      showNotification(t('snapshot.clearSuccess'), t('snapshot.clearedAll'))
    } catch (error) {
      showNotification(t('snapshot.clearFailed'), String(error))
    } finally {
      setBusy(false)
    }
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const diff = Date.now() - date.getTime()

    if (diff < 60000) return t('snapshot.justNow')
    if (diff < 3600000) return t('snapshot.minutesAgo', { count: Math.floor(diff / 60000) })
    if (diff < 86400000) return t('snapshot.hoursAgo', { count: Math.floor(diff / 3600000) })
    if (diff < 604800000) return t('snapshot.daysAgo', { count: Math.floor(diff / 86400000) })

    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '20px',
            maxHeight: '80vh',
          }
        }}
      >
        <DialogTitle sx={{ pb: 2, pt: 3, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '12px',
                  bgcolor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FolderOpen size={20} style={{ color: '#1A1A1A' }} />
              </Box>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '18px' }}>
                  {t('snapshot.management')}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('snapshot.totalCount', { count: snapshots.length })}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {onSaveCurrent && (
                <Tooltip title={canSaveCurrent ? t('snapshot.saveSnapshot') : t('snapshot.saveNeedsScan')} arrow>
                  <span>
                    <IconButton
                      size="small"
                      disabled={!canSaveCurrent || busy}
                      onClick={() => {
                        onClose()
                        onSaveCurrent()
                      }}
                      sx={{ color: 'primary.main' }}
                    >
                      <Save size={18} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <Tooltip title={t('snapshot.clearAll')} arrow>
                <span>
                  <IconButton
                    size="small"
                    disabled={snapshots.length === 0 || busy}
                    onClick={() => setClearConfirmOpen(true)}
                    sx={{ color: 'warning.main' }}
                  >
                    <Archive size={18} />
                  </IconButton>
                </span>
              </Tooltip>
              <IconButton
                onClick={onClose}
                size="small"
                sx={{
                  color: 'text.secondary',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
              >
                <X size={20} />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ px: 3, pb: 3 }}>
          <TextField
            fullWidth
            size="small"
            placeholder={t('snapshot.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{
              mb: 2,
              '& .MuiOutlinedInput-root': {
                borderRadius: '12px',
                bgcolor: 'background.paper',
              }
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={18} />
                </InputAdornment>
              ),
            }}
          />

          {loading ? (
            <Box
              sx={{
                py: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
              }}
            >
              <CircularProgress size={48} sx={{ mb: 2 }} />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {t('snapshot.loading')}
              </Typography>
            </Box>
          ) : filteredSnapshots.length === 0 ? (
            <Box
              sx={{
                py: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
              }}
            >
              <FolderOpen size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {searchQuery ? t('snapshot.noMatch') : t('snapshot.noSnapshots')}
              </Typography>
              <Typography variant="caption" sx={{ mt: 0.5 }}>
                {!searchQuery && t('snapshot.hint')}
              </Typography>
            </Box>
          ) : (
            <List sx={{ p: 0 }}>
              {filteredSnapshots.map((snapshot, index) => (
                <ListItem
                  key={snapshot.id}
                  disablePadding
                  sx={{
                    mb: index < filteredSnapshots.length - 1 ? 1 : 0,
                  }}
                  secondaryAction={
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Tooltip title={t('snapshot.rename')} arrow>
                        <IconButton
                          edge="end"
                          onClick={(e) => openRename(snapshot, e)}
                          size="small"
                          sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                        >
                          <Pencil size={15} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('snapshot.delete')} arrow>
                        <IconButton
                          edge="end"
                          onClick={(e) => handleDelete(snapshot.id, e)}
                          size="small"
                          sx={{
                            color: 'error.main',
                            '&:hover': {
                              bgcolor: 'error.main',
                              color: 'white',
                            }
                          }}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  }
                >
                  <ListItemButton
                    onClick={() => handleLoad(snapshot)}
                    sx={{
                      borderRadius: '12px',
                      border: '1px solid',
                      borderColor: 'divider',
                      px: 2,
                      py: 1.5,
                      '&:hover': {
                        bgcolor: 'action.hover',
                        borderColor: 'primary.main',
                      }
                    }}
                  >
                    <ListItemText
                      primary={
                        <Typography
                          variant="subtitle2"
                          sx={{
                            fontWeight: 600,
                            mb: 0.5,
                            pr: 8,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                          }}
                        >
                          {snapshot.name}
                          {snapshot.has_ai && (
                            <Tooltip title={t('snapshot.hasAI')} arrow>
                              <span style={{ display: 'inline-flex' }}>
                                <Sparkles size={12} color="#E8B900" />
                              </span>
                            </Tooltip>
                          )}
                        </Typography>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              color: 'text.secondary',
                            }}
                          >
                            <FolderOpen size={12} />
                            {snapshot.path}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                color: 'text.secondary',
                              }}
                            >
                              <Clock size={12} />
                              {formatDate(snapshot.timestamp)}
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                color: 'text.secondary',
                              }}
                            >
                              <HardDrive size={12} />
                              {formatBytes(snapshot.total_size)}
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                color: 'text.secondary',
                              }}
                            >
                              <FileStack size={12} />
                              {t('snapshot.fileCount', { count: snapshot.file_count })}
                            </Typography>
                            {snapshot.size_bytes ? (
                              <Typography
                                variant="caption"
                                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}
                              >
                                {t('snapshot.diskUsage', { size: formatBytes(snapshot.size_bytes) })}
                              </Typography>
                            ) : null}
                          </Box>
                        </Box>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px' } }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px', pb: 1 }}>
          {t('snapshot.rename')}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleRenameConfirm()
            }}
            sx={{ mt: 1, '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRenameTarget(null)} sx={{ textTransform: 'none' }}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={!renameValue.trim() || busy}
            onClick={() => void handleRenameConfirm()}
            sx={{ textTransform: 'none', borderRadius: '10px' }}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 清空确认对话框 */}
      <Dialog
        open={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px' } }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px', pb: 1 }}>
          {t('snapshot.clearAll')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('snapshot.confirmClearAll')}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setClearConfirmOpen(false)} sx={{ textTransform: 'none' }}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => void handleClearAll()}
            sx={{ textTransform: 'none', borderRadius: '10px' }}
          >
            {t('snapshot.clearAll')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
