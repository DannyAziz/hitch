import type { ParserMemo } from '../../transports/cli-jsonl'
// Codex's `codex exec --json` event stream (verified against codex-cli 0.167
// output, see fixture.ts) as HarnessEvents, and the diff lookup for its file
// changes.

import { clip, oneLine } from '../../core/text'
import type { DetailContext, HarnessAction, HarnessEvent } from '../../core/types'

// `/bin/zsh -lc 'cat a.txt'` -> `cat a.txt`
export function unwrapShell(command: string): string {
  const m = /^(?:\/bin\/)?(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/.exec(command.trim())
  return m ? m[2]!.replace(/'\\''/g, "'") : command
}

export function parseCodex(raw: string, _memo: ParserMemo): HarnessEvent {
  let ev: any
  try {
    ev = JSON.parse(raw)
  } catch {
    return { line: clip(oneLine(raw), 200) }
  }
  const item = ev?.item
  switch (ev?.type) {
    case 'thread.started':
      return typeof ev.thread_id === 'string' ? { sessionId: ev.thread_id } : {}
    case 'item.started':
      if (item?.type === 'command_execution') {
        const title = clip(oneLine(unwrapShell(String(item.command ?? ''))), 200)
        return { line: `$ ${title}`, started: { id: item.id, title } }
      }
      if (item?.type === 'file_change') {
        const title = clip((item.changes ?? []).map((c: any) => c.path).join(', '), 200)
        return { line: `✎ ${title}`, started: { id: item.id, title } }
      }
      if (item?.type === 'mcp_tool_call') {
        const title = `${item.server ?? '?'}.${item.tool ?? '?'}`
        return { line: `⚙ ${title}`, started: { id: item.id, title } }
      }
      return {}
    case 'item.completed': {
      switch (item?.type) {
        case 'agent_message':
          return { message: String(item.text ?? '') }
        case 'reasoning':
          return { line: `· ${clip(oneLine(String(item.text ?? '')), 200)}` }
        case 'command_execution': {
          const command = unwrapShell(String(item.command ?? ''))
          const code = typeof item.exit_code === 'number' ? item.exit_code : undefined
          const out = String(item.aggregated_output ?? '')
          return {
            action: {
              kind: 'command',
              id: item.id,
              title: oneLine(command),
              input: { kind: 'command', command, ...(code !== undefined && { exit_code: code }) },
              output: `${out}${code ? `${out.endsWith('\n') || !out ? '' : '\n'}(exit ${code})` : ''}` || '(no output)',
              ...(code !== undefined && code !== 0 && { isError: true }),
            },
          }
        }
        case 'file_change': {
          const changes = (item.changes ?? []).map((c: any) => ({ path: String(c.path), kind: String(c.kind) }))
          const list = changes.map((c: { path: string; kind: string }) => `${c.kind} ${c.path}`).join('\n')
          return {
            action: {
              kind: 'file_change',
              id: item.id,
              title: changes.map((c: { path: string; kind: string }) => `${c.kind} ${c.path}`).join(', '),
              input: { kind: 'file_change', changes },
              output: list,
              ...(item.status === 'failed' && { isError: true }),
            },
          }
        }
        case 'mcp_tool_call':
          return {
            action: {
              kind: 'mcp_tool_call',
              id: item.id,
              title: `${item.server ?? '?'}.${item.tool ?? '?'}`,
              input: { kind: 'mcp_tool_call', server: item.server, tool: item.tool, arguments: item.arguments },
              output: JSON.stringify(item.result ?? item.error ?? null, null, 2),
              ...(item.status === 'failed' && { isError: true }),
            },
          }
        case 'web_search':
          return {
            action: {
              kind: 'web_search',
              id: item.id,
              title: `search: ${item.query ?? ''}`,
              input: { kind: 'web_search', query: item.query },
              output: '(searched)',
            },
          }
        case 'todo_list':
          return {
            line: `☐ ${clip((item.items ?? []).map((t: any) => `${t.completed ? '✓' : '·'} ${t.text}`).join('  '), 200)}`,
          }
        case 'error':
          return { line: `! ${clip(oneLine(String(item.message ?? '')), 200)}`, error: String(item.message ?? '') }
        default:
          return {}
      }
    }
    case 'turn.started':
      return { isPrompted: true }
    case 'turn.completed':
      return ev.usage
        ? {
            usage: {
              input: ev.usage.input_tokens ?? 0,
              cached: ev.usage.cached_input_tokens ?? 0,
              output: ev.usage.output_tokens ?? 0,
            },
          }
        : {}
    case 'turn.failed':
    case 'error': {
      const message = String(ev?.error?.message ?? ev?.message ?? 'error')
      return { line: `! ${clip(oneLine(message), 200)}`, error: message }
    }
    default:
      return {}
  }
}

// Codex's --json file_change event names the files but carries no diff. Its
// rollout file (~/.codex/sessions/.../rollout-*-<thread>.jsonl) records each
// change with a unified diff: read the latest one for the same files. Best
// effort: the rollout is Codex's internal format.
export async function codexDetail(action: HarnessAction, ctx: DetailContext) {
  if (action.kind !== 'file_change' || !ctx.sessionId) return undefined
  const out = await ctx.run([
    '/bin/sh',
    '-c',
    'grep -h \'"FileChange"\' "${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*-"$1".jsonl 2>/dev/null | tail -n 40',
    'sh',
    ctx.sessionId,
  ])
  const want = ((action.input.changes as { path: string }[] | undefined) ?? []).map(c => c.path).sort().join('\n')
  const lines = out.split('\n').filter(Boolean).reverse()
  for (const line of lines) {
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    const changes = ev?.payload?.item?.changes
    if (!changes || typeof changes !== 'object') continue
    if (Object.keys(changes).sort().join('\n') !== want) continue
    return Object.entries(changes as Record<string, any>)
      .map(([path, c]) => `${c?.type ?? 'change'} ${path}\n${String(c?.unified_diff ?? '').trimEnd()}`)
      .join('\n\n')
  }
  return undefined
}

