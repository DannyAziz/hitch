import type { HarnessEvent } from '../../core/types'
import { expect, test } from 'claude-code/testing'
import { AGENT, agentInfo, spawnInput, drain, harnessArgv, step, world } from '../../../tests/world'
import { amp, ampRunModel } from './index'
import { FILE, FIRST, FOLLOW_UP, THREAD } from './fixture'
import { parseAmp } from './parse'

const cli = amp.transports['cli-jsonl']!

test('Amp recorded first turn pairs starts and results, reports real output and summed usage', () => {
  const memo = {}
  const events = FIRST.flatMap(line => parseAmp(line, memo))
  expect(events[0]).toEqual({ sessionId: THREAD })
  expect(events.filter(e => e.started).map(e => e.started?.title)).toEqual([FILE, 'cat notes.txt'])
  const actions = events.flatMap(e => e.action ? [e.action] : [])
  expect(actions.length).toBe(2)
  expect(actions[0]?.kind).toBe('file_change')
  expect(actions[0]?.input).toEqual({ kind: 'file_change', changes: [{ path: FILE, kind: 'create' }] })
  expect(actions[0]?.output).toBe(`Successfully created file ${FILE}`)
  expect(actions[1]?.input).toEqual({ kind: 'command', command: 'cat notes.txt', exit_code: 0 })
  expect(actions[1]?.output).toBe('alpha\n')
  expect(events[2]?.action).toBe(undefined)
  expect(events[4]?.action).toBe(undefined)
  expect(events[4]?.line).toBe('$ cat notes.txt')
  expect(actions.map(a => a.id)).toEqual(events.filter(e => e.started).map(e => e.started?.id))
  expect(events.filter(e => e.message).map(e => e.message)).toEqual(['done'])
  expect(events.filter(e => e.usage).at(-1)?.usage).toEqual({ input: 175480, cached: 116769, output: 321 })
  const followMemo = {}
  const follow = FOLLOW_UP.flatMap(line => parseAmp(line, followMemo))
  expect(follow.filter(e => e.message).map(e => e.message)).toEqual(['notes.txt'])
  expect(follow.filter(e => e.usage).at(-1)?.usage).toEqual({ input: 58930, cached: 57491, output: 7 })
})

test('Amp context is each assistant message\'s own counts; the latest replaces earlier', () => {
  const memo = {}
  const events = FIRST.flatMap(line => parseAmp(line, memo))
  expect(events.filter(e => e.context).map(e => e.context)).toEqual([
    { used: 58417 }, // 4 + 58254 + 0 + 159
    { used: 58676 }, // 2 + 261 + 58254 + 159
    { used: 58708 }, // 2 + 188 + 58515 + 3
  ])
  const followMemo = {}
  const follow = FOLLOW_UP.flatMap(line => parseAmp(line, followMemo))
  expect(follow.filter(e => e.context).map(e => e.context)).toEqual([{ used: 58937 }]) // 4 + 1435 + 57491 + 7
})

test('Amp exact start and resume argv put prompts on argv and provide no stdin input', () => {
  const spec = { prompt: 'the prompt', model: 'medium' }
  expect(cli.start(spec)).toEqual({ argv: ['amp', '-x', 'the prompt', '--stream-json', '--no-archive-after-execute', '-m', 'medium'] })
  expect(cli.resume!({ ...spec, sessionId: THREAD })).toEqual({ argv: ['amp', 'threads', 'continue', THREAD, '-x', 'the prompt', '--stream-json', '--no-archive-after-execute', '-m', 'medium'] })
  // An effort that reaches the argv is Amp's --effort (for a provider/name model).
  expect(cli.start({ ...spec, model: 'openai/gpt-6-astra', effort: 'low' }).argv.slice(-4)).toEqual(['-m', 'openai/gpt-6-astra', '--effort', 'low'])
})

test('Amp effort picks the mode in place of the configured one; a named mode runs as named; a model takes --effort', () => {
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
    const mode = effort === 'max' || effort === 'xhigh' ? 'ultra' : effort
    expect(ampRunModel('low', effort, { isPicked: false })).toEqual({ model: mode })
    expect(ampRunModel('low', effort, { isPicked: true })).toEqual({ model: 'low' })
    expect(ampRunModel('openai/gpt-6-astra', effort, { isPicked: true })).toEqual({ model: 'openai/gpt-6-astra', effort })
  }
  expect(ampRunModel('high', undefined, { isPicked: false })).toEqual({ model: 'high' })
})

