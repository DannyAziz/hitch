// Devin: over ACP (the default transport) against its recorded fixture, and
// the cli-text print mode (option devinTransport), which is also the test of
// the generic cli-text transport.

import { expect, test } from 'claude-code/testing'
import type { TurnStepChunk, TurnStepResult } from 'claude-code'

import { AGENT, type World, answerRow, agentInfo, drain, harnessArgv, spawnInput, step, world } from '../../../tests/world'
import { acpHandle, acpOpen } from '../../transports/acp'
import { devin } from './index'
import { FIRST, FOLLOW_UP, SESSION, fixture } from './fixture'

const TEXT = { options: { devinTransport: 'cli-text' } }

const DTYPE = 'hitch:devin'

const DEVIN_STREAM = [
  'I read the task and looked at a.txt.',
  'Patched a.txt and ran the tests: 3 passed.',
  '',
  'Done — a.txt is patched and the suite is green.',
]
const DEVIN_ANSWER = DEVIN_STREAM.join('\n').trim()

async function bootDevin($: any, w: World, permissionMode = 'default') {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, DTYPE))
  await $.agent.spawn({ ...spawnInput(DTYPE), permissionMode })
}


test('cli-text (Devin print mode): devin argv carries the prompt as an element; the whole stdout is the report', TEXT, async ($, on) => {
  const w = world(on, DEVIN_STREAM, fixture.shell)
  await bootDevin($, w)
  await $.turn.start({ text: 'Patch a.txt', turnId: 't1', agentId: AGENT })
  const { chunks, result } = await drain($.turn.step(step()))
  expect(result.stopReason).toBe('end_turn')
  expect(result.answer).toBe(DEVIN_ANSWER)
  expect(result.toolUses).toEqual([])
  expect(result.usage).toBe(null)
  const thoughts = chunks.filter(c => c.kind === 'thinking').map(c => (c as { text: string }).text).join('')
  expect(thoughts).toContain('starting Devin…')
  expect(thoughts).toContain('Patched a.txt and ran the tests: 3 passed.')
  expect(chunks.filter(c => c.kind === 'text').map(c => (c as { text: string }).text)).toEqual([DEVIN_ANSWER])

  // Launched detached, devin argv, prompt on argv (input file stays empty).
  expect(w.launches.length).toBe(1)
  expect(harnessArgv(w.launches[0])).toEqual([
    '/mock/bin/devin', '--model', 'swe-2-flash-high',
    '--permission-mode', 'smart',
    '--respect-workspace-trust', 'false',
    '-p', 'Patch a.txt',
  ])
  const dir = String(w.launches[0]?.argv[3])
  expect(dir.startsWith(`/scratch/hitch/${AGENT}/turn-1-`)).toBe(true)
  expect(w.written.get(`${dir}/input`)).toBe('')

  // No session, one turn, nothing went to Claude, no tool ran.
  const saved = w.store.get(`hitch:agent:${AGENT}`) as any
  expect(saved.turns).toBe(1)
  expect(saved.sessionId).toBe(undefined)
  expect(saved.run).toBe(undefined)
  expect(w.sent).toEqual([])
  expect(w.toolRan).toEqual([])
})

test('cli-text: Devin effort high runs swe-2-flash-high (effort is the model suffix)', TEXT, async ($, on) => {
  const w = world(on, DEVIN_STREAM, fixture.shell)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, DTYPE, { type: DTYPE, effort: 'high' }))
  await $.agent.spawn({ ...spawnInput(DTYPE), permissionMode: 'default' })
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  const argv = harnessArgv(w.launches[0])
  expect(argv).toContain('swe-2-flash-high')
  expect(argv).not.toContain('swe-2-flash-max')
  expect(w.sent).toEqual([])
})

test('cli-text: Devin effort swaps only the free swe-2 suffix; other model names pass as set', { options: { devinModel: 'swe-2-high', devinTransport: 'cli-text' } }, async ($, on) => {
  const w = world(on, DEVIN_STREAM, fixture.shell)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, DTYPE, { type: DTYPE, effort: 'xhigh' }))
  await $.agent.spawn({ ...spawnInput(DTYPE), permissionMode: 'default' })
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  const argv = harnessArgv(w.launches[0])
  expect(argv).toContain('swe-2-max')
  expect(argv).not.toContain('swe-2-high')
  expect(w.sent).toEqual([])
})

