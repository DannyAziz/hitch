// Cursor (cli-jsonl) against its recorded fixture: rows, resume, options,
// errors, and the parser on every recorded line.

import { expect, test } from 'claude-code/testing'

import { AGENT, answerRow, agentInfo, boot, drain, harnessArgv, lines, spawnInput, step, world } from '../../../tests/world'
import { FILE, FIRST, FOLLOW_UP, SESSION, fixture } from './fixture'
import { cursor } from './index'
import { parseCursor } from './parse'

const TYPE = 'hitch:cursor'

// A synthetic minimal Cursor turn: one message, no actions.
const PONG = lines(
  { type: 'system', subtype: 'init', session_id: SESSION },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'pong' }] } },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'pong',
    session_id: SESSION,
    usage: { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 0 },
  },
)

test('the parser on the recorded stream: session, messages, started and finished actions, usage', () => {
  const memo = {}
  const events = FIRST.map(line => parseCursor(line, memo))
  expect(events[0]).toEqual({ sessionId: SESSION })
  expect(events.filter(e => e.message !== undefined).map(e => e.message?.trim())).toEqual([
    'Creating `notes.txt`, then running `cat notes.txt`.',
    'done',
  ])
  expect(events.filter(e => e.started).map(e => e.started?.title)).toEqual([FILE, 'cat notes.txt'])
  expect(events.filter(e => e.action).map(e => e.action?.kind)).toEqual(['file_change', 'command'])
  const edit = events.filter(e => e.action)[0]?.action
  expect(edit?.title).toBe(`add ${FILE}`)
  expect(edit?.output).toContain('--- /dev/null')
  expect(edit?.output).toContain('+alpha')
  const cmd = events.filter(e => e.action)[1]?.action
  expect(cmd?.title).toBe('cat notes.txt')
  expect(cmd?.output).toBe('alpha\n')
  expect(events.at(-1)?.usage).toEqual({ input: 9592, cached: 17024, output: 166 })
  // Thinking deltas are joined: one live line per thinking block, none per fragment.
  const live = events.filter(e => e.line !== undefined).map(e => e.line)
  expect(live.filter(l => l?.startsWith('· ')).length).toBe(2)
  expect(live.filter(l => !l?.startsWith('· '))).toEqual([`✎ ${FILE}`, '$ cat notes.txt'])
  const followMemo = {}
  const follow = FOLLOW_UP.map(line => parseCursor(line, followMemo))
  expect(follow.filter(e => e.message !== undefined).map(e => e.message?.trim())).toEqual(['notes.txt'])
  expect(follow.at(-1)?.usage).toEqual({ input: 84, cached: 13440, output: 26 })
})

test('a Cursor turn becomes rows: the edit, then the command with its real output; the last step only the closing message', async ($, on) => {
  const w = world(on, FIRST)
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Create notes.txt', turnId: 't1', agentId: AGENT })

  // Step 0: the opening message and thinking lines, then the edit as a row.
  const s0 = await drain($.turn.step(step()))
  expect(s0.result.stopReason).toBe('tool_use')
  expect(s0.result.usage).toBe(null)
  expect(s0.result.toolUses).toEqual([
    { name: 'HitchLog', input: { harness: 'cursor', kind: 'file_change', path: FILE, title: `add ${FILE}` } },
  ])
  expect(s0.result.answer).toContain('Creating `notes.txt`')
  const r0 = await answerRow($, s0.chunks)
  expect(r0.result).toContain('--- /dev/null')
  expect(r0.result).toContain('+alpha')

  // Launched detached: agent argv, the prompt as the positional argument
  // (the CLI's verified form), the agent's cwd.
  expect(w.launches.length).toBe(1)
  expect(harnessArgv(w.launches[0])).toEqual([
    '/mock/bin/agent', '-p', '--output-format', 'stream-json',
    '--model', 'auto', '--force', '--trust', 'Create notes.txt',
  ])
  expect(w.launches[0]?.cwd).toBe('/repo')
  const dir = String(w.launches[0]?.argv[3])
  expect(dir.startsWith(`/scratch/hitch/${AGENT}/turn-1-`)).toBe(true)
  expect(w.written.get(`${dir}/input`)).toBe('')

  // Step 1: the command, with its real output.
  const s1 = await drain($.turn.step(step({ index: 1, messageCount: 3 })))
  expect(s1.result.toolUses).toEqual([
    { name: 'HitchLog', input: { harness: 'cursor', kind: 'command', command: 'cat notes.txt', exit_code: 0, title: 'cat notes.txt' } },
  ])
  expect((await answerRow($, s1.chunks)).result).toBe('alpha\n')

  // Step 2: only the closing message, end_turn.
  const s2 = await drain($.turn.step(step({ index: 2, messageCount: 5 })))
  expect(s2.result.stopReason).toBe('end_turn')
  expect(s2.result.answer).toBe('done')
  expect(s2.result.toolUses).toEqual([])
  expect(s2.chunks.filter(c => c.kind === 'text').map(c => (c as { text: string }).text)).toEqual(['done'])
  expect(s2.chunks.at(-1)).toEqual({ kind: 'stop', stopReason: 'end_turn', usage: null })

  // Nothing went to Claude, no tool ran, no permission path was raised.
  expect(w.sent).toEqual([])
  expect(w.toolRan).toEqual([])
  expect(w.launches.length).toBe(1)
  const saved = w.store.get(`hitch:agent:${AGENT}`) as any
  expect(saved.sessionId).toBe(SESSION)
  expect(saved.turns).toBe(1)
  expect(saved.run).toBe(undefined)
})

