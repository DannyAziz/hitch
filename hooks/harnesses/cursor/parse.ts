import type { ParserMemo } from '../../transports/cli-jsonl'
// Cursor's `agent -p --output-format stream-json` event stream (verified
// against agent CLI 2026.11.19-f005e9d output, see fixture.ts) as
// HarnessEvents.
//
// One JSON event per stdout line: system/init (the session id), user (the
// echoed prompt), thinking deltas (fragments, joined per session and shown
// as one line when the block completes), assistant messages, tool_call
// started/completed pairs (shellToolCall, editToolCall, and whatever other
// *ToolCall Cursor adds), and a final result with the turn's usage — whose
// `result` string is every assistant message joined, so it is never the
// report (the last assistant message is).

import { clip, oneLine } from '../../core/text'
import type { HarnessEvent } from '../../core/types'

const sessionOf = (ev: any) => (typeof ev?.session_id === 'string' ? ev.session_id : undefined)

// The *ToolCall member of a tool_call event's `tool_call` object.
const toolOf = (ev: any) => {
  const call = ev?.tool_call
  if (!call || typeof call !== 'object') return undefined
  const key = Object.keys(call).find(k => k.endsWith('ToolCall'))
  return key ? { key, tc: call[key] } : undefined
}

// The one-line title of a tool call: its command, its path, or its
// description / prettified name.
const titleOf = (key: string, tc: any) => {
  const args = tc?.args ?? {}
  if (key === 'shellToolCall') return clip(oneLine(String(args.command ?? '')), 200)
  if (key === 'editToolCall') return clip(String(args.path ?? 'edit'), 200)
  const d = tc?.description ?? args.description ?? args.command ?? args.path
  return clip(oneLine(String(d ?? key.replace(/ToolCall$/, '').toLowerCase())), 200)
}

// A shellToolCall result's real output: the interleaved stream when the CLI
// sends it, else stdout, plus stderr when it isn't already in it.
const shellOutput = (res: any) => {
  const inter = String(res?.interleavedOutput ?? '')
  const body = inter || String(res?.stdout ?? '')
  const err = String(res?.stderr ?? '')
  if (err && !(inter && inter.includes(err))) {
    return body ? `${body}${body.endsWith('\n') ? '' : '\n'}${err}` : err
  }
  return body
}

function parseToolCall(ev: any): HarnessEvent {
  const found = toolOf(ev)
  if (!found) return {}
  const { key, tc } = found
  const args = tc?.args ?? {}
  const id = typeof ev.call_id === 'string' ? ev.call_id : undefined

  if (ev.subtype === 'started') {
    const title = titleOf(key, tc)
    return {
      line: `${key === 'shellToolCall' ? '$' : key === 'editToolCall' ? '✎' : '⚙'} ${title}`,
      started: { ...(id && { id }), title },
    }
  }
  if (ev.subtype !== 'completed') return {}

  if (key === 'shellToolCall') {
    const result = tc?.result
    const res = result?.success ?? {}
    const command = String(res.command ?? args.command ?? '')
    const code = typeof res.exitCode === 'number' ? res.exitCode : undefined
    const failed = result != null && result.success == null
    const body = failed ? JSON.stringify(result, null, 2) : shellOutput(res)
    return {
      action: {
        kind: 'command',
        ...(id && { id }),
        title: oneLine(command),
        input: { kind: 'command', command, ...(code !== undefined && { exit_code: code }) },
        output: `${body}${code ? `${body.endsWith('\n') || !body ? '' : '\n'}(exit ${code})` : ''}` || '(no output)',
        ...((failed || (code !== undefined && code !== 0)) && { isError: true }),
      },
    }
  }

  if (key === 'editToolCall') {
    const result = tc?.result
    const res = result?.success
    const path = String(res?.path ?? args.path ?? '')
    const diff = typeof res?.diffString === 'string' ? res.diffString : ''
    const verb = diff.startsWith('--- /dev/null') ? 'add' : diff.includes('\n+++ /dev/null') ? 'delete' : 'update'
    const failed = result != null && res == null
    const body =
      diff.trimEnd() ||
      String(res?.afterFullFileContent ?? '') ||
      String(res?.message ?? '') ||
      (result ? JSON.stringify(result, null, 2) : '')
    return {
      action: {
        kind: 'file_change',
        ...(id && { id }),
        title: `${verb} ${path}`,
        input: { kind: 'file_change', path },
        output: body || '(done)',
        ...(failed && { isError: true }),
      },
    }
  }

  // Any other *ToolCall Cursor emits: a generic row with its JSON result
  // (only shellToolCall and editToolCall were verified — see README.md).
  const result = tc?.result
  const name = key.replace(/ToolCall$/, '')
  const kind = name.toLowerCase()
  return {
    action: {
      kind,
      ...(id && { id }),
      title: titleOf(key, tc),
      input: { kind, tool: name, args },
      output: result === undefined ? '(done)' : clip(JSON.stringify(result.success ?? result, null, 2) || '(done)', 30_000),
      ...(result != null && result.success == null && result.error != null && { isError: true }),
    },
  }
}

export function parseCursor(raw: string, memo: ParserMemo): HarnessEvent {
  let ev: any
  try {
    ev = JSON.parse(raw)
  } catch {
    return { line: clip(oneLine(raw), 200) }
  }
  const sid = sessionOf(ev)
  switch (ev?.type) {
    case 'system':
      return ev?.subtype === 'init' && sid ? { sessionId: sid } : {}
    case 'user':
      return {}
    case 'thinking': {
      if (ev.subtype === 'delta' && typeof ev.text === 'string') {
        if (sid) {
          memo.thinking = `${memo.thinking ?? ''}${ev.text}`
        }
        return {}
      }
      if (ev.subtype === 'completed') {
        const text = typeof ev.text === 'string' && ev.text ? ev.text : sid ? memo.thinking : undefined
        if (sid) delete memo.thinking
        return text ? { line: `· ${clip(oneLine(text), 200)}` } : {}
      }
      return {}
    }
    case 'assistant': {
      const content = ev?.message?.content
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
                .map((b: any) => b.text)
                .join('\n')
            : ''
      return text.trim() ? { message: text } : {}
    }
    case 'tool_call':
      return parseToolCall(ev)
    case 'result': {
      if (sid) delete memo.thinking
      const u = ev?.usage
      const usage = u
        ? {
            input: Number(u.inputTokens ?? 0),
            cached: Number(u.cacheReadTokens ?? 0),
            output: Number(u.outputTokens ?? 0),
          }
        : undefined
      if (ev?.is_error === true || ev?.subtype === 'error') {
        const message = String(ev?.result ?? ev?.subtype ?? 'error')
        return { ...(usage && { usage }), line: `! ${clip(oneLine(message), 200)}`, error: message }
      }
      return usage ? { usage } : {}
    }
    case 'error': {
      const raw = ev?.message ?? ev?.error?.message ?? ev?.error
      const message = typeof raw === 'string' ? raw : JSON.stringify(raw ?? 'error')
      return { line: `! ${clip(oneLine(message), 200)}`, error: message }
    }
    default:
      return {}
  }
}
