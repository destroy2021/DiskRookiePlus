import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Copy, CheckCircle2 } from 'lucide-react'
import { Button, TextField, Typography, Box, Slider, FormHelperText } from '@mui/material'
import { loadAppSettings, saveAppSettings } from '../services/settings'
import { buildFileListSummary, loadPromptInstruction, savePromptInstruction, DEFAULT_PROMPT_INSTRUCTION } from './ExpertMode.utils'
import type { ScanResult } from './ExpertMode.types'

const PROMPT_FILE_COUNT_MIN = 20
const PROMPT_FILE_COUNT_MAX = 2000

export function AIPromptPanel({ result }: { result: ScanResult }) {
    const { t } = useTranslation()
    const [fileListSummary, setFileListSummary] = useState('')
    const [instruction, setInstruction] = useState(DEFAULT_PROMPT_INSTRUCTION)
    const [copied, setCopied] = useState(false)
    const [fileCount, setFileCount] = useState(100)
    const summaryDepsKey = `${result.scan_time_ms}|${result.file_count}|${result.total_size}|${result.root.path || result.root.name}|${result.top_files?.length ?? 0}|${result.top_directories?.length ?? 0}|${result.root_children?.length ?? 0}|${result.extension_stats?.length ?? 0}|${fileCount}`

    useEffect(() => {
        let cancelled = false
        loadAppSettings().then(s => {
            if (!cancelled) {
                const count = Math.min(PROMPT_FILE_COUNT_MAX, Math.max(PROMPT_FILE_COUNT_MIN, s.promptFileCount))
                setFileCount(count)
            }
        })
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        if (fileCount >= PROMPT_FILE_COUNT_MIN && fileCount <= PROMPT_FILE_COUNT_MAX) {
            loadAppSettings().then(s => void saveAppSettings({ ...s, promptFileCount: fileCount }))
        }
    }, [fileCount])

    useEffect(() => {
        let cancelled = false
        buildFileListSummary(result, fileCount).then(summary => {
            if (!cancelled) {
                setFileListSummary(summary)
            }
        })
        return () => {
            cancelled = true
        }
    }, [summaryDepsKey, fileCount, result])

    useEffect(() => {
        loadPromptInstruction().then(setInstruction)
    }, [])

    useEffect(() => {
        void savePromptInstruction(instruction)
    }, [instruction])

    const copy = useCallback(() => {
        const fullPrompt = fileListSummary + '\n' + instruction
        void navigator.clipboard.writeText(fullPrompt).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }, [fileListSummary, instruction])

    return (
        <div className="flex flex-col p-6 gap-6 bg-white dark:bg-gray-800 rounded-3xl h-full animate-in fade-in duration-500">
            <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                            <MessageSquare size={20} />
                        </div>
                        <div>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: 'secondary.main' }}>{t('aiAnalysis.suggestionGeneration')}</Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('aiAnalysis.dataReady')}</Typography>
                        </div>
                    </div>
                    <Button
                        onClick={copy}
                        variant="contained"
                        size="small"
                        startIcon={copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                        sx={{
                            borderRadius: '10px',
                            px: 3,
                            py: 0.9,
                            textTransform: 'none',
                            bgcolor: copied ? '#4caf50' : 'primary.main',
                            color: '#1A1A1A',
                            fontWeight: 700,
                            fontSize: '12px',
                            boxShadow: 'none',
                            '&:hover': {
                                bgcolor: copied ? '#45a049' : 'primary.dark',
                                color: '#1A1A1A',
                            }
                        }}
                    >
                        {copied ? t('common.copied') : t('common.copyAll')}
                    </Button>
                </div>
                <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover', borderRadius: '12px', border: '1px solid', borderColor: 'divider' }} className="dark:!bg-gray-700/30 dark:!border-gray-600">
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {t('aiAnalysis.tableRows')}
                        </Typography>
                        <TextField
                            size="small"
                            value={fileCount}
                            onChange={(e) => {
                                const raw = e.target.value.replace(/\D/g, '')
                                if (raw === '') {
                                    setFileCount(PROMPT_FILE_COUNT_MIN)
                                    return
                                }
                                const v = parseInt(raw, 10)
                                if (!isNaN(v)) {
                                    const clamped = Math.min(PROMPT_FILE_COUNT_MAX, Math.max(PROMPT_FILE_COUNT_MIN, v))
                                    setFileCount(clamped)
                                }
                            }}
                            inputProps={{
                                inputMode: 'numeric',
                                style: { textAlign: 'right', fontSize: '12px', fontWeight: 700, width: 56 },
                            }}
                            sx={{
                                '& .MuiInputBase-root': { fontSize: '12px' },
                                '& input': { py: 0.5, fontVariantNumeric: 'tabular-nums' },
                            }}
                        />
                    </Box>
                    <Slider
                        min={PROMPT_FILE_COUNT_MIN}
                        max={PROMPT_FILE_COUNT_MAX}
                        step={10}
                        value={Math.min(PROMPT_FILE_COUNT_MAX, Math.max(PROMPT_FILE_COUNT_MIN, fileCount))}
                        onChange={(_, value) => setFileCount(value as number)}
                        sx={{
                            color: 'primary.main',
                            height: 4,
                            '& .MuiSlider-thumb': {
                                width: 14,
                                height: 14,
                            },
                            '& .MuiSlider-track': {
                                height: 4,
                            },
                            '& .MuiSlider-rail': {
                                height: 4,
                            },
                        }}
                        marks={[
                            { value: PROMPT_FILE_COUNT_MIN, label: '20' },
                            { value: 500, label: '500' },
                            { value: 1000, label: '1000' },
                            { value: PROMPT_FILE_COUNT_MAX, label: '2000' },
                        ]}
                    />
                    <FormHelperText sx={{ fontSize: '10px', m: 0, mt: 0.5, color: 'text.secondary' }}>
                        {t('aiAnalysis.controlTableRows', { count: result.file_count })}
                    </FormHelperText>
                </Box>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-400 dark:text-gray-400 uppercase tracking-widest ml-1">{t('aiAnalysis.diskUsageSummary')}</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-gray-700/50 rounded-2xl p-4 border border-slate-100 dark:border-gray-600 flex-1 overflow-y-auto min-h-0 thin-scrollbar" style={{ maxHeight: '100%' }}>
                        <pre className="text-xs text-slate-600 dark:text-gray-300 font-mono leading-relaxed whitespace-pre-wrap">{fileListSummary}</pre>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-gray-400 uppercase tracking-widest ml-1">{t('aiAnalysis.customPrompt')}</span>
                    <TextField
                        multiline fullWidth value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder={t('aiAnalysis.inputPrompt')}
                        sx={{
                            flex: 1,
                            '& .MuiInputBase-root': {
                                height: '100%',
                                borderRadius: '20px',
                                bgcolor: 'background.paper',
                                fontSize: '14px',
                                '& fieldset': {
                                    borderColor: 'divider',
                                },
                                '&:hover fieldset': {
                                    borderColor: 'primary.main',
                                },
                                '&.Mui-focused fieldset': {
                                    borderColor: 'primary.main',
                                },
                            },
                            '& textarea': {
                                height: '100% !important',
                                color: 'text.primary',
                            },
                            '& .MuiInputBase-input::placeholder': {
                                color: 'text.secondary',
                                opacity: 0.6,
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    )
}