test('a SendMessage follow-up resumes the Cursor session: --resume <session_id>', async ($, on) => {
  const w = world(on, PONG)
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Reply pong', turnId: 't1', agentId: AGENT })
  expect((await drain($.turn.step(step()))).result.answer).toBe('pong')

  w.stream = FOLLOW_UP
  await $.agent.spawn({ ...spawnInput(TYPE), prompt: 'Again', permissionMode: 'default', resume: { agentId: AGENT } })
  await $.turn.start({ text: 'Again', turnId: 't2', agentId: AGENT })
  const { result } = await drain($.turn.step(step({ turnId: 't2' })))
  const argv = harnessArgv(w.launches[1])
  expect(argv).toEqual([
    '/mock/bin/agent', '-p', '--output-format', 'stream-json',
    '--model', 'auto', '--force', '--trust',
    '--resume', SESSION, 'Again',
  ])
  expect(result.answer).toBe('notes.txt')
  expect(w.sent).toEqual([])
})

test('Cursor effort swaps the tier in the model name, before -fast too; a name with no tier passes as set', () => {
  const cli = cursor.transports['cli-jsonl']!
  const spec = { prompt: 'p', sandbox: 'read-only' }
  const model = (argv: string[]) => argv[argv.indexOf('--model') + 1]
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
    expect(model(cli.start({ ...spec, model: 'gemini-4-neon-high', effort }).argv)).toBe(`gemini-4-neon-${effort}`)
    expect(model(cli.resume!({ ...spec, model: 'gpt-5.6-sol-high-fast', sessionId: SESSION, effort }).argv)).toBe(`gpt-5.6-sol-${effort}-fast`)
    expect(model(cli.start({ ...spec, model: 'auto', effort }).argv)).toBe('auto')
    expect(model(cli.start({ ...spec, model: 'composer-2.5-fast', effort }).argv)).toBe('composer-2.5-fast')
  }
  // No effort on the call: the configured name, tier and all.
  expect(model(cli.start({ ...spec, model: 'gemini-4-neon-high' }).argv)).toBe('gemini-4-neon-high')
})

test('Cursor effort xhigh runs gemini-4-neon-xhigh when cursorModel is gemini-4-neon-high', { options: { cursorModel: 'gemini-4-neon-high' } }, async ($, on) => {
  const w = world(on, PONG)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, TYPE, { effort: 'xhigh' }))
  await $.turn.start({ text: 'p', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  const argv = harnessArgv(w.launches[0])
  expect(argv[argv.indexOf('--model') + 1]).toBe('gemini-4-neon-xhigh')
})

test('a first line "model: <name>" picks the model for the agent, is not sent to Cursor, and holds for the follow-up', async ($, on) => {
  const w = world(on, PONG)
  await boot($, w, TYPE)
  await $.turn.start({ text: 'model: gemini-4-carbon-high\n\nReply pong', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  expect(harnessArgv(w.launches[0])).toEqual([
    '/mock/bin/agent', '-p', '--output-format', 'stream-json',
    '--model', 'gemini-4-carbon-high', '--force', '--trust', 'Reply pong',
  ])
  expect((w.store.get(`hitch:agent:${AGENT}`) as any).model).toBe('gemini-4-carbon-high')

  w.stream = FOLLOW_UP
  await $.agent.spawn({ ...spawnInput(TYPE), prompt: 'Again', permissionMode: 'default', resume: { agentId: AGENT } })
  await $.turn.start({ text: 'Again', turnId: 't2', agentId: AGENT })
  await drain($.turn.step(step({ turnId: 't2' })))
  const argv = harnessArgv(w.launches[1])
  expect(argv[argv.indexOf('--model') + 1]).toBe('gemini-4-carbon-high')
  expect(argv.at(-1)).toBe('Again')
  expect(w.sent).toEqual([])
})

test('a cursorModel with no tier passes to --model as is whatever the effort; read-only is --mode ask without --force', { options: { cursorModel: 'composer-1', cursorSandbox: 'read-only' } }, async ($, on) => {
  const w = world(on, PONG)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, TYPE, { effort: 'max', cwd: '/repo/.claude/worktrees/x' }))
  await $.turn.start({ text: 'p', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  const argv = harnessArgv(w.launches[0])
  expect(argv).toEqual([
    '/mock/bin/agent', '-p', '--output-format', 'stream-json',
    '--model', 'composer-1', '--mode', 'ask', '--trust', 'p',
  ])
  expect(argv).not.toContain('--force')
  expect(w.launches[0]?.cwd).toBe('/repo/.claude/worktrees/x')
})

test('Cursor reporting an error ends the turn with it, without Claude', async ($, on) => {
  const w = world(on, lines(
    { type: 'system', subtype: 'init', session_id: SESSION },
    { type: 'result', subtype: 'error', is_error: true, result: 'model auto is not available', session_id: SESSION },
  ))
  w.end = '__hitch_exit__ code 1'
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  const { result } = await drain($.turn.step(step()))
  expect(result.stopReason).toBe('end_turn')
  expect(result.answer).toContain('not available')
  expect(w.sent).toEqual([])
})
