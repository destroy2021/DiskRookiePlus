import { useTranslation } from 'react-i18next'
import { Save, Shield } from 'lucide-react'
import { Button, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Box, Checkbox, FormControlLabel, TextField } from '@mui/material'
import type { PendingAiSnapshotDecision, SnapshotDecisionAction } from './ExpertMode.types'

interface ExpertModeDialogsProps {
    showAiSnapshotDecisionDialog: boolean
    aiSnapshotDecisionSaving: boolean
    aiSnapshotDecisionRememberForSession: boolean
    pendingAiSnapshotDecision: PendingAiSnapshotDecision | null
    onAiSnapshotDecisionAction: (action: SnapshotDecisionAction) => Promise<void>
    onAiSnapshotDecisionClose: () => void
    onSetAiSnapshotDecisionRememberForSession: (v: boolean) => void
    showSaveDialog: boolean
    snapshotName: string
    onSetSnapshotName: (v: string) => void
    onConfirmSaveSnapshot: () => Promise<void>
    onCloseSaveDialog: () => void
    safeListDialog: { open: boolean; path: string | null; dontRemind: boolean }
    onSetSafeListDialog: (v: { open: boolean; path: string | null; dontRemind: boolean } | ((prev: { open: boolean; path: string | null; dontRemind: boolean }) => { open: boolean; path: string | null; dontRemind: boolean })) => void
    onSafeListConfirm: () => Promise<void>
}

export function ExpertModeDialogs(props: ExpertModeDialogsProps) {
    const { t } = useTranslation()

    return (
        <>
            <Dialog
                open={props.showAiSnapshotDecisionDialog}
                onClose={props.onAiSnapshotDecisionClose}
                maxWidth="xs"
                fullWidth
                PaperProps={{ sx: { borderRadius: '16px' } }}
            >
                <DialogTitle sx={{ pb: 1.5 }}>
                    <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
                        {t('snapshot.aiDecisionTitle')}
                    </Typography>
                </DialogTitle>
                <DialogContent sx={{ pt: '8px !important' }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
                        {t('snapshot.aiDecisionHint')}
                    </Typography>
                    {props.pendingAiSnapshotDecision && (
                        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                            {props.pendingAiSnapshotDecision.defaultAction === 'save'
                                ? t('snapshot.aiDecisionDefaultSave')
                                : t('snapshot.aiDecisionDefaultSkip')}
                        </Typography>
                    )}
                    <FormControlLabel
                        sx={{ mt: 1.5 }}
                        control={
                            <Checkbox
                                checked={props.aiSnapshotDecisionRememberForSession}
                                onChange={(_, checked) => props.onSetAiSnapshotDecisionRememberForSession(checked)}
                                size="small"
                            />
                        }
                        label={t('snapshot.aiDecisionDontShowAgain')}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5, pt: 0.5 }}>
                    <Button
                        onClick={() => void props.onAiSnapshotDecisionAction('skip')}
                        disabled={props.aiSnapshotDecisionSaving}
                        variant={props.pendingAiSnapshotDecision?.defaultAction === 'skip' ? 'contained' : 'text'}
                        sx={{
                            borderRadius: '10px',
                            textTransform: 'none',
                            ...(props.pendingAiSnapshotDecision?.defaultAction === 'skip'
                                ? {
                                    bgcolor: 'grey.300',
                                    color: 'text.primary',
                                    '&:hover': { bgcolor: 'grey.400' },
                                }
                                : {}),
                        }}
                    >
                        {t('snapshot.aiDecisionSkip')}
                    </Button>
                    <Button
                        onClick={() => void props.onAiSnapshotDecisionAction('save')}
                        variant={props.pendingAiSnapshotDecision?.defaultAction === 'save' ? 'contained' : 'outlined'}
                        disabled={props.aiSnapshotDecisionSaving || !props.pendingAiSnapshotDecision?.path.trim()}
                        sx={{
                            borderRadius: '10px',
                            textTransform: 'none',
                            ...(props.pendingAiSnapshotDecision?.defaultAction === 'save'
                                ? {
                                    bgcolor: 'primary.main',
                                    color: '#1A1A1A',
                                    '&:hover': { bgcolor: 'primary.dark', color: '#1A1A1A' },
                                }
                                : {}),
                        }}
                    >
                        {t('snapshot.aiDecisionSave')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={props.showSaveDialog}
                onClose={props.onCloseSaveDialog}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    sx: { borderRadius: '16px' }
                }}
            >
                <DialogTitle sx={{ pb: 2 }}>
                    <Typography variant="h6" component="span" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Save size={20} />
                        {t('snapshot.saveSnapshot')}
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        label={t('snapshot.snapshotName')}
                        value={props.snapshotName}
                        onChange={(e) => props.onSetSnapshotName(e.target.value)}
                        placeholder={t('snapshot.inputSnapshotName')}
                        sx={{
                            mt: 1,
                            '& .MuiOutlinedInput-root': {
                                borderRadius: '12px',
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && props.snapshotName.trim()) {
                                props.onConfirmSaveSnapshot()
                            }
                        }}
                    />
                    <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'text.secondary' }}>
                        {t('snapshot.saveHint2')}
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5 }}>
                    <Button
                        onClick={props.onCloseSaveDialog}
                        sx={{ borderRadius: '10px', textTransform: 'none' }}
                    >
                        {t('common.cancel')}
                    </Button>
                    <Button
                        onClick={props.onConfirmSaveSnapshot}
                        variant="contained"
                        disabled={!props.snapshotName.trim()}
                        sx={{
                            borderRadius: '10px',
                            textTransform: 'none',
                            bgcolor: 'primary.main',
                            color: '#1A1A1A',
                            '&:hover': { bgcolor: 'primary.dark', color: '#1A1A1A' }
                        }}
                    >
                        {t('common.save')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={props.safeListDialog.open}
                onClose={() => props.onSetSafeListDialog({ open: false, path: null, dontRemind: false })}
                maxWidth="sm"
                fullWidth
                PaperProps={{ sx: { borderRadius: '16px' } }}
            >
                <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ width: 36, height: 36, borderRadius: '10px', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Shield size={20} />
                        </Box>
                        <Typography variant="h6" component="span" sx={{ fontSize: '16px', fontWeight: 700 }}>
                            {t('safeList.confirmTitle')}
                        </Typography>
                    </Box>
                </DialogTitle>
                <DialogContent sx={{ px: 3 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                        {t('safeList.confirmMessage')}
                    </Typography>
                    {props.safeListDialog.path && (
                        <Typography variant="caption" component="div" sx={{ color: 'text.secondary', fontFamily: 'monospace', wordBreak: 'break-all', bgcolor: 'action.hover', p: 1.5, borderRadius: 1 }}>
                            {props.safeListDialog.path}
                        </Typography>
                    )}
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={props.safeListDialog.dontRemind}
                                onChange={(_, checked) => props.onSetSafeListDialog(prev => ({ ...prev, dontRemind: checked }))}
                                size="small"
                            />
                        }
                        label={t('safeList.dontRemindAgain')}
                        sx={{ mt: 2 }}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5 }}>
                    <Button onClick={() => props.onSetSafeListDialog({ open: false, path: null, dontRemind: false })} sx={{ borderRadius: '10px', textTransform: 'none' }}>
                        {t('common.cancel')}
                    </Button>
                    <Button onClick={props.onSafeListConfirm} variant="contained" sx={{ borderRadius: '10px', textTransform: 'none' }}>
                        {t('common.confirm')}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    )
}
