import type { ParserMemo } from '../../transports/cli-jsonl'
import { clip, oneLine } from '../../core/text'
import type { HarnessAction, HarnessEvent, Usage } from '../../core/types'

type Tool = { id: string; name: string; input: Record<string, any> }
type Turn = { pending: Record<string, Tool>; usage: Usage }
const fresh = (): Turn => ({ pending: {}, usage: { input: 0, cached: 0, output: 0 } })
const fail = (error: string): HarnessEvent => ({ error, line: `! ${clip(oneLine(error), 200)}` })
const contentText = (content: unknown): string => typeof content === 'string' ? content : JSON.stringify(content ?? '')

function action(tool: Tool, result: any): HarnessAction {
  const output = contentText(result.content)
  const base = { id: tool.id, output, ...(result.is_error && { isError: true }) }
  if (tool.name === 'shell_command') {
    let shell: any
    try { shell = JSON.parse(output) } catch { /* Preserve non-JSON errors verbatim. */ }
    const code = typeof shell?.exitCode === 'number' ? shell.exitCode : undefined
    const command = String(tool.input.command ?? '')
    return {
      ...base, kind: 'command', title: oneLine(command),
      input: { kind: 'command', command, ...(code !== undefined && { exit_code: code }) },
      output: typeof shell?.output === 'string' ? shell.output : output,
      ...((result.is_error || (code !== undefined && code !== 0)) && { isError: true }),
    }
  }
  if (tool.name === 'create_file') {
    const path = String(tool.input.path ?? '')
    return {
      ...base, kind: 'file_change', title: `create ${path}`,
      input: { kind: 'file_change', changes: [{ path, kind: 'create' }] },
    }
  }
  return { ...base, kind: 'tool', title: tool.name, input: { kind: 'tool', tool: tool.name, arguments: tool.input } }
}

export function parseAmp(raw: string, memo: ParserMemo): HarnessEvent | HarnessEvent[] {
  let ev: any
  try { ev = JSON.parse(raw) } catch { return { line: clip(oneLine(raw), 200) } }
  const id = ev?.session_id
  if (ev?.type === 'result') {
    delete memo.turn
    if (ev.is_error || (typeof ev.subtype === 'string' && ev.subtype.startsWith('error'))) {
      return fail(String(ev.result || ev.error?.message || ev.errors?.join('\n') || 'Amp failed'))
    }
    // The success result repeats the assistant's closing text.
    return {}
  }
  if (typeof id !== 'string') return {}
  if (ev.type === 'system' && ev.subtype === 'init') {
    memo.turn = fresh()
    return { sessionId: id }
  }
  const state = memo.turn as Turn | undefined
  if (!state) return fail('Amp parser has no init state for this thread.')
  const blocks = Array.isArray(ev.message?.content) ? ev.message.content : []
  const event: HarnessEvent = {}
  if (ev.type === 'assistant') {
    const u = ev.message?.usage
    if (u) {
      state.usage.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      state.usage.cached += u.cache_read_input_tokens ?? 0
      state.usage.output += u.output_tokens ?? 0
      event.usage = { ...state.usage }
    }
    const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    if (text) event.message = text
    const calls = blocks.filter((b: any) => b.type === 'tool_use')
    const events: HarnessEvent[] = []
    for (const tool of calls as Tool[]) {
      state.pending[tool.id] = tool
      const title = clip(oneLine(String(tool.name === 'shell_command' ? tool.input.command : tool.name === 'create_file' ? tool.input.path : tool.name)), 200)
      events.push({ started: { id: tool.id, title }, line: `${tool.name === 'shell_command' ? '$' : '⚙'} ${title}` })
    }
    if (events.length) {
      Object.assign(events[0]!, event)
      return events.length === 1 ? events[0]! : events
    }
  } else if (ev.type === 'user') {
    const results = blocks.filter((b: any) => b.type === 'tool_result')
    const events = results.map((result: any): HarnessEvent => {
      const tool = state.pending[result.tool_use_id]
      if (!tool) return fail(`Amp tool result has no matching tool use: ${result.tool_use_id}`)
      delete state.pending[result.tool_use_id]
      return { action: action(tool, result) }
    })
    if (events.length) return events.length === 1 ? events[0]! : events
  }
  return event
}