test('cli-text: a first line "model: <name>" picks Devin\'s model and is not sent to it', TEXT, async ($, on) => {
  const w = world(on, DEVIN_STREAM, fixture.shell)
  await bootDevin($, w)
  await $.turn.start({ text: 'model: gemini-4-neon\nx', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  const argv = harnessArgv(w.launches[0])
  expect(argv[argv.indexOf('--model') + 1]).toBe('gemini-4-neon')
  expect(argv.at(-1)).toBe('x')
  expect(argv).not.toContain('swe-2-flash-high')
  expect(w.sent).toEqual([])
})

test('cli-text: a SendMessage follow-up is refused: it cannot be continued', TEXT, async ($, on) => {
  const w = world(on, DEVIN_STREAM, fixture.shell)
  await bootDevin($, w)
  await $.turn.start({ text: 'Patch a.txt', turnId: 't1', agentId: AGENT })
  expect((await drain($.turn.step(step()))).result.answer).toBe(DEVIN_ANSWER)

  await $.agent.spawn({ ...spawnInput(DTYPE), prompt: 'Again', permissionMode: 'default', resume: { agentId: AGENT } })
  await $.turn.start({ text: 'Again', turnId: 't2', agentId: AGENT })
  const { result } = await drain($.turn.step(step({ turnId: 't2' })))
  expect(result.stopReason).toBe('end_turn')
  expect(result.answer).toContain('Devin cannot be continued')
  expect(result.answer).toContain('hitch:devin')
  expect(w.launches.length).toBe(1)
  expect(w.sent).toEqual([])
})

// ---------------------------------------------------------------- Devin over ACP (the default)

test('ACP usage_update reports the context fill (used of size) from the untagged copy only', () => {
  const spec = devin.transports.acp!
  const st = acpOpen({ cwd: '/work', prompt: 'p', mode: spec.mode?.('workspace-write') }).state
  const events = FIRST.flatMap(line => acpHandle(st, line, spec).events)
  expect(events.filter(e => e.context).map(e => e.context)).toEqual([
    { used: 15078, size: 262144 },
    { used: 15283, size: 262144 },
    { used: 15309, size: 262144 },
  ])
})

async function devinTurn($: any, w: World, turnId: string, text: string) {
  await $.turn.start({ text, turnId, agentId: AGENT })
  const steps: { chunks: TurnStepChunk[]; result: TurnStepResult }[] = []
  for (let i = 0; i < 10; i++) {
    const s = await drain($.turn.step(step({ turnId, index: i })))
    steps.push(s)
    if (s.result.stopReason !== 'tool_use') break
    await answerRow($, s.chunks)
  }
  return steps
}

test('ACP: a Devin turn from the recorded server output: rows for the edit, the permission and the command; the report is only "done"', async ($, on) => {
  const w = world(on, FIRST, fixture.shell)
  await bootDevin($, w)
  const steps = await devinTurn($, w, 't1', 'Create notes.txt …')

  // Launched as a two-way relay around `devin acp`, in-process.
  expect(w.launches[0]?.argv[4]).toBe('tail')
  expect(harnessArgv(w.launches[0])).toEqual(['/mock/bin/devin', 'acp', '--process-model', 'in-process', '--model', 'swe-2-flash-high'])
  const dir = String(w.launches[0]?.argv[3])
  const opened = String(w.written.get(`${dir}/in`)).trim().split('\n').map(l => JSON.parse(l))
  expect(opened.map((m: any) => m.method)).toEqual(['initialize'])
  // The handshake the client wrote as the server answered.
  expect(w.inWrites.filter(m => m.method).map(m => m.method)).toEqual(['session/new', 'session/set_mode', 'session/prompt'])
  expect(w.inWrites.find(m => m.method === 'session/set_mode').params).toEqual({ sessionId: SESSION, modeId: 'ask' })
  expect(w.inWrites.find(m => m.method === 'session/prompt').params.prompt).toEqual([{ type: 'text', text: 'Create notes.txt …' }])

  // Four steps: three rows, then the closing text.
  expect(steps.map(s => s.result.stopReason)).toEqual(['tool_use', 'tool_use', 'tool_use', 'end_turn'])
  const rows = steps.slice(0, 3).map(s => s.result.toolUses[0]!)
  expect(rows.every(r => r.name === 'HitchLog')).toBe(true)
  expect(rows.map(r => (r.input as any).kind)).toEqual(['file_change', 'permission', 'command'])
  expect((rows[1]!.input as any).decision).toBe('allow_once')
  expect((rows[2]!.input as any).command).toBe('mkdir -p out && cp notes.txt out/ && cat out/notes.txt')
  // The permission request was answered with allow_once (never an "always").
  const answer = w.inWrites.find(m => m.id !== undefined && m.result?.outcome)
  expect(answer.result.outcome).toEqual({ outcome: 'selected', optionId: 'allow_once' })
  expect(steps[3]!.result.answer).toBe('done\n\n[hitch] Devin context: 15.3k of 262.1k tokens (6% full).')
  // The server is stopped once its prompt is answered; the session is kept.
  expect(w.runs).toContainEqual(['kill', '-TERM', '4242'])
  const saved = w.store.get(`hitch:agent:${AGENT}`) as any
  expect(saved.sessionId).toBe(SESSION)
  expect(saved.tokens).toBeGreaterThan(0)
  expect(w.sent).toEqual([])
  expect(w.toolRan).toEqual([])
})

test('ACP: the row results are the real content (diff, decision, command output)', async ($, on) => {
  const w = world(on, FIRST, fixture.shell)
  await bootDevin($, w)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  const s0 = await drain($.turn.step(step()))
  expect(String((await answerRow($, s0.chunks)).result)).toContain('+alpha')
  const s1 = await drain($.turn.step(step({ index: 1 })))
  expect(String((await answerRow($, s1.chunks)).result)).toContain('Allowed once')
  const s2 = await drain($.turn.step(step({ index: 2 })))
  expect((await answerRow($, s2.chunks)).result).toBe('alpha')
})

test('ACP: a SendMessage follow-up loads the same Devin session; the replayed history is not repeated', async ($, on) => {
  const w = world(on, FIRST, fixture.shell)
  await bootDevin($, w)
  await devinTurn($, w, 't1', 'Create notes.txt …')

  w.stream = FOLLOW_UP
  w.inWrites = []
  await $.agent.spawn({ ...spawnInput(DTYPE), prompt: 'Which file?', permissionMode: 'default', resume: { agentId: AGENT } })
  const steps = await devinTurn($, w, 't2', 'Which file did you create first?')
  expect(w.launches.length).toBe(2)
  const load = w.inWrites.find(m => m.method === 'session/load')
  expect(load.params.sessionId).toBe(SESSION)
  expect(w.inWrites.some(m => m.method === 'session/new')).toBe(false)
  expect(steps.length).toBe(1)
  expect(steps[0]!.result.answer).toBe('notes.txt\n\n[hitch] Devin context: 15.3k of 262.1k tokens (6% full).')
  expect(w.sent).toEqual([])
})

test('ACP read-only: Ask mode, and a command permission is refused (and recorded)', { options: { devinSandbox: 'read-only' } }, async ($, on) => {
  const w = world(on, FIRST, fixture.shell)
  await bootDevin($, w)
  const steps = await devinTurn($, w, 't1', 'x')
  expect(w.inWrites.find(m => m.method === 'session/set_mode').params.modeId).toBe('ask')
  const answer = w.inWrites.find(m => m.id !== undefined && m.result?.outcome)
  expect(answer.result.outcome).toEqual({ outcome: 'selected', optionId: 'reject_once' })
  const perm = steps.map(s => s.result.toolUses[0]).find(r => (r?.input as any)?.kind === 'permission')
  expect((perm?.input as any).decision).toBe('reject_once')
  expect(perm?.input && String((perm.input as any).title)).toContain('refused')
})

test('ACP: any other server request is answered (method not found), never left hanging', async ($, on) => {
  const w = world(on, [
    ...FIRST.slice(0, 3),
    JSON.stringify({ jsonrpc: '2.0', id: 'q1', method: 'fs/read_text_file', params: { path: '/etc/hosts' } }),
    ...FIRST.slice(3),
  ])
  await bootDevin($, w)
  await devinTurn($, w, 't1', 'x')
  const reply = w.inWrites.find(m => m.id === 'q1')
  expect(reply.error.code).toBe(-32601)
})

test('ACP stop: session/cancel first, then the supervisor is stopped', async ($, on) => {
  const w = world(on, FIRST.slice(0, 7), fixture.shell)
  w.end = ''
  await bootDevin($, w)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  const stream = $.turn.step(step())
  for (let i = 0; i < 3; i++) await stream.next()
  await stream.return(undefined as never)
  expect(w.inWrites.some(m => m.method === 'session/cancel' && m.params.sessionId === SESSION)).toBe(true)
  expect(w.runs.some(r => String(r[2]).includes('sleep 3; kill') && r[4] === '4242')).toBe(true)
  expect(w.delegations.at(-1)?.outcome).toBe('stopped')
})
