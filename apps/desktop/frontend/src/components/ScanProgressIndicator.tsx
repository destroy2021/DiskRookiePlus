import { useTranslation } from 'react-i18next'
import { Cpu } from 'lucide-react'
import { Typography } from '@mui/material'

interface ScanProgressIndicatorProps {
    progressFiles: number
    scanCanceling: boolean
}

export function ScanProgressIndicator({ progressFiles, scanCanceling }: ScanProgressIndicatorProps) {
    const { t } = useTranslation()

    return (
        <div className="p-10 flex flex-col items-center justify-center gap-4 animate-in zoom-in-95 duration-500">
            <div className="relative">
                <Cpu className="text-primary animate-pulse" size={48} />
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
            </div>
            <div className="text-center">
                <Typography variant="h4" sx={{ fontWeight: 900, color: 'secondary.main' }}>{progressFiles.toLocaleString()}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 2 }}>{t('expertMode.processedFiles')}</Typography>
                {scanCanceling && (
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'warning.main', fontWeight: 600 }}>
                        {t('expertMode.stoppingScanHint')}
                    </Typography>
                )}
            </div>
            <div className="flex gap-1 h-2">
                {Array.from({ length: 12 }).map((_, i) => (
                    <div
                        key={i}
                        className="w-4 h-full bg-primary rounded-sm animate-pulse"
                        style={{ animationDelay: `${i * 0.1}s`, animationDuration: '1.2s' }}
                    />
                ))}
            </div>
        </div>
    )
}
