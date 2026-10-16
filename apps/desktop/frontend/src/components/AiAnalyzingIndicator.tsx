import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { Typography } from '@mui/material'

interface AiAnalyzingIndicatorProps {
    aiProgress: string
}

export function AiAnalyzingIndicator({ aiProgress }: AiAnalyzingIndicatorProps) {
    const { t } = useTranslation()

    return (
        <div className="px-4 py-2 rounded-xl border border-primary/30 bg-primary/5 dark:bg-primary/10 dark:border-primary/40 flex items-center gap-2">
            <Sparkles className="text-primary animate-pulse" size={16} />
            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600 }}>
                {aiProgress || t('aiAnalysis.analyzing')}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('aiAnalysis.backgroundRunning')}
            </Typography>
        </div>
    )
}
