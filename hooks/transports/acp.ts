// Transport `acp`: a generic Agent Client Protocol client, as a state
// machine over the server's stdout lines. Pure: it returns the JSON-RPC
// messages to write and the HarnessEvents a line means; core/step.ts writes
// and shows them. Its state is plain data, persisted with the run, so a
// later step (or a reloaded copy of hitch) carries on from the next unread
// line.
//
// One server process per harness turn: initialize, then session/new (first
// turn) or session/load (a follow-up, when the server advertises
// loadSession), session/set_mode for the sandbox, session/prompt; streamed
// session/update notifications become text, thinking and rows; the prompt's
// response ends the turn. Server-to-client requests are always answered:
// session/request_permission by the explicit access rule or deferred engine decision (recorded as a row),
// anything else with "method not found" (this client advertises no fs or
// terminal capability).
//
// Nothing here knows a particular server. Tested with devin 3000.14
// (`devin acp`); the shapes as seen there: tool_call / tool_call_update with
// kind execute|edit|read|..., content of {type:'content'} text and
// {type:'diff', path, oldText?, newText}, rawInput.command, and the exit code
// in _meta.terminal_exit.exit_code; permission requests carry only
// toolCall.toolCallId (the tool_call came just before) and options with kinds
// allow_once / allow_always / reject_once; the prompt response carries
// stopReason and usage {inputTokens, outputTokens, cachedReadTokens}.

import type { HarnessAction, HarnessEvent, LaunchSpec } from '../core/types'
import { clip, oneLine } from '../core/text'

// A tool call as the ACP client knows it, for a permission decision.
export type AcpCall = { kind?: string; title?: string; command?: string; path?: string; url?: string; rawInput?: Record<string, unknown> }

// What an entry gives for transport `acp`.
export type AcpSpec = {
  // The server's command (no prompt on it: that goes through the protocol).
  argv(spec: LaunchSpec): string[]
  // The session mode to set for a sandbox (session/set_mode), if any.
  mode?(sandbox: string | undefined): string | undefined
  // Whether to allow a tool call the server asks permission for. Default:
  // read-only allows read/search/fetch/think only; anything else allows.
  permit?(call: AcpCall, sandbox: string | undefined): boolean
}

type Json = Record<string, any>

export type AcpCallState = AcpCall & {
  content?: unknown[]
  rawOutput?: unknown
  exit?: number
  status?: string
  isHook?: boolean
}

export type AcpState = {
  phase: 'init' | 'session' | 'mode' | 'prompt' | 'done'
  nextId: number
  ids: { init?: number; session?: number; mode?: number; prompt?: number }
  sessionId?: string
  isLoading?: boolean
  // The prompt, kept until it is sent.
  prompt?: string
  cwd: string
  mode?: string
  sandbox?: string
  decisionWho?: string
  calls: Record<string, AcpCallState>
  // Summed over the turn's model requests (usage_update), so it compares
  // with Codex's turn totals; the prompt response's usage is the last
  // request's alone.
  usage?: { input: number; cached: number; output: number }
}

export type AcpOutput = { writes: Json[]; events: HarnessEvent[]; permission?: { msg: Json; call: AcpCall } }

const READ_KINDS = new Set(['read', 'search', 'fetch', 'think'])

export function defaultPermit(call: AcpCall, sandbox: string | undefined): boolean {
  if (sandbox === 'read-only') return READ_KINDS.has(call.kind ?? '')
  return true
}


const request = (st: AcpState, method: string, params: Json): [number, Json] => {
  const id = st.nextId++
  return [id, { jsonrpc: '2.0', id, method, params }]
}

export function acpOpen(
  ctx: { cwd: string; prompt: string; mode?: string; sandbox?: string; decisionWho?: string; resumeId?: string },
): { state: AcpState; writes: Json[] } {
  const state: AcpState = {
    phase: 'init',
    nextId: 1,
    ids: {},
    cwd: ctx.cwd,
    prompt: ctx.prompt,
    calls: {},
    decisionWho: ctx.decisionWho,
    ...(ctx.mode && { mode: ctx.mode }),
    ...(ctx.sandbox && { sandbox: ctx.sandbox }),
    ...(ctx.resumeId && { sessionId: ctx.resumeId }),
  }
  const [id, msg] = request(state, 'initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'hitch', version: '0.7.0' },
  })
  state.ids.init = id
  return { state, writes: [msg] }
}

export function acpCancel(st: AcpState): Json[] {
  if (!st.sessionId || st.phase !== 'prompt') return []
  return [{ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: st.sessionId } }]
}

