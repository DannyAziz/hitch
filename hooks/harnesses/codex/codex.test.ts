// Codex (cli-jsonl) against its recorded fixture: rows, the rollout diff,
// resume, options, errors, and the parser on every recorded line.

import { expect, test } from 'claude-code/testing'

import { AGENT, answerRow, agentInfo, boot, drain, harnessArgv, lines, spawnInput, step, world } from '../../../tests/world'
import { FILE, FIRST, FOLLOW_UP, THREAD, fixture } from './fixture'
import { parseCodex } from './parse'

const TYPE = 'hitch:codex'

// A synthetic minimal Codex turn: one message, no actions.
const PONG = lines(
  { type: 'thread.started', thread_id: THREAD },
  { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'pong' } },
  { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 20 } },
)

test('the parser on the recorded stream: thread, messages, started and finished actions, usage', () => {
  const memo = {}
  const events = FIRST.map(line => parseCodex(line, memo))
  expect(events[0]).toEqual({ sessionId: THREAD })
  expect(events.filter(e => e.message !== undefined).map(e => e.message?.trim())).toEqual(['I’ll patch `a.txt`, then run `cat a.txt`.', 'done'])
  expect(events.filter(e => e.started).map(e => e.started?.title)).toEqual(['cat a.txt', FILE, 'cat a.txt'])
  expect(events.filter(e => e.action).map(e => e.action?.kind)).toEqual(['command', 'file_change', 'command'])
  expect(events.at(-1)?.usage).toEqual({ input: 75797, cached: 69504, output: 179 })
  const followMemo = {}
  const follow = FOLLOW_UP.map(line => parseCodex(line, followMemo))
  expect(follow.filter(e => e.action).map(e => e.action?.title)).toEqual(['sleep 3'])
})

test('a Codex turn becomes rows: each action a Codex tool row with its real result, the last step only the closing message', async ($, on) => {
  const w = world(on, FIRST, fixture.shell)
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Patch a.txt', turnId: 't1', agentId: AGENT })

  // Step 0: the opening message, then the first command as a row.
  const s0 = await drain($.turn.step(step()))
  expect(s0.result.stopReason).toBe('tool_use')
  expect(s0.result.usage).toBe(null)
  expect(s0.result.toolUses).toEqual([{ name: 'HitchLog', input: { harness: 'codex', kind: 'command', command: 'cat a.txt', exit_code: 0, title: 'cat a.txt' } }])
  expect(s0.result.answer).toContain('I’ll patch')
  expect(s0.chunks[0]).toEqual({ kind: 'thinking', index: 0, text: 'access: workspace-write (mode sandbox) · waiting on gpt-6-astra…\n' })
  const kinds = s0.chunks.map(c => `${c.kind}${'index' in c ? c.index : ''}`)
  expect(kinds).toEqual(['thinking0', 'text1', 'thinking2', 'tool3', 'input3', 'stop'])
  const r0 = await answerRow($, s0.chunks)
  expect(r0.result).toBe('hello\n')

  // Launched detached, Codex argv, prompt in the input file, agent's cwd.
  expect(w.launches.length).toBe(1)
  expect(harnessArgv(w.launches[0]).slice(0, 4)).toEqual(['/mock/bin/codex', 'exec', '-m', 'gpt-6-astra'])
  expect(w.launches[0]?.cwd).toBe('/repo')
  const dir = String(w.launches[0]?.argv[3])
  expect(dir.startsWith(`/scratch/hitch/${AGENT}/turn-1-`)).toBe(true)
  expect(w.written.get(`${dir}/input`)).toBe('Patch a.txt')

  // Step 1: reads on from line 5; the file change, with its diff from the rollout.
  const s1 = await drain($.turn.step(step({ index: 1, messageCount: 3 })))
  expect(w.readers[1]?.[4]).toBe('5')
  expect(s1.result.toolUses[0]?.input).toEqual({ harness: 'codex', kind: 'file_change', changes: [{ path: FILE, kind: 'update' }], title: `update ${FILE}` })
  const r1 = await answerRow($, s1.chunks)
  expect(r1.result).toContain('+goodbye')

  // Step 2: the second command.
  const s2 = await drain($.turn.step(step({ index: 2, messageCount: 5 })))
  expect((s2.result.toolUses[0]?.input as any).command).toBe('cat a.txt')
  expect((await answerRow($, s2.chunks)).result).toBe('goodbye\n')

  // Step 3: only the closing message, end_turn.
  const s3 = await drain($.turn.step(step({ index: 3, messageCount: 7 })))
  expect(s3.result.stopReason).toBe('end_turn')
  expect(s3.result.answer).toBe('done')
  expect(s3.result.toolUses).toEqual([])
  expect(s3.chunks.filter(c => c.kind === 'text').map(c => (c as { text: string }).text)).toEqual(['done'])
  expect(s3.chunks.at(-1)).toEqual({ kind: 'stop', stopReason: 'end_turn', usage: null })

  // Nothing went to Claude, no tool ran, no permission path was raised.
  expect(w.sent).toEqual([])
  expect(w.toolRan).toEqual([])
  expect(w.launches.length).toBe(1)
  const saved = w.store.get(`hitch:agent:${AGENT}`) as any
  expect(saved.sessionId).toBe(THREAD)
  expect(saved.turns).toBe(1)
  expect(saved.run).toBe(undefined)
})

test('a SendMessage follow-up resumes the Codex thread', async ($, on) => {
  const w = world(on, PONG, fixture.shell)
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Reply pong', turnId: 't1', agentId: AGENT })
  expect((await drain($.turn.step(step()))).result.answer).toBe('pong')

  await $.agent.spawn({ ...spawnInput(TYPE), prompt: 'Again', permissionMode: 'default', resume: { agentId: AGENT } })
  await $.turn.start({ text: 'Again', turnId: 't2', agentId: AGENT })
  const { result } = await drain($.turn.step(step({ turnId: 't2' })))
  const argv = harnessArgv(w.launches[1])
  expect(argv.slice(0, 3)).toEqual(['/mock/bin/codex', 'exec', 'resume'])
  expect(argv).toContain(THREAD)
  expect(result.answer).toBe('pong')
  expect(w.sent).toEqual([])
})

test('effort, model and sandbox options reach codex; a worktree cwd is where it runs', { options: { codexModel: 'gpt-6.1-sol', codexSandbox: 'read-only' } }, async ($, on) => {
  const w = world(on, PONG, fixture.shell)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, TYPE, { effort: 'max', cwd: '/repo/.claude/worktrees/x' }))
  await $.turn.start({ text: 'p', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  const argv = harnessArgv(w.launches[0])
  expect(argv.slice(2, 4)).toEqual(['-m', 'gpt-6.1-sol'])
  expect(argv).toContain('model_reasoning_effort="xhigh"')
  expect(argv).toContain('read-only')
  expect(w.launches[0]?.cwd).toBe('/repo/.claude/worktrees/x')
})

test('Codex reporting an error ends the turn with it, without Claude', async ($, on) => {
  const w = world(on, lines({ type: 'error', message: 'model gpt-6-astra is not available' }), fixture.shell)
  w.end = '__hitch_exit__ code 1'
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  const { result } = await drain($.turn.step(step()))
  expect(result.stopReason).toBe('end_turn')
  expect(result.answer).toContain('not available')
  expect(w.sent).toEqual([])
})

