// Cursor (cli-jsonl) against its recorded fixture: rows, resume, options,
// errors, and the parser on every recorded line.

import { expect, test } from 'claude-code/testing'

import { AGENT, answerRow, agentInfo, boot, drain, harnessArgv, lines, spawnInput, step, world } from '../../../tests/world'
import { FILE, FIRST, FOLLOW_UP, SESSION, fixture } from './fixture'
import { cursor, cursorRunModel, parseCursorModels } from './index'
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

// A short `agent models` listing, in the CLI's layout (Cursor CLI 2026.11.19).
const MODELS = [
  'Available models',
  '',
  'auto - Auto (current, default)',
  'gemini-4-neon-low - Gemini 4 Neon  Low',
  'gemini-4-neon-medium - Gemini 4 Neon  Medium',
  'gemini-4-neon-high - Gemini 4 Neon  High',
  'gemini-4-neon-xhigh - Gemini 4 Neon  Extra High',
  'gemini-4-carbon-low - Gemini 4 Carbon  Low',
  'gemini-4-carbon-high - Gemini 4 Carbon  High',
  'gpt-5.3-codex-low - Codex 5.3 Low',
  'gpt-5.3-codex - Codex 5.3',
  'gpt-5.3-codex-high - Codex 5.3 High',
  'gpt-5.3-codex-high-fast - Codex 5.3 High Fast',
  'gpt-5.3-codex-fast - Codex 5.3 Fast',
  'gpt-5.6-sol-high-fast - GPT-5.6 Sol 1M High Fast',
  'gpt-5.6-sol-xhigh-fast - GPT-5.6 Sol 1M Extra High Fast',
  'gpt-5.5-extra-high - GPT-5.5 1M Extra High',
  'claude-opus-5-5-max - Claude Opus 5.5 1M Max',
  'composer-2.5-fast - Composer 2.5 Fast',
  '',
  "Tip: use --model <id> (or /model <id> in interactive mode) to switch.",
].join('\n')
const NAMES = new Set(parseCursorModels(MODELS))

test('parseCursorModels reads each id, not the header or the tip', () => {
  expect(NAMES.has('auto')).toBe(true)
  expect(NAMES.has('gpt-5.3-codex')).toBe(true)
  expect(NAMES.size).toBe(17)
})

test('Cursor effort swaps the configured tier only to a name Cursor lists; a named model runs as named', () => {
  const run = (model: string, effort: any, isPicked = false) => cursorRunModel(model, effort, { isPicked, names: NAMES }).model
  expect(run('gemini-4-neon-high', 'xhigh')).toBe('gemini-4-neon-xhigh')
  expect(run('gemini-4-neon-high', 'low')).toBe('gemini-4-neon-low')
  // Carbon has no xhigh: the name runs as set.
  expect(run('gemini-4-carbon-high', 'xhigh')).toBe('gemini-4-carbon-high')
  // Before -fast; a medium that is the bare name; and back from it.
  expect(run('gpt-5.6-sol-high-fast', 'xhigh')).toBe('gpt-5.6-sol-xhigh-fast')
  expect(run('gpt-5.3-codex-high', 'medium')).toBe('gpt-5.3-codex')
  expect(run('gpt-5.3-codex-high-fast', 'medium')).toBe('gpt-5.3-codex-fast')
  expect(run('gpt-5.3-codex', 'high')).toBe('gpt-5.3-codex-high')
  // A tier word that has no sibling in the listing is part of the name.
  expect(run('gpt-5.5-extra-high', 'low')).toBe('gpt-5.5-extra-high')
  expect(run('claude-opus-5-5-max', 'high')).toBe('claude-opus-5-5-max')
  for (const name of ['auto', 'composer-2.5-fast']) expect(run(name, 'high')).toBe(name)
  // Named by a `model:` line, with overrides, no effort, or no listing: as set.
  expect(run('gemini-4-neon-xhigh', 'low', true)).toBe('gemini-4-neon-xhigh')
  expect(run('claude-opus-4-8[effort=high]', 'low')).toBe('claude-opus-4-8[effort=high]')
  expect(run('gemini-4-neon-high', undefined)).toBe('gemini-4-neon-high')
  expect(cursorRunModel('gemini-4-neon-high', 'low', { isPicked: false }).model).toBe('gemini-4-neon-high')
})