function textOf(content: unknown[] | undefined): string {
  const parts: string[] = []
  for (const c of content ?? []) {
    const item = c as Json
    if (item?.type === 'content' && item.content?.type === 'text') parts.push(String(item.content.text ?? ''))
  }
  return parts.join('\n')
}

// A diff block as unified-ish text: removed lines, then added lines.
function diffsOf(content: unknown[] | undefined): string[] {
  const out: string[] = []
  for (const c of content ?? []) {
    const d = c as Json
    if (d?.type !== 'diff') continue
    const old = typeof d.oldText === 'string' ? d.oldText : undefined
    const now = String(d.newText ?? '')
    const lines = [`--- ${old === undefined ? '/dev/null' : d.path}`, `+++ ${d.path}`]
    if (old !== undefined) for (const l of old.split('\n')) lines.push(`-${l}`)
    for (const l of now.split('\n')) lines.push(`+${l}`)
    out.push(lines.join('\n'))
  }
  return out
}

function actionOf(id: string, call: AcpCallState): HarnessAction {
  const kind = call.kind === 'execute' ? 'command' : (call.kind === 'edit' || call.kind === 'write') ? 'file_change' : (call.kind ?? 'tool')
  const failed = call.status === 'failed'
  if (kind === 'command') {
    const command = call.command ?? call.title ?? ''
    const out = textOf(call.content)
    const code = call.exit
    return {
      kind,
      id,
      title: oneLine(command),
      input: { kind, command, ...(code !== undefined && { exit_code: code }) },
      output: `${out}${code ? `${out && !out.endsWith('\n') ? '\n' : ''}(exit ${code})` : ''}` || '(no output)',
      ...((failed || (code !== undefined && code !== 0)) && { isError: true }),
    }
  }
  if (kind === 'file_change') {
    const diffs = diffsOf(call.content)
    return {
      kind,
      id,
      title: call.title ?? 'edit',
      input: { kind, title: call.title },
      output: diffs.join('\n\n') || textOf(call.content) || '(no diff)',
      ...(failed && { isError: true }),
    }
  }
  const text = textOf(call.content) || (call.rawOutput !== undefined ? JSON.stringify(call.rawOutput, null, 2) : '')
  return {
    kind,
    id,
    title: call.title ?? kind,
    input: { kind, title: call.title },
    output: text || '(done)',
    ...(failed && { isError: true }),
  }
}

function onUpdate(st: AcpState, u: Json, out: AcpOutput) {
  switch (u?.sessionUpdate) {
    case 'agent_message_chunk':
      if (u.content?.type === 'text' && u.content.text) out.events.push({ messageChunk: String(u.content.text) })
      return
    case 'agent_thought_chunk':
      if (u.content?.type === 'text' && u.content.text) out.events.push({ thought: String(u.content.text) })
      return
    case 'usage_update': {
      // Devin sends each request's counts twice, the second copy tagged with
      // subagent_context; count the untagged one.
      const m = u._meta ?? {}
      if (m['cognition.ai/subagent_context'] !== undefined) return
      if (typeof m['cognition.ai/inputTokens'] !== 'number') return
      const t = (st.usage ??= { input: 0, cached: 0, output: 0 })
      t.input += Number(m['cognition.ai/inputTokens'] ?? 0)
      t.output += Number(m['cognition.ai/outputTokens'] ?? 0)
      t.cached += Number(m['cognition.ai/cachedReadTokens'] ?? 0)
      // The update also carries the context window's fill after this
      // request: `used` tokens of `size` (when the server reports it).
      const context =
        typeof u.used === 'number'
          ? { used: u.used, ...(typeof u.size === 'number' && { size: u.size }) }
          : undefined
      out.events.push({ usage: { ...t }, ...(context && { context }) })
      return
    }
    case 'plan': {
      const entries = (u.entries ?? []) as Json[]
      const line = entries.map(e => `${e.status === 'completed' ? '✓' : '·'} ${e.content}`).join('  ')
      if (line) out.events.push({ line: `☐ ${clip(line, 200)}` })
      return
    }
    case 'tool_call':
    case 'tool_call_update': {
      const id = String(u.toolCallId ?? '')
      if (!id) return
      const isNew = !st.calls[id]
      const call: AcpCallState = (st.calls[id] ??= {})
      if (u._meta?.['cognition.ai/eventType'] === 'hook_execution') call.isHook = true
      if (u.kind) call.kind = u.kind
      if (u.title) call.title = String(u.title)
      if (typeof u.rawInput?.command === 'string') call.command = u.rawInput.command
      if (Array.isArray(u.content)) call.content = u.content
      if (u.rawInput) {
        call.rawInput = u.rawInput
        call.path = u.rawInput.file_path ?? u.rawInput.path
        call.url = u.rawInput.url
      }
      if (u._meta?.['cognition.ai/inferenceToolName'] === 'write') call.kind = 'write'
      if (u.rawOutput !== undefined) call.rawOutput = u.rawOutput
      const exit = u._meta?.terminal_exit?.exit_code
      if (typeof exit === 'number') call.exit = exit
      if (u.status) call.status = u.status
      if (isNew) {
        const title = clip(oneLine(call.command ?? call.title ?? call.kind ?? 'tool'), 200)
        if (call.isHook) out.events.push({ line: `↪ ${title}` })
        else out.events.push({ line: call.kind === 'execute' ? `$ ${title}` : `⚙ ${title}`, started: { id, title } })
      }
      if (call.status === 'completed' || call.status === 'failed') {
        delete st.calls[id]
        if (!call.isHook) out.events.push({ action: actionOf(id, call) })
      }
      return
    }
    default:
      return
  }
}

