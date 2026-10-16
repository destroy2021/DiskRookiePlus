import { useState, useCallback, useRef, useEffect } from 'react'

export type AiTaskType = 'ask' | 'scan' | 'analyze'
export type AiTaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed'

export interface AiTask {
    id: string
    paths: string[]
    type: AiTaskType
    status: AiTaskStatus
    progress: number
    streamLogs: string[]
    result?: unknown
    error?: string
    createdAt: number
}

interface UseAiTaskQueueReturn {
    tasks: AiTask[]
    currentTask: AiTask | null
    isRunning: boolean
    isPaused: boolean
    enqueue: (paths: string[], type: AiTaskType, executor: (taskId: string, onLog: (log: string) => void) => Promise<unknown>) => void
    pause: () => void
    resume: () => void
    cancel: () => void
    clear: () => void
    updateTask: (id: string, updates: Partial<AiTask>) => void
}

export function useAiTaskQueue(): UseAiTaskQueueReturn {
    const [tasks, setTasks] = useState<AiTask[]>([])
    const [isPaused, setIsPaused] = useState(false)
    const executorRef = useRef<((taskId: string, onLog: (log: string) => void) => Promise<unknown>) | null>(null)
    const currentTaskIdRef = useRef<string | null>(null)
    const isPausedRef = useRef(false)
    const processQueueRef = useRef<(() => void) | null>(null)

    const currentTask = tasks.find(t => t.status === 'running') ?? null
    const isRunning = tasks.some(t => t.status === 'running')

    const updateTask = useCallback((id: string, updates: Partial<AiTask>) => {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    }, [])

    const processQueue = useCallback(() => {
        if (isPausedRef.current) return
        setTasks(prev => {
            const queued = prev.find(t => t.status === 'queued')
            if (!queued || !executorRef.current) return prev
            isPausedRef.current = false
            currentTaskIdRef.current = queued.id
            updateTask(queued.id, { status: 'running', progress: 0 })
            executorRef.current(queued.id, (log: string) => {
                setTasks(arr => arr.map(task =>
                    task.id === queued.id
                        ? { ...task, streamLogs: [...task.streamLogs, log] }
                        : task
                ))
            }).then(result => {
                setTasks(arr => arr.map(task =>
                    task.id === queued.id
                        ? { ...task, status: 'done' as AiTaskStatus, progress: 100, result }
                        : task
                ))
                currentTaskIdRef.current = null
                setTimeout(() => { processQueueRef.current?.() }, 100)
            }).catch((err: unknown) => {
                setTasks(arr => arr.map(task =>
                    task.id === queued.id
                        ? { ...task, status: 'failed' as AiTaskStatus, error: String(err) }
                        : task
                ))
                currentTaskIdRef.current = null
                setTimeout(() => { processQueueRef.current?.() }, 100)
            })
            return prev
        })
    }, [updateTask])

    useEffect(() => {
        processQueueRef.current = processQueue
    }, [processQueue])

    const enqueue = useCallback((
        paths: string[],
        type: AiTaskType,
        executor: (taskId: string, onLog: (log: string) => void) => Promise<unknown>
    ) => {
        const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const task: AiTask = {
            id,
            paths,
            type,
            status: 'queued',
            progress: 0,
            streamLogs: [],
            createdAt: Date.now(),
        }
        executorRef.current = executor
        setTasks(prev => [...prev, task])
        setTimeout(() => { processQueueRef.current?.() }, 50)
    }, [])

    const pause = useCallback(() => {
        isPausedRef.current = true
        setIsPaused(true)
        setTasks(prev => prev.map(t =>
            t.status === 'running' ? { ...t, status: 'paused' as AiTaskStatus } : t
        ))
    }, [])

    const resume = useCallback(() => {
        isPausedRef.current = false
        setIsPaused(false)
        setTasks(prev => prev.map(t =>
            t.status === 'paused' ? { ...t, status: 'queued' as AiTaskStatus } : t
        ))
        setTimeout(() => { processQueueRef.current?.() }, 50)
    }, [])

    const cancel = useCallback(() => {
        const currentId = currentTaskIdRef.current
        if (currentId) {
            setTasks(prev => prev.map(t =>
                t.id === currentId ? { ...t, status: 'failed' as AiTaskStatus, error: 'Cancelled' } : t
            ))
        }
        currentTaskIdRef.current = null
        isPausedRef.current = false
        setIsPaused(false)
        setTimeout(() => { processQueueRef.current?.() }, 100)
    }, [])

    const clear = useCallback(() => {
        setTasks([])
        currentTaskIdRef.current = null
        isPausedRef.current = false
        setIsPaused(false)
    }, [])

    return {
        tasks,
        currentTask,
        isRunning,
        isPaused,
        enqueue,
        pause,
        resume,
        cancel,
        clear,
        updateTask,
    }
}