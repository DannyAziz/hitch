// Context fullness end to end: the `context` a parser reports lands on the
// agent, the finished turn's answer carries one "[hitch] … context:" line
// (with the window size when the harness reports it), the agent row shows
// "ctx …", and the value survives a reload. Codex and Cursor report only
// turn totals, so they emit no context at all.

import { expect, test } from 'claude-code/testing'
import type { TurnStepChunk, TurnStepResult } from 'claude-code'

import { type ParserMemo, jsonlEvents } from '../hooks/transports/cli-jsonl'
import { amp } from '../hooks/harnesses/amp'
import { FIRST as AMP_FIRST } from '../hooks/harnesses/amp/fixture'
import { codex } from '../hooks/harnesses/codex'
import { FIRST as CODEX_FIRST, THREAD } from '../hooks/harnesses/codex/fixture'
import { cursor } from '../hooks/harnesses/cursor'
import { FIRST as CURSOR_FIRST } from '../hooks/harnesses/cursor/fixture'
import { FIRST as DEVIN_FIRST, FOLLOW_UP as DEVIN_FOLLOW_UP } from '../hooks/harnesses/devin/fixture'
import { AGENT, type World, agentInfo, answerRow, boot, drain, lines, spawnInput, step, world } from './world'

async function turn($: any, w: World, turnId: string, text: string, agentId = AGENT) {
  await $.turn.start({ text, turnId, agentId })
  const steps: { chunks: TurnStepChunk[]; result: TurnStepResult }[] = []
  for (let i = 0; i < 20; i++) {
    const s = await drain($.turn.step(step({ turnId, index: i, agentId })))
    steps.push(s)
    if (s.result.stopReason !== 'tool_use') break
    await answerRow($, s.chunks, agentId)
  }
  return steps
}

// The engine's own render is an opaque ref in tests: a handler beneath the
// plugin's sees the props (label included) the hook passes to next(). Hooks
// beneath the plugins register before the test's first $ call, so this must
// run before world()/boot().
const watchRows = (on: any) => {
  const labels = new Map<string, string>()
  on('ui.render', { component: 'AgentRow' }, (_: any, e: any, next: any) => {
    labels.set(String(e.props?.type), String(e.props?.label ?? ''))
    return next(e)
  })
  return labels
}

const renderRow = ($: any, agentId: string, type: string) =>
  $.ui.render({
    surface: 'terminal',
    component: 'AgentRow',
    requestId: 'r1',
    props: { id: agentId, type },
  } as any)

test('Devin over ACP: the answer line carries used of size, the row shows ctx %, and it persists', async ($, on) => {
  const labels = watchRows(on)
  const w = world(on, DEVIN_FIRST)
  await boot($, w, 'hitch:devin')
  const steps = await turn($, w, 't1', 'the task')
  const last = steps.at(-1)!
  expect(last.result.answer).toBe('done\n\n[hitch] Devin context: 15.3k of 262.1k tokens (6% full).')
  // The line reaches Claude as a text block after the report's own.
  const texts = last.chunks.filter(c => c.kind === 'text').map(c => (c as { text: string }).text)
  expect(texts.at(-1)).toBe('\n\n[hitch] Devin context: 15.3k of 262.1k tokens (6% full).')
  // Saved on the agent.
  const saved = w.store.get(`hitch:agent:${AGENT}`) as any
  expect(saved.context).toEqual({ used: 15309, size: 262144 })
  expect(saved.tokens).toBeGreaterThan(0)
  // The row.
  await renderRow($, AGENT, 'hitch:devin')
  expect(labels.get('hitch:devin')).toContain('ctx 6%')
})

// The text Claude gets back: the last text block, its chunks joined.
const lastTextBlock = (chunks: TurnStepChunk[]) => {
  const texts = chunks.filter(c => c.kind === 'text') as { index: number; text: string }[]
  const index = texts.at(-1)?.index
  return texts.filter(c => c.index === index).map(c => c.text).join('')
}

test('a live line after the report (a Devin hook) still leaves the whole report in the last text block', async ($, on) => {
  const at = DEVIN_FIRST.findLastIndex(l => l.includes('agent_message_chunk'))
  const hook =
    '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"fixture-session","update":{"sessionUpdate":"tool_call","toolCallId":"hook-1","title":"Ran hook: status","_meta":{"cognition.ai/eventType":"hook_execution"}}}}'
  const w = world(on, [...DEVIN_FIRST.slice(0, at + 1), hook, ...DEVIN_FIRST.slice(at + 1)])
  await boot($, w, 'hitch:devin')
  const last = (await turn($, w, 't1', 'the task')).at(-1)!
  const answer = 'done\n\n[hitch] Devin context: 15.3k of 262.1k tokens (6% full).'
  expect(last.result.answer).toBe(answer)
  expect(lastTextBlock(last.chunks).trim()).toBe(answer)
})