function onPermission(st: AcpState, msg: Json, spec: AcpSpec, out: AcpOutput) {
  const p = msg.params ?? {}
  const id = String(p.toolCall?.toolCallId ?? '')
  const known = st.calls[id] ?? {}
  const rawInput = { ...known.rawInput, ...p.toolCall?.rawInput }
  const diff = (p.toolCall?.content ?? known.content ?? []).find((c: Json) => c.type === 'diff')
  const command = p.toolCall?._meta?.['cognition.ai/editableCommand'] ?? rawInput.command ?? known.command
  const call: AcpCall = {
    ...known,
    rawInput,
    path: rawInput.file_path ?? rawInput.path ?? known.path ?? diff?.path,
    url: rawInput.url ?? known.url,
    ...(known.kind && { kind: known.kind }),
    ...(p.toolCall?.kind && { kind: p.toolCall.kind }),
    ...((p.toolCall?.title ?? known.title) && { title: p.toolCall?.title ?? known.title }),
    ...(command && { command }),
  }
  if (p.toolCall?._meta?.['cognition.ai/inferenceToolName'] === 'write') call.kind = 'write'
  if (st.sandbox === 'follow') { out.permission = { msg, call }; return }
  const decision = { allowed: (spec.permit ?? defaultPermit)(call, st.sandbox), who: st.decisionWho ?? 'settings' }
  const answered = acpPermission(st, msg, call, decision)
  out.writes.push(...answered.writes)
  out.events.push(...answered.events)
}

export function acpPermission(st: AcpState, msg: Json, call: AcpCall, decision: { allowed: boolean; who: string; reason?: string }): AcpOutput {
  const out: AcpOutput = { writes: [], events: [] }
  const p = msg.params ?? {}
  const options = (p.options ?? []) as Json[]
  // Never an "always" option: that would change the server's own settings.
  const pick = options.find(o => o.kind === (decision.allowed ? 'allow_once' : 'reject_once'))
  const isAllowed = decision.allowed && Boolean(pick)
  const outcome = pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' }
  out.writes.push({ jsonrpc: '2.0', id: msg.id, result: { outcome } })
  const what = oneLine(String(call.command ?? call.title ?? call.kind ?? 'a tool call'))
  const rule = p.toolCall?._meta?.['cognition.ai/permissionRule']
  out.events.push({
    action: {
      kind: 'permission',
      title: `${isAllowed ? 'allowed' : 'refused'}: ${clip(what, 160)}`,
      input: { kind: 'permission', decision: isAllowed ? 'allow_once' : 'reject_once', request: what, who: decision.who, ...(rule && { rule }) },
      output:
        `${decision.who}${decision.reason ? `: ${decision.reason}` : ''}. ` +
        `${isAllowed ? 'Allowed once' : 'Refused'} (sandbox ${st.sandbox ?? 'default'}${call.kind ? `, tool kind ${call.kind}` : ''})` +
        `${rule ? `; the server's rule: ${rule}` : ''}${pick ? `; option "${pick.name ?? pick.optionId}"` : '; no matching option, so cancelled'}.`,
      ...(!isAllowed && { isError: true }),
    },
  })
  return out
}

function sendPrompt(st: AcpState, out: AcpOutput) {
  const [id, msg] = request(st, 'session/prompt', {
    sessionId: st.sessionId,
    prompt: [{ type: 'text', text: st.prompt ?? '' }],
  })
  st.ids.prompt = id
  st.phase = 'prompt'
  delete st.prompt
  out.writes.push(msg)
}

