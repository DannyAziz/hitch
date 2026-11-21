import type { ParserMemo } from '../../transports/cli-jsonl'
import { clip, oneLine } from '../../core/text'
import type { HarnessAction, HarnessEvent, Usage } from '../../core/types'

const fail = (error: string): HarnessEvent => ({ error, line: `! ${clip(oneLine(error), 200)}` })
const text = (blocks: any): string => Array.isArray(blocks)
  ? blocks.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
  : ''

export function parsePi(raw: string, memo: ParserMemo): HarnessEvent {
  const pending = (memo.pending ??= {}) as Record<string, { name: string; args: Record<string, any> }>
  const usage = (memo.usage ??= { input: 0, cached: 0, output: 0 }) as Usage
  let ev: any
  try { ev = JSON.parse(raw) } catch { return { line: clip(oneLine(raw), 200) } }
  if (ev?.type === 'session') {
    memo.usage = { input: 0, cached: 0, output: 0 }
    memo.pending = {}
    return typeof ev.id === 'string' ? { sessionId: ev.id } : {}
  }
  const message = ev?.message
  if ((ev?.type === 'turn_end' || ev?.type === 'message_end') && message?.stopReason === 'error') {
    return fail(String(message.errorMessage || 'pi failed'))
  }
  if (ev?.type === 'message_end' && message?.role === 'assistant') {
    const event: HarnessEvent = {}
    const body = text(message.content)
    if (body) event.message = body
    const u = message.usage
    if (u) {
      usage.input += (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0)
      usage.cached += u.cacheRead ?? 0
      usage.output += u.output ?? 0
      event.usage = { ...usage }
    }
    return event
  }
  if (ev?.type === 'tool_execution_start') {
    const args = ev.args ?? {}
    pending[ev.toolCallId] = { name: ev.toolName, args }
    const title = clip(oneLine(String(ev.toolName === 'bash' ? args.command ?? ''
      : ['write', 'edit', 'read'].includes(ev.toolName) ? args.path ?? '' : ev.toolName)), 200)
    return { started: { id: ev.toolCallId, title }, line: `${ev.toolName === 'bash' ? '$' : '⚙'} ${title}` }
  }
  if (ev?.type === 'tool_execution_end') {
    const tool = pending[ev.toolCallId]
    if (!tool) return fail(`pi tool result has no matching start: ${ev.toolCallId}`)
    delete pending[ev.toolCallId]
    const base = { id: ev.toolCallId, output: text(ev.result?.content), isError: Boolean(ev.isError) }
    let action: HarnessAction
    if (tool.name === 'bash') {
      const command = String(tool.args.command ?? '')
      const code = ev.result?.structuredContent?.exit_code
      action = { ...base, kind: 'command', title: oneLine(command),
        input: { kind: 'command', command, ...(typeof code === 'number' && { exit_code: code }) } }
    } else if (tool.name === 'write' || tool.name === 'edit') {
      const path = String(tool.args.path ?? '')
      action = { ...base, kind: 'file_change', title: `${tool.name} ${path}`,
        input: { kind: 'file_change', changes: [{ path, kind: tool.name }] } }
    } else {
      action = { ...base, kind: 'tool', title: tool.name === 'read' ? `read ${tool.args.path ?? ''}` : tool.name,
        input: { kind: 'tool', tool: tool.name, arguments: tool.args } }
    }
    return { action }
  }
  if (ev?.type === 'agent_settled') memo.pending = {}
  // Ignore deltas, system prompts, repeated turn messages and agent_end.
  return {}
}
