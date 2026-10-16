import { useState, useCallback, useMemo } from 'react'
import type { AnalysisSession, AgentToolCallLog } from './ExpertMode.types'
import type { AnalysisResult, CleanupSuggestion } from '../services/ai-analysis'

function generateSessionId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function formatSessionDate(ts: number): string {
    const d = new Date(ts)
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function buildSessionName(scanPath: string, ts: number): string {
    const dirName = scanPath.split(/[/\\]/).filter(Boolean).pop() || scanPath
    return `${dirName} ${formatSessionDate(ts)}`
}

function computeStats(analysisResult: AnalysisResult | null, actionOverrides: Map<string, 'delete' | 'move'>): { totalSuggestions: number; deleteCount: number; moveCount: number; totalSize: string } {
    if (!analysisResult) return { totalSuggestions: 0, deleteCount: 0, moveCount: 0, totalSize: '0 B' }
    const suggestions = analysisResult.suggestions
    let deleteCount = 0
    let moveCount = 0
    for (const s of suggestions) {
        const action = actionOverrides.get(s.path) ?? s.action
        if (action === 'delete') deleteCount++
        else moveCount++
    }
    return { totalSuggestions: suggestions.length, deleteCount, moveCount, totalSize: '' }
}

export interface UseAnalysisSessionsReturn {
    sessions: AnalysisSession[]
    activeSessionId: string | null
    activeSession: AnalysisSession | null
    createSession: (scanPath: string, source?: 'manual' | 'agent') => AnalysisSession
    switchSession: (id: string) => void
    updateSession: (id: string, patch: Partial<AnalysisSession>) => void
    deleteSession: (id: string) => void
    setSessionAnalysisResult: (id: string, result: AnalysisResult) => void
    addSuggestionToSession: (id: string, suggestion: CleanupSuggestion) => void
    removeSuggestionFromSession: (id: string, path: string) => void
    markPathDeleted: (id: string, path: string) => void
    markPathSafeListed: (id: string, path: string) => void
    setSessionActionOverride: (id: string, path: string, action: 'delete' | 'move') => void
    appendAgentLog: (id: string, log: AgentToolCallLog) => void
    getSessionsForSnapshot: () => AnalysisSession[]
    loadSessionsFromSnapshot: (sessions: AnalysisSession[], legacyResult?: AnalysisResult | null, legacyRawText?: string, legacyPrompt?: string, scanPath?: string) => void
    clearSessions: () => void
}

export function useAnalysisSessions(): UseAnalysisSessionsReturn {
    const [sessions, setSessions] = useState<AnalysisSession[]>([])
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

    const activeSession = useMemo(
        () => sessions.find(s => s.id === activeSessionId) ?? null,
        [sessions, activeSessionId]
    )

    const createSession = useCallback((scanPath: string, source: 'manual' | 'agent' = 'manual'): AnalysisSession => {
        const now = Date.now()
        const session: AnalysisSession = {
            id: generateSessionId(),
            name: buildSessionName(scanPath, now),
            scanPath,
            createdAt: now,
            source,
            status: 'analyzing',
            analysisResult: null,
            latestAiRawText: '',
            latestAiPrompt: '',
            agentLogs: [],
            deletedPaths: [],
            addedToSafeListPaths: [],
            actionOverrides: [],
            totalSuggestions: 0,
            deleteCount: 0,
            moveCount: 0,
            totalSize: '0 B',
        }
        setSessions(prev => [session, ...prev])
        setActiveSessionId(session.id)
        return session
    }, [])

    const switchSession = useCallback((id: string) => {
        setActiveSessionId(id)
    }, [])

    const updateSession = useCallback((id: string, patch: Partial<AnalysisSession>) => {
        setSessions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
    }, [])

    const setSessionAnalysisResult = useCallback((id: string, result: AnalysisResult) => {
        setSessions(prev => prev.map(s => {
            if (s.id !== id) return s
            const actionOverrides = new Map(s.actionOverrides)
            const stats = computeStats(result, actionOverrides)
            return { ...s, analysisResult: result, status: 'done' as const, ...stats }
        }))
    }, [])

    const addSuggestionToSession = useCallback((id: string, suggestion: CleanupSuggestion) => {
        setSessions(prev => prev.map(s => {
            if (s.id !== id || !s.analysisResult) return s
            const newResult = { ...s.analysisResult, suggestions: [...s.analysisResult.suggestions, suggestion] }
            const actionOverrides = new Map(s.actionOverrides)
            const stats = computeStats(newResult, actionOverrides)
            return { ...s, analysisResult: newResult, ...stats }
        }))
    }, [])

    const removeSuggestionFromSession = useCallback((id: string, path: string) => {
        setSessions(prev => prev.map(s => {
            if (s.id !== id || !s.analysisResult) return s
            const newResult = { ...s.analysisResult, suggestions: s.analysisResult.suggestions.filter(sg => sg.path !== path) }
            const actionOverrides = new Map(s.actionOverrides)
            const stats = computeStats(newResult, actionOverrides)
            return { ...s, analysisResult: newResult, ...stats }
        }))
    }, [])

    const markPathDeleted = useCallback((id: string, path: string) => {
        setSessions(prev => prev.map(s => {
            if (s.id !== id) return s
            return { ...s, deletedPaths: [...s.deletedPaths, path] }
        }))
    }, [])

    const markPathSafeListed = useCallback((id: string, path: string) => {
        setSessions(prev => prev.map(s => {
            if (s.id !== id) return s
            return { ...s, addedToSafeListPaths: [...s.addedToSafeListPaths, path] }
        }))
    }, [])

    const setSessionActionOverride = useCallback((id: string, path: string, action: 'delete' | 'move') => {
        setSessions(prev => prev.map(s => {
            if (s.id !== id) return s
            const map = new Map(s.actionOverrides)
            map.set(path, action)
            const stats = s.analysisResult ? computeStats(s.analysisResult, map) : { totalSuggestions: 0, deleteCount: 0, moveCount: 0, totalSize: '0 B' }
            return { ...s, actionOverrides: Array.from(map.entries()), ...stats }
        }))
    }, [])

    const appendAgentLog = useCallback((id: string, log: AgentToolCallLog) => {
        setSessions(prev => prev.map(s => {
            if (s.id !== id) return s
            return { ...s, agentLogs: [...s.agentLogs, log] }
        }))
    }, [])

    const getSessionsForSnapshot = useCallback((): AnalysisSession[] => {
        return sessions
    }, [sessions])

    const loadSessionsFromSnapshot = useCallback((loadedSessions: AnalysisSession[], legacyResult?: AnalysisResult | null, legacyRawText?: string, legacyPrompt?: string, scanPath?: string) => {
        if (loadedSessions.length > 0) {
            setSessions(loadedSessions)
            setActiveSessionId(loadedSessions[0]?.id ?? null)
        } else if (legacyResult) {
            const now = Date.now()
            const session: AnalysisSession = {
                id: generateSessionId(),
                name: buildSessionName(scanPath ?? 'unknown', now),
                scanPath: scanPath ?? 'unknown',
                createdAt: now,
                source: 'manual',
                status: 'done',
                analysisResult: legacyResult,
                latestAiRawText: legacyRawText ?? '',
                latestAiPrompt: legacyPrompt ?? '',
                agentLogs: [],
                deletedPaths: [],
                addedToSafeListPaths: [],
                actionOverrides: [],
                ...computeStats(legacyResult, new Map()),
            }
            setSessions([session])
            setActiveSessionId(session.id)
        } else {
            setSessions([])
            setActiveSessionId(null)
        }
    }, [])

    const deleteSession = useCallback((id: string) => {
        setSessions(prev => prev.filter(s => s.id !== id))
        setActiveSessionId(prev => prev === id ? null : prev)
    }, [])

    const clearSessions = useCallback(() => {
        setSessions([])
        setActiveSessionId(null)
    }, [])

    return {
        sessions, activeSessionId, activeSession,
        createSession, switchSession, updateSession, deleteSession,
        setSessionAnalysisResult, addSuggestionToSession, removeSuggestionFromSession,
        markPathDeleted, markPathSafeListed, setSessionActionOverride,
        appendAgentLog,
        getSessionsForSnapshot, loadSessionsFromSnapshot, clearSessions,
    }
}