test('without a live line after it, the context line joins the report\'s own text block', async ($, on) => {
  const w = world(on, DEVIN_FIRST)
  await boot($, w, 'hitch:devin')
  const last = (await turn($, w, 't1', 'the task')).at(-1)!
  expect(lastTextBlock(last.chunks).trim()).toBe('done\n\n[hitch] Devin context: 15.3k of 262.1k tokens (6% full).')
})

test('Amp: the answer line has no size and the row shows ctx Nk', async ($, on) => {
  const labels = watchRows(on)
  const w = world(on, AMP_FIRST)
  await boot($, w, 'hitch:amp')
  const steps = await turn($, w, 't1', 'the task')
  const last = steps.at(-1)!
  expect(last.result.answer).toBe('done\n\n[hitch] Amp context: 58.7k tokens.')
  const saved = w.store.get(`hitch:agent:${AGENT}`) as any
  expect(saved.context).toEqual({ used: 58708 })
  await renderRow($, AGENT, 'hitch:amp')
  expect(labels.get('hitch:amp')).toContain('ctx 58.7k')
})

test('Codex and Cursor report only turn totals: no context events, no line, no ctx in the row', async ($, on) => {
  const labels = watchRows(on)
  for (const [cli, fx] of [
    [codex.transports['cli-jsonl']!, CODEX_FIRST],
    [cursor.transports['cli-jsonl']!, CURSOR_FIRST],
  ] as const) {
    const memo: ParserMemo = {}
    for (const line of fx) for (const e of jsonlEvents(cli, line, memo)) expect(e.context).toBe(undefined)
  }
  const PONG = lines(
    { type: 'thread.started', thread_id: THREAD },
    { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'pong' } },
    { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 20 } },
  )
  const w = world(on, PONG)
  await boot($, w, 'hitch:codex')
  await $.turn.start({ text: 'Reply pong', turnId: 't1', agentId: AGENT })
  const { result } = await drain($.turn.step(step()))
  expect(result.answer).toBe('pong')
  const saved = w.store.get(`hitch:agent:${AGENT}`) as any
  expect(saved.context).toBe(undefined)
  expect(saved.tokens).toBe(1020)
  await renderRow($, AGENT, 'hitch:codex')
  const label = labels.get('hitch:codex') ?? ''
  expect(label).not.toMatch(/\bctx\b/)
  expect(label).not.toMatch(/\btok\b/)
})

test('context survives a reload: restored from the store, updated by the next turn', async ($, on) => {
  const w = world(on, DEVIN_FIRST)
  await boot($, w, 'hitch:devin')
  await turn($, w, 't1', 'the task')
  const saved = JSON.parse(JSON.stringify(w.store.get(`hitch:agent:${AGENT}`)))
  expect(saved.context).toEqual({ used: 15309, size: 262144 })

  // A fresh agent id holding only persisted state, as after a mod reload.
  w.store.set('hitch:agent:reloaded', { ...saved, agentId: 'reloaded' })
  w.agents.push(agentInfo('reloaded', 'hitch:devin'))
  w.stream = DEVIN_FOLLOW_UP
  await $.agent.spawn({ ...spawnInput('hitch:devin'), prompt: 'Which file?', permissionMode: 'default', resume: { agentId: 'reloaded' } })
  const steps = await turn($, w, 't2', 'Which file?', 'reloaded')
  expect(steps.at(-1)!.result.answer).toBe('notes.txt\n\n[hitch] Devin context: 15.3k of 262.1k tokens (6% full).')
  const again = w.store.get('hitch:agent:reloaded') as any
  expect(again.context).toEqual({ used: 15339, size: 262144 })
})

test('a turn that reports no context leaves the previous value (and the line still shows it)', { options: { devinTransport: 'cli-text' } }, async ($, on) => {
  const w = world(on, ['I did the thing.', '', 'All done.'])
  w.store.set(`hitch:agent:${AGENT}`, {
    agentId: AGENT,
    key: 'devin',
    model: 'swe-2-flash-high',
    turns: 0,
    tokens: 0,
    context: { used: 5, size: 10 },
  })
  await boot($, w, 'hitch:devin')
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  const { result } = await drain($.turn.step(step()))
  expect(result.answer).toBe('I did the thing.\n\nAll done.\n\n[hitch] Devin context: 5 of 10 tokens (50% full).')
  const saved = w.store.get(`hitch:agent:${AGENT}`) as any
  expect(saved.context).toEqual({ used: 5, size: 10 })
})