test('Cursor effort xhigh runs gemini-4-neon-xhigh when cursorModel is gemini-4-neon-high, and logs it', { options: { cursorModel: 'gemini-4-neon-high' } }, async ($, on) => {
  const w = world(on, PONG)
  w.models = MODELS
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, TYPE, { effort: 'xhigh' }))
  await $.turn.start({ text: 'p', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  const argv = harnessArgv(w.launches[0])
  expect(argv[argv.indexOf('--model') + 1]).toBe('gemini-4-neon-xhigh')
  expect(w.delegations.at(-1)?.model).toBe('gemini-4-neon-xhigh')
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

// ---- picking a model per call (model: lines), across turns

const wrapped = (text: string) =>
  `The coordinator sent a message while you were working:\n${text}\n\nAddress this before completing your current task.`
const modelOf = (launch: { argv: readonly string[] } | undefined) => {
  const argv = harnessArgv(launch)
  return argv[argv.indexOf('--model') + 1]
}

test('a model: line in a SendMessage follow-up switches the model, out of the note Claude Code wraps it in', async ($, on) => {
  const w = world(on, PONG)
  w.models = MODELS
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Reply pong', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  expect(modelOf(w.launches[0])).toBe('auto')

  w.stream = FOLLOW_UP
  await $.agent.spawn({ ...spawnInput(TYPE), prompt: 'x', permissionMode: 'default', resume: { agentId: AGENT } })
  await $.turn.start({ text: wrapped('model: gemini-4-carbon-high\n\nAgain'), turnId: 't2', agentId: AGENT })
  await drain($.turn.step(step({ turnId: 't2' })))
  const argv = harnessArgv(w.launches[1])
  expect(argv[argv.indexOf('--model') + 1]).toBe('gemini-4-carbon-high')
  // The harness gets the message alone: no model line, no wrapper.
  expect(argv.at(-1)).toBe('Again')
})

test('a model Cursor does not list is refused before launch with a few near names, logged, and not kept', async ($, on) => {
  const w = world(on, PONG)
  w.models = MODELS
  await boot($, w, TYPE)
  await $.turn.start({ text: 'model: gemini-4-carbon-xhigh\n\nx', turnId: 't1', agentId: AGENT })
  const { result } = await drain($.turn.step(step()))
  expect(w.launches).toEqual([])
  expect(result.answer).toContain('offers no model named "gemini-4-carbon-xhigh".')
  expect(result.answer).toContain('Nearest names it offers: gemini-4-carbon-high, gemini-4-neon-xhigh')
  expect(result.answer.length).toBeLessThan(400)
  expect(w.delegations.at(-1)).toMatchObject({ harness: 'cursor', model: 'gemini-4-carbon-xhigh', outcome: 'refused' })

  await $.agent.spawn({ ...spawnInput(TYPE), prompt: 'x', permissionMode: 'default', resume: { agentId: AGENT } })
  await $.turn.start({ text: 'Again', turnId: 't2', agentId: AGENT })
  await drain($.turn.step(step({ turnId: 't2' })))
  expect(modelOf(w.launches[0])).toBe('auto')
})

test('a model named in a run that failed without an answer is not kept for the follow-up', async ($, on) => {
  const w = world(on, lines(
    { type: 'system', subtype: 'init', session_id: SESSION },
    { type: 'result', subtype: 'error', is_error: true, result: 'Cannot use this model: gemini-9', session_id: SESSION },
  ))
  w.end = '__hitch_exit__ code 1'
  await boot($, w, TYPE)
  await $.turn.start({ text: 'model: gemini-9\n\nx', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  expect(modelOf(w.launches[0])).toBe('gemini-9')

  w.stream = PONG
  w.end = '__hitch_exit__ code 0'
  await $.agent.spawn({ ...spawnInput(TYPE), prompt: 'x', permissionMode: 'default', resume: { agentId: AGENT } })
  await $.turn.start({ text: 'Again', turnId: 't2', agentId: AGENT })
  await drain($.turn.step(step({ turnId: 't2' })))
  expect(modelOf(w.launches[1])).toBe('auto')
})

test('a model: line beats the call\'s effort; a follow-up with no line keeps it', { options: { cursorModel: 'gemini-4-neon-high' } }, async ($, on) => {
  const w = world(on, PONG)
  w.models = MODELS
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, TYPE, { effort: 'low' }))
  await $.turn.start({ text: 'model: gemini-4-neon-xhigh\n\nx', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  expect(modelOf(w.launches[0])).toBe('gemini-4-neon-xhigh')
  await $.turn.start({ text: 'Again', turnId: 't2', agentId: AGENT })
  await drain($.turn.step(step({ turnId: 't2' })))
  expect(modelOf(w.launches[1])).toBe('gemini-4-neon-xhigh')
})

test('a message sent while Cursor works is answered in the same turn, on the model it names', async ($, on) => {
  const w = world(on, FIRST)
  w.models = MODELS
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Create notes.txt', turnId: 't1', agentId: AGENT })
  const s0 = await drain($.turn.step(step()))
  await answerRow($, s0.chunks)
  // SendMessage while the run goes: it reaches the next step's transcript.
  w.messages = [{ role: 'user', text: wrapped('model: gemini-4-neon-low\n\nAlso say hi') }] as any
  const s1 = await drain($.turn.step(step({ index: 1 })))
  await answerRow($, s1.chunks)
  w.messages = []
  // The first run ends; the second starts at once, resuming the session.
  let index = 2
  let s = await drain($.turn.step(step({ index })))
  while (s.result.stopReason === 'tool_use') {
    await answerRow($, s.chunks)
    s = await drain($.turn.step(step({ index: ++index })))
  }
  expect(w.launches.length).toBe(2)
  const argv = harnessArgv(w.launches[1])
  expect(argv[argv.indexOf('--model') + 1]).toBe('gemini-4-neon-low')
  expect(argv.slice(-3)).toEqual(['--resume', SESSION, 'Also say hi'])
  // The report carries both runs' answers, in the last text block.
  expect(s.result.answer).toBe('done\n\ndone')
  expect((s.chunks.filter(c => c.kind === 'text').at(-1) as { text: string }).text).toBe('done\n\ndone')
  expect(w.delegations.map(d => d.model)).toEqual(['auto', 'gemini-4-neon-low'])
})
