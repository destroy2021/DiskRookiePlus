import {
  getDirectorySize,
  getFileInfo,
  listDirectory,
  type DirectoryListing,
  type DirectorySizeResult,
  type FileInfoResult,
} from './ai-analysis'
import type { AgentToolCallLog, AgentToolCallStatus } from '../components/ExpertMode.types'

export type McpToolName = 'list_directory' | 'get_directory_size' | 'get_file_info'

export const MCP_TOOL_WHITELIST: ReadonlyArray<McpToolName> = [
  'list_directory',
  'get_directory_size',
  'get_file_info',
]

export function isWhitelistedMcpTool(name: string): name is McpToolName {
  return (MCP_TOOL_WHITELIST as ReadonlyArray<string>).includes(name)
}

export type McpToolArgs = {
  list_directory: { path: string }
  get_directory_size: { path: string }
  get_file_info: { path: string }
}

export type McpToolResult = {
  list_directory: DirectoryListing
  get_directory_size: DirectorySizeResult
  get_file_info: FileInfoResult
}

export interface McpToolExecution<TName extends McpToolName = McpToolName> {
  toolName: TName
  args: McpToolArgs[TName]
  result?: McpToolResult[TName]
  error?: string
  log: AgentToolCallLog
}

function sanitizePath(path: string): string {
  return path.trim()
}

interface ResultMeta {
  summary: string
  truncated?: boolean
  timedOut?: boolean
}

function summarizeResult(toolName: McpToolName, result: McpToolResult[McpToolName]): ResultMeta {
  if (toolName === 'list_directory') {
    const listing = result as DirectoryListing
    const truncated = Boolean(listing.truncated)
    const suffix = truncated ? `, truncated ${listing.items.length}/${listing.total_count ?? '?'}` : ''
    return { summary: `${listing.items.length} items${suffix}`, truncated }
  }

  if (toolName === 'get_directory_size') {
    const size = result as DirectorySizeResult
    const timedOut = Boolean(size.timed_out)
    const suffix = timedOut ? ', timed out' : ''
    return { summary: `${size.file_count} files, ${size.dir_count} dirs, ${size.total_size} bytes${suffix}`, timedOut }
  }

  const info = result as FileInfoResult
  return { summary: `${info.is_dir ? 'directory' : 'file'}, ${info.size} bytes` }
}

function buildLog(
  toolName: string,
  args: Record<string, unknown>,
  status: AgentToolCallStatus,
  durationMs: number,
  result?: string,
  extras?: { truncated?: boolean; timedOut?: boolean },
): AgentToolCallLog {
  return {
    toolName,
    args,
    result,
    timestamp: Date.now(),
    status,
    durationMs,
    truncated: extras?.truncated || undefined,
    timedOut: extras?.timedOut || undefined,
  }
}

export function buildRejectedLog(toolName: string, args: Record<string, unknown>, reason: string): AgentToolCallLog {
  return buildLog(toolName, args, 'rejected', 0, reason)
}

export async function executeMcpTool<TName extends McpToolName>(
  toolName: TName,
  args: McpToolArgs[TName],
): Promise<McpToolExecution<TName>> {
  if (!isWhitelistedMcpTool(toolName)) {
    const log = buildRejectedLog(toolName, args as Record<string, unknown>, `Tool '${toolName}' is not whitelisted`)
    return {
      toolName,
      args,
      error: log.result,
      log,
    }
  }

  const normalizedArgs = { ...args, path: sanitizePath(args.path) } as McpToolArgs[TName]
  const startedAt = Date.now()

  try {
    let result: McpToolResult[TName]
    if (toolName === 'list_directory') {
      result = await listDirectory(normalizedArgs.path) as McpToolResult[TName]
    } else if (toolName === 'get_directory_size') {
      result = await getDirectorySize(normalizedArgs.path) as McpToolResult[TName]
    } else {
      result = await getFileInfo(normalizedArgs.path) as McpToolResult[TName]
    }

    const meta = summarizeResult(toolName, result as McpToolResult[McpToolName])
    return {
      toolName,
      args: normalizedArgs,
      result,
      log: buildLog(toolName, normalizedArgs, 'success', Date.now() - startedAt, meta.summary, { truncated: meta.truncated, timedOut: meta.timedOut }),
    }
  } catch (err) {
    const error = String(err)
    return {
      toolName,
      args: normalizedArgs,
      error,
      log: buildLog(toolName, normalizedArgs, 'failure', Date.now() - startedAt, `Error: ${error}`),
    }
  }
}

export async function runInitialMcpInspection(path: string): Promise<McpToolExecution[]> {
  const executions: McpToolExecution[] = []
  const info = await executeMcpTool('get_file_info', { path })
  executions.push(info)

  const isDir = info.result?.is_dir ?? false
  if (isDir) {
    const listing = await executeMcpTool('list_directory', { path })
    executions.push(listing)
    const size = await executeMcpTool('get_directory_size', { path })
    executions.push(size)
  }

  return executions
}
