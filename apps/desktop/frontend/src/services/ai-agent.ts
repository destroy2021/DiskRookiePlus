import {
  loadSettings,
  resolveEffectiveApiKey,
  bearerAuthorization,
  type AISettings,
  type ChatCompletionResponse,
  type ChatMessage,
  type FunctionTool,
  type ToolCall,
} from './ai'
import { applyKimiCodingAgentHeaders, stripBearerPrefix } from './kimi-oauth'
import { httpFetch } from './http'
import {
  buildRejectedLog,
  executeMcpTool,
  isWhitelistedMcpTool,
  type McpToolArgs,
  type McpToolExecution,
  type McpToolName,
} from './mcp-tools'
import { getSystemInfo, type AnalysisResult, type CleanupSuggestion } from './ai-analysis'
import type { AgentRunProgress, AgentToolCallLog } from '../components/ExpertMode.types'
import i18n from '../i18n'

const MAX_AGENT_TURNS = 6
const AGENT_TOTAL_TIMEOUT_MS = 5 * 60 * 1000

const agentTools: FunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List direct child entries of a directory. Non-recursive and read-only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute directory path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_directory_size',
      description: 'Get recursive directory size, file count, and dir count. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute directory path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_file_info',
      description: 'Get metadata about a file or directory. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file or directory path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'output_suggestions',
      description: 'Output final cleanup suggestions after tool investigation.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Overall summary for the user' },
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['delete', 'move'] },
                type: { type: 'string', enum: ['file', 'directory'] },
                path: { type: 'string' },
                size: { type: 'string' },
                updateTime: { type: 'string' },
                message: { type: 'string' },
              },
              required: ['action', 'type', 'path', 'size', 'updateTime', 'message'],
            },
          },
        },
        required: ['summary', 'suggestions'],
      },
    },
  },
]

interface InlineAgentLog {
  log: AgentToolCallLog
}

export interface AgentAnalysisOptions {
  path: string
  signal?: AbortSignal
  onLog?: (execution: McpToolExecution | InlineAgentLog) => void
  onRawText?: (text: string) => void
  onProgress?: (progress: AgentRunProgress) => void
}

export class AgentAbortedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentAbortedError'
  }
}

export class AgentTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentTimeoutError'
  }
}

function buildAgentSystemPrompt(os: string, shell: string, languageName: string): string {
  return `You are an AI disk cleanup agent.

Environment:
- OS: ${os}
- Shell: ${shell}
- Reply language: ${languageName}

Rules:
1. Use only the provided read-only tools to inspect files and directories.
2. Never invent filesystem facts.
3. Never recommend deleting system files, program files, drivers, or important config files.
4. If uncertain, prefer move over delete.
5. Investigate before outputting suggestions.
6. When you are ready, call output_suggestions exactly once.
7. All user-facing summary and messages must use ${languageName}.`
}

function buildAgentUserPrompt(path: string, languageName: string): string {
  return `Analyze the path below for disk cleanup opportunities.

Target path: ${path}

Tasks:
- Inspect the target with read-only tools.
- Identify safe delete or move candidates.
- Prefer high-value, low-risk suggestions.
- If the disk usage under this path looks healthy, say so in the summary.
- Return final results in ${languageName} via output_suggestions.`
}

function parseToolArgs(toolCall: ToolCall): { ok: true; name: McpToolName; args: McpToolArgs[McpToolName] } | { ok: false; error: string } {
  if (!isWhitelistedMcpTool(toolCall.function.name)) {
    return { ok: false, error: `Tool '${toolCall.function.name}' is not whitelisted` }
  }
  const name = toolCall.function.name

  try {
    const parsed = JSON.parse(toolCall.function.arguments) as { path?: unknown }
    if (typeof parsed.path !== 'string' || parsed.path.trim() === '') {
      return { ok: false, error: 'Tool argument path is required' }
    }
    return { ok: true, name, args: { path: parsed.path.trim() } as McpToolArgs[McpToolName] }
  } catch {
    return { ok: false, error: 'Tool arguments are not valid JSON' }
  }
}