function afterSession(st: AcpState, out: AcpOutput) {
  if (st.mode) {
    const [id, msg] = request(st, 'session/set_mode', { sessionId: st.sessionId, modeId: st.mode })
    st.ids.mode = id
    st.phase = 'mode'
    out.writes.push(msg)
    return
  }
  sendPrompt(st, out)
}

const errText = (m: Json) => String(m.error?.message ?? JSON.stringify(m.error ?? 'error'))

// One line of the server's stdout.
export function acpHandle(st: AcpState, line: string, spec: AcpSpec): AcpOutput {
  const out: AcpOutput = { writes: [], events: [] }
  let msg: Json
  try {
    msg = JSON.parse(line)
  } catch {
    return out
  }
  if (!msg || typeof msg !== 'object') return out

  // A request from the server: always answered.
  if (msg.method !== undefined && msg.id !== undefined) {
    if (msg.method === 'session/request_permission') onPermission(st, msg, spec, out)
    else out.writes.push({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `${msg.method} is not supported by this client` } })
    return out
  }
  // A notification.
  if (msg.method !== undefined) {
    // Updates before the prompt are session/load's replay of history.
    if (msg.method === 'session/update' && st.phase === 'prompt') onUpdate(st, msg.params?.update, out)
    return out
  }
  // A response to one of ours.
  const id = msg.id
  if (id === st.ids.init) {
    const canLoad = msg.result?.agentCapabilities?.loadSession === true
    if (msg.error) {
      st.phase = 'done'
      out.events.push({ error: `initialize failed: ${errText(msg)}`, end: { reason: 'error' } })
      return out
    }
    if (st.sessionId && canLoad) {
      const [sid, m] = request(st, 'session/load', { sessionId: st.sessionId, cwd: st.cwd, mcpServers: [] })
      st.ids.session = sid
      st.isLoading = true
      out.writes.push(m)
    } else {
      if (st.sessionId) {
        out.events.push({ line: `! the server cannot load session ${st.sessionId}: starting a new one` })
        delete st.sessionId
      }
      const [sid, m] = request(st, 'session/new', { cwd: st.cwd, mcpServers: [] })
      st.ids.session = sid
      out.writes.push(m)
    }
    st.phase = 'session'
    return out
  }
  if (id === st.ids.session) {
    if (msg.error) {
      if (st.isLoading) {
        out.events.push({ line: `! could not load session ${st.sessionId} (${errText(msg)}): starting a new one` })
        delete st.sessionId
        st.isLoading = false
        const [sid, m] = request(st, 'session/new', { cwd: st.cwd, mcpServers: [] })
        st.ids.session = sid
        out.writes.push(m)
        return out
      }
      st.phase = 'done'
      out.events.push({ error: `session/new failed: ${errText(msg)}`, end: { reason: 'error' } })
      return out
    }
    if (!st.isLoading) st.sessionId = String(msg.result?.sessionId ?? '')
    if (!st.sessionId) {
      st.phase = 'done'
      out.events.push({ error: 'the server answered session/new with no sessionId', end: { reason: 'error' } })
      return out
    }
    out.events.push({ sessionId: st.sessionId })
    afterSession(st, out)
    return out
  }
  if (id === st.ids.mode) {
    if (msg.error && (st.sandbox === 'read-only' || st.sandbox === 'follow')) {
      // Fail closed: without the read-only mode, edits would be auto-approved.
      st.phase = 'done'
      out.events.push({ error: `could not switch the session to ${st.mode} mode for the read-only sandbox: ${errText(msg)}`, end: { reason: 'error' } })
      return out
    }
    if (msg.error) out.events.push({ line: `! session/set_mode ${st.mode} failed: ${errText(msg)}` })
    sendPrompt(st, out)
    return out
  }
  if (id === st.ids.prompt) {
    st.phase = 'done'
    if (msg.error) {
      out.events.push({ error: errText(msg), end: { reason: 'error' } })
      return out
    }
    const u = msg.result?.usage
    if (st.usage) out.events.push({ usage: { ...st.usage } })
    else if (u) {
      out.events.push({
        usage: { input: Number(u.inputTokens ?? 0), cached: Number(u.cachedReadTokens ?? 0), output: Number(u.outputTokens ?? 0) },
      })
    }
    out.events.push({ end: { reason: String(msg.result?.stopReason ?? 'end_turn') } })
    return out
  }
  return out
}