test('Amp configured mode is overridden by xhigh and the launcher supplies empty stdin in the agent cwd', { options: { ampModel: 'low' } }, async ($, on) => {
  const w = world(on, FOLLOW_UP)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, 'hitch:amp', { effort: 'xhigh', cwd: '/repo/worktree' }))
  await $.agent.spawn({ ...spawnInput('hitch:amp'), permissionMode: 'default' })
  await $.turn.start({ text: 'Which file?', turnId: 't1', agentId: AGENT })
  const s = await drain($.turn.step(step()))
  expect(s.result.answer).toBe('notes.txt\n\n[hitch] Amp context: 58.9k tokens.')
  expect(harnessArgv(w.launches[0])).toEqual(['/mock/bin/amp', '-x', 'Which file?', '--stream-json', '--no-archive-after-execute', '-m', 'ultra'])
  expect(w.launches[0]?.cwd).toBe('/repo/worktree')
  expect(w.launches[0]?.argv[4]).toBe('file')
  expect(w.written.get(`${w.launches[0]?.argv[3]}/input`)).toBe('')
})

test('Amp pairing is isolated by thread, errors are surfaced, and failed commands retain output and code', () => {
  const memo = {}
  const otherMemo = {}
  const other = (line: string) => line.replaceAll(THREAD, 'another-thread')
  parseAmp(FIRST[0]!, memo)
  parseAmp(other(FIRST[0]!), otherMemo)
  parseAmp(FIRST[2]!, memo)
  parseAmp(other(FIRST[4]!), otherMemo)
  expect((parseAmp(FIRST[3]!, memo) as HarnessEvent).action?.kind).toBe('file_change')
  const failed = JSON.parse(other(FIRST[5]!))
  failed.message.content[0].content = JSON.stringify({ output: 'failed\n', exitCode: 2 })
  const action = (parseAmp(JSON.stringify(failed), otherMemo) as HarnessEvent).action
  expect(action?.output).toBe('failed\n')
  expect(action?.input.exit_code).toBe(2)
  expect(action?.isError).toBe(true)
  expect((parseAmp(JSON.stringify({ type: 'result', subtype: 'error_during_execution', session_id: THREAD, errors: ['oops'] }), memo) as HarnessEvent).error).toBe('oops')
  expect((parseAmp(other(FIRST[7]!), otherMemo) as HarnessEvent)).toEqual({})
})

test('Amp synthetic multiple tool blocks pair in order and unmatched results still fail', () => {
  const memo = {}
  parseAmp(FIRST[0]!, memo)
  // Synthetic, built from recorded assistant/user shapes; not a recording.
  const assistant = JSON.parse(FIRST[2]!)
  assistant.message.content.push(JSON.parse(FIRST[4]!).message.content[0])
  const user = JSON.parse(FIRST[3]!)
  user.message.content.push(JSON.parse(FIRST[5]!).message.content[0])
  const starts = parseAmp(JSON.stringify(assistant), memo) as HarnessEvent[]
  const results = parseAmp(JSON.stringify(user), memo) as HarnessEvent[]
  expect(starts.map(e => e.started?.title)).toEqual([FILE, 'cat notes.txt'])
  expect(results.map(e => e.action?.id)).toEqual(starts.map(e => e.started?.id))
  expect(results.map(e => e.action?.kind)).toEqual(['file_change', 'command'])
  expect(results.map(e => e.action?.output)).toEqual([`Successfully created file ${FILE}`, 'alpha\n'])
  expect((parseAmp(FIRST[3]!, memo) as HarnessEvent).error).toContain('no matching tool use')
  const duplicate = JSON.parse(FIRST[3]!)
  duplicate.message.content.push(duplicate.message.content[0])
  expect((parseAmp(JSON.stringify(duplicate), memo) as HarnessEvent[]).every(e => e.error?.includes('no matching tool use'))).toBe(true)
})