function normalizeSuggestion(candidate: unknown): CleanupSuggestion | null {
  if (!candidate || typeof candidate !== 'object') return null
  const record = candidate as Record<string, unknown>
  const action = record.action === 'delete' || record.action === 'move' ? record.action : null
  const type = record.type === 'file' || record.type === 'directory' ? record.type : null
  const path = typeof record.path === 'string' ? record.path.trim() : ''
  if (!action || !type || !path) return null
  return {
    action,
    type,
    path,
    size: typeof record.size === 'string' && record.size.trim() ? record.size.trim() : '-',
    updateTime: typeof record.updateTime === 'string' && record.updateTime.trim() ? record.updateTime.trim() : '-',
    message: typeof record.message === 'string' ? record.message.trim() : '',
  }
}

function parseOutputSuggestions(argumentsText: string, rawText: string, promptText: string): AnalysisResult {
  const parsed = JSON.parse(argumentsText) as { summary?: unknown; suggestions?: unknown[] }
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.map(normalizeSuggestion).filter((item): item is CleanupSuggestion => item !== null)
    : []
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
    ? parsed.summary.trim()
    : i18n.t('aiAnalysis.result')
  return {
    summary,
    suggestions,
    rawText,
    promptText,
  }
}

async function callAgentCompletion(messages: ChatMessage[], settings: AISettings, signal?: AbortSignal): Promise<ChatCompletionResponse> {
  const apiKey = await resolveEffectiveApiKey(settings)
  if (!apiKey) {
    throw new Error('请先配置 API Key，或完成 Kimi Code 账号登录')
  }

  const url = `${settings.apiUrl.replace(/\/$/, '')}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: bearerAuthorization(apiKey),
  }

  if (settings.apiUrl.includes('anthropic')) {
    headers['x-api-key'] = stripBearerPrefix(apiKey)
    headers['anthropic-version'] = '2023-06-01'
    delete headers.Authorization
  } else {
    applyKimiCodingAgentHeaders(headers, settings.apiUrl)
  }

  const response = await httpFetch(url, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: settings.model,
      messages,
      tools: agentTools,
      tool_choice: 'auto',
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
    }),
  })

  const rawText = await response.text()
  if (!response.ok) {
    throw new Error(`AI Agent 请求失败: ${response.status} - ${rawText}`)
  }

  return JSON.parse(rawText) as ChatCompletionResponse
}

export async function analyzeWithAgent(options: AgentAnalysisOptions): Promise<AnalysisResult> {
  const settings = await loadSettings()
  const systemInfo = await getSystemInfo()
  const currentLanguage = i18n.language || 'zh'
  const languageMap: Record<string, string> = { zh: '简体中文', en: 'English', ja: '日本語' }
  const languageName = languageMap[currentLanguage] || '简体中文'
  const systemPrompt = buildAgentSystemPrompt(systemInfo.os, systemInfo.shell, languageName)
  const userPrompt = buildAgentUserPrompt(options.path, languageName)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const rawResponses: string[] = []
  const transcript: string[] = []
  let tokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  let suggestionCount = 0
  let latestSummary: string | null = null

  const startedAt = Date.now()
  const timeoutController = new AbortController()
  const timeoutHandle = setTimeout(() => timeoutController.abort(), AGENT_TOTAL_TIMEOUT_MS)

  const linkedAbort = () => timeoutController.abort()
  if (options.signal) {
    if (options.signal.aborted) timeoutController.abort()
    else options.signal.addEventListener('abort', linkedAbort, { once: true })
  }

  const checkAbort = () => {
    if (options.signal?.aborted) {
      throw new AgentAbortedError(i18n.t('aiAnalysis.canceled'))
    }
    if (timeoutController.signal.aborted && !options.signal?.aborted) {
      throw new AgentTimeoutError(i18n.t('aiAnalysis.agentTimedOut'))
    }
  }

  const reportProgress = (turn: number, currentTool: string | null) => {
    options.onProgress?.({
      turn,
      maxTurns: MAX_AGENT_TURNS,
      currentTool,
      latestSummary,
      suggestionCount,
    })
  }

  try {
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
      checkAbort()
      reportProgress(turn + 1, null)

      const completion = await callAgentCompletion(messages, settings, timeoutController.signal)
      tokenUsage = {
        prompt_tokens: tokenUsage.prompt_tokens + (completion.usage?.prompt_tokens ?? 0),
        completion_tokens: tokenUsage.completion_tokens + (completion.usage?.completion_tokens ?? 0),
        total_tokens: tokenUsage.total_tokens + (completion.usage?.total_tokens ?? 0),
      }

      const choice = completion.choices?.[0]
      if (!choice) {
        throw new Error('AI Agent 未返回有效响应')
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls,
      }
      messages.push(assistantMessage)
      rawResponses.push(JSON.stringify(choice.message, null, 2))

      const assistantParts: string[] = []
      if (choice.message.content?.trim()) {
        assistantParts.push(choice.message.content.trim())
      }
      const summarizedToolCalls = (choice.message.tool_calls ?? [])
        .map((toolCall) => `[tool] ${toolCall.function.name}\n${toolCall.function.arguments}`)
        .join('\n\n')
      if (summarizedToolCalls) {
        assistantParts.push(summarizedToolCalls)
      }
      if (assistantParts.length > 0) {
        transcript.push(assistantParts.join('\n\n'))
        options.onRawText?.(transcript.join('\n\n\n'))
      }

      const toolCalls = choice.message.tool_calls ?? []
      if (toolCalls.length === 0) {
        latestSummary = choice.message.content?.trim() || null
        reportProgress(turn + 1, null)
        return {
          summary: latestSummary || i18n.t('aiAnalysis.noSuggestions'),
          suggestions: [],
          rawText: transcript.join('\n\n\n') || rawResponses.join('\n\n'),
          promptText: `${systemPrompt}\n\n${userPrompt}`,
          continueContextHint: i18n.t('aiAnalysis.continueFromContextHint'),
          tokenUsage,
        }
      }

      for (const toolCall of toolCalls) {
        checkAbort()
        if (toolCall.function.name === 'output_suggestions') {
          const result = parseOutputSuggestions(
            toolCall.function.arguments,
            transcript.join('\n\n\n') || (rawResponses.join('\n\n') + '\n\n' + toolCall.function.arguments),
            `${systemPrompt}\n\n${userPrompt}`,
          )
          suggestionCount = result.suggestions.length
          latestSummary = result.summary
          reportProgress(turn + 1, null)
          return {
            ...result,
            tokenUsage,
          }
        }

        const parsed = parseToolArgs(toolCall)
        if (!parsed.ok) {
          const errorText = parsed.error
          options.onLog?.({
            log: buildRejectedLog(toolCall.function.name, { toolCallId: toolCall.id }, errorText),
          })
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: errorText, name: toolCall.function.name })
          continue
        }

        reportProgress(turn + 1, parsed.name)
        const execution = await executeMcpTool(parsed.name, parsed.args)
        latestSummary = execution.log.result ?? null
        options.onLog?.(execution)
        transcript.push(`[tool result] ${parsed.name}\n${execution.error ?? JSON.stringify(execution.result ?? {}, null, 2)}`)
        options.onRawText?.(transcript.join('\n\n\n'))
        reportProgress(turn + 1, null)
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: parsed.name,
          content: execution.error
            ? JSON.stringify({ error: execution.error })
            : JSON.stringify(execution.result ?? {}),
        })
      }
    }

    return {
      summary: i18n.t('aiAnalysis.agentMaxTurnsReached'),
      suggestions: [],
      rawText: transcript.join('\n\n\n') || rawResponses.join('\n\n'),
      promptText: `${systemPrompt}\n\n${userPrompt}`,
      interrupted: true,
      continueContextHint: i18n.t('aiAnalysis.continueFromContextHint'),
      tokenUsage,
    }
  } catch (err) {
    const aborted = err instanceof AgentAbortedError || (err instanceof Error && err.name === 'AbortError' && options.signal?.aborted)
    const timedOut = err instanceof AgentTimeoutError || (err instanceof Error && err.name === 'AbortError' && timeoutController.signal.aborted && !options.signal?.aborted)
    if (aborted || timedOut) {
      const elapsed = Date.now() - startedAt
      const summaryKey = timedOut ? 'aiAnalysis.agentTimedOut' : 'aiAnalysis.canceled'
      return {
        summary: `${i18n.t(summaryKey)} (${(elapsed / 1000).toFixed(1)}s)`,
        suggestions: [],
        rawText: transcript.join('\n\n\n') || rawResponses.join('\n\n'),
        promptText: `${systemPrompt}\n\n${userPrompt}`,
        interrupted: true,
        continueContextHint: i18n.t('aiAnalysis.continueFromContextHint'),
        tokenUsage,
      }
    }
    throw err
  } finally {
    clearTimeout(timeoutHandle)
    if (options.signal) {
      options.signal.removeEventListener('abort', linkedAbort)
    }
  }
}
