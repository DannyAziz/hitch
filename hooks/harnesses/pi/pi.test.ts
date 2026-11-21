import { expect, test } from 'claude-code/testing'
import { AGENT, agentInfo, drain, harnessArgv, step, world } from '../../../tests/world'
import { pi } from './index'
import { ERROR, FIRST, FOLLOW_UP, SESSION } from './fixture'
import { parsePi } from './parse'

const cli = pi.transports['cli-jsonl']!
const spec = { prompt: 'the prompt', model: 'openrouter/~deepseek/deepseek-flash-latest', sandbox: 'workspace-write' }
const base = ['pi', '-p', '--mode', 'json', '--provider', 'openrouter', '--model', '~deepseek/deepseek-flash-latest']

test('pi recorded first run gives two actions, actual results, one closing message and cumulative usage', () => {
  const memo = {}
  const events = FIRST.map(line => parsePi(line, memo))
  expect(events[0]).toEqual({ sessionId: SESSION })
  expect(events.filter(e => e.started).map(e => e.started?.title)).toEqual(['notes.txt', 'cat notes.txt'])
  const actions = events.flatMap(e => e.action ? [e.action] : [])
  expect(actions.length).toBe(2)
  expect(actions[0]?.input).toEqual({ kind: 'file_change', changes: [{ path: 'notes.txt', kind: 'write' }] })
  expect(actions[0]?.output).toBe('Successfully wrote to notes.txt')
  expect(actions[1]?.input).toEqual({ kind: 'command', command: 'cat notes.txt', exit_code: 0 })
  expect(actions[1]?.output).toBe('alpha\n')
  expect(actions.map(a => a.isError)).toEqual([false, false])
  expect(actions.map(a => a.id)).toEqual(events.filter(e => e.started).map(e => e.started?.id))
  expect(events.filter(e => e.message).map(e => e.message)).toEqual(['done'])
  expect(events.filter(e => e.usage).map(e => e.usage)).toEqual([
    { input: 6132, cached: 0, output: 56 },
    { input: 12337, cached: 5632, output: 113 },
    { input: 18612, cached: 11520, output: 116 },
  ])
  expect(events.some(e => e.line === '$ cat notes.txt')).toBe(true)
  const followMemo = {}
  const follow = FOLLOW_UP.map(line => parsePi(line, followMemo))
  expect(follow[0]).toEqual({ sessionId: SESSION })
  expect(follow.filter(e => e.message).map(e => e.message)).toEqual(['notes.txt'])
  expect(follow.filter(e => e.usage).at(-1)?.usage).toEqual({ input: 6299, cached: 5888, output: 4 })
})

test('pi surfaces the recorded failure despite a zero process exit, from either end event', () => {
  const memo = {}
  const events = ERROR.map(line => parsePi(line, memo))
  expect(events.filter(e => e.error).length).toBe(2)
  for (const type of ['message_end', 'turn_end']) {
    const raw = ERROR.find(line => JSON.parse(line).type === type && JSON.parse(line).message?.stopReason === 'error')!
    expect(parsePi(raw, memo).error).toContain('not supported')
  }
})

test('pi exact argv splits only the first slash, resumes the session and supplies no stdin', () => {
  expect(cli.start(spec)).toEqual({ argv: [...base, 'the prompt'] })
  expect(cli.resume!({ ...spec, sessionId: SESSION })).toEqual({ argv: [...base, '--session', SESSION, 'the prompt'] })
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
    expect(cli.start({ ...spec, effort })).toEqual({ argv: [...base, '--thinking', effort, 'the prompt'] })
    expect(cli.resume!({ ...spec, sessionId: SESSION, effort })).toEqual({ argv: [...base, '--session', SESSION, '--thinking', effort, 'the prompt'] })
  }
  expect(cli.start({ ...spec, sandbox: 'read-only' })).toEqual({ argv: [...base, '--tools', 'read,grep,find,ls', 'the prompt'] })
  expect(cli.resume!({ ...spec, sessionId: SESSION, sandbox: 'read-only', effort: 'high' })).toEqual({ argv: [...base, '--session', SESSION, '--thinking', 'high', '--tools', 'read,grep,find,ls', 'the prompt'] })
})

test('pi launcher supplies empty stdin, configured options and the agent cwd', { options: { piSandbox: 'read-only' } }, async ($, on) => {
  const w = world(on, FOLLOW_UP)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, 'hitch:pi', { effort: 'high', cwd: '/repo/worktree' }))
  await $.turn.start({ text: 'Which file?', turnId: 't1', agentId: AGENT })
  expect((await drain($.turn.step(step()))).result.answer).toBe('notes.txt')
  expect(harnessArgv(w.launches[0])).toEqual(['/mock/bin/pi', ...base.slice(1), '--thinking', 'high', '--tools', 'read,grep,find,ls', 'Which file?'])
  expect(w.launches[0]?.cwd).toBe('/repo/worktree')
  expect(w.launches[0]?.argv[4]).toBe('file')
  expect(w.written.get(`${w.launches[0]?.argv[3]}/input`)).toBe('')
})

test('pi preserves failed tool output and handles read/edit paths without delta or replay rows', () => {
  const memo = {}
  parsePi(FIRST[0]!, memo)
  for (const toolName of ['read', 'edit', 'bash']) {
    const start = { type: 'tool_execution_start', toolCallId: toolName, toolName, args: { path: 'a.txt', command: 'bad command' } }
    expect(parsePi(JSON.stringify(start), memo).started?.title).toBe(toolName === 'bash' ? 'bad command' : 'a.txt')
    const action = parsePi(JSON.stringify({ type: 'tool_execution_end', toolCallId: toolName, toolName, result: { content: [{ type: 'text', text: 'failed' }] }, isError: true }), memo).action
    expect(action?.output).toBe('failed')
    expect(action?.isError).toBe(true)
  }
  expect(parsePi('{"type":"tool_execution_end","toolCallId":"missing"}', memo).error).toContain('no matching start')
  for (const line of FIRST) {
    const ev = JSON.parse(line)
    if (ev.type === 'message_update' || ev.type === 'agent_end' || ev.message?.role === 'system') expect(parsePi(line, memo)).toEqual({})
  }
})
