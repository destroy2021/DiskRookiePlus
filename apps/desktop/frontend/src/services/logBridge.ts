import { invoke } from '@tauri-apps/api/core'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type ConsoleFn = (...data: unknown[]) => void

const BRIDGE_FLAG = '__disk_rookie_console_bridge_installed__'

export function installConsoleLogBridge(): void {
  const globalScope = globalThis as Record<string, unknown>
  if (globalScope[BRIDGE_FLAG]) {
    return
  }
  globalScope[BRIDGE_FLAG] = true

  bindLevel('debug')
  bindLevel('info')
  bindLevel('warn')
  bindLevel('error')
}

function bindLevel(level: LogLevel): void {
  const original = console[level].bind(console) as ConsoleFn
  console[level] = (...args: unknown[]) => {
    original(...args)
    void forwardFrontendLog(level, args)
  }
}

async function forwardFrontendLog(level: LogLevel, args: unknown[]): Promise<void> {
  const message = args.map((arg) => serializeArg(arg)).join(' ')
  try {
    await invoke('log_frontend_event', {
      level,
      message: `[frontend] ${message}`,
    })
  } catch {
    // 避免日志桥接失败触发二次日志循环
  }
}

function serializeArg(value: unknown): string {
  if (value instanceof Error) {
    const stack = value.stack ? `\n${value.stack}` : ''
    return `${value.name}: ${value.message}${stack}`
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
