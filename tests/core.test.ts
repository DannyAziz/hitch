// Core behaviour: the step loop, rows, timeouts, stop, reload, auto mode,
// the row tool, /hitch and the delegation log. Codex's recorded fixture is
// the vehicle; nothing here is about Codex itself (see
// hooks/harnesses/codex/codex.test.ts for that).

import { expect, test } from 'claude-code/testing'

import { FIRST as AMP_FIRST } from '../hooks/harnesses/amp/fixture'
import { FIRST, THREAD, fixture } from '../hooks/harnesses/codex/fixture'
import { AGENT, T0, answerRow, agentInfo, boot, drain, harnessArgv, lines, spawnInput, step, world } from './world'

const TYPE = 'hitch:codex'

// A synthetic minimal Codex turn: one message, no actions.
const PONG = lines(
  { type: 'thread.started', thread_id: THREAD },
  { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'pong' } },
  { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 20 } },
)

test('the row tool: deferred with a one-line description everywhere, offered only to its own agents, refused to anyone else', async ($, on) => {
  const w = world(on, FIRST, fixture.shell)
  on('tool.describe', (_, e) => ({ description: e.description }))
  await boot($, w, TYPE)
  // Where tool.offer is passed over, this is all another loop gets.
  const d = await $.tool.describe({ tool: 'HitchLog', description: 'x', provider: { plugin: 'hitch', tier: 'user' } })
  expect(d.isDeferred).toBe(true)
  expect(d.description).toBe('Display-only log of a hitch agent. Never call.')
  const bash = await $.tool.describe({ tool: 'Bash', description: 'shell', provider: { plugin: 'engine', tier: 'core' } })
  expect(bash.isDeferred).toBe(undefined)
  const prov = { plugin: 'hitch', tier: 'user' as const }
  expect((await $.tool.offer({ tool: 'HitchLog', provider: prov })).isOffered).toBe(false)
  expect((await $.tool.offer({ tool: 'HitchLog', provider: prov, agentId: 'x', subagentType: 'general-purpose' })).isOffered).toBe(false)
  expect((await $.tool.offer({ tool: 'HitchLog', provider: prov, agentId: AGENT, subagentType: TYPE })).isOffered).toBe(true)
  // One tool for every harness.
  expect((await $.tool.offer({ tool: 'HitchLog', provider: prov, agentId: 'd1', subagentType: 'hitch:devin' })).isOffered).toBe(true)
  expect((await $.tool.offer({ tool: 'Bash', provider: prov })).isOffered).toBe(true)
  const callTool = $.tool.call as unknown as (e: object) => Promise<{ deny?: string; text?: string }>
  const call = await callTool({ tool: 'HitchLog', tool_use_id: 'toolu_01X', kind: 'command' })
  expect(call.deny ?? call.text).toContain('"hitch:codex"')
  expect(w.toolRan).toEqual([])
})

test('the main loop and other agents still go to Claude', async ($, on) => {
  const w = world(on, FIRST, fixture.shell)
  await boot($, w, TYPE)
  w.agents.push(agentInfo('other1', 'Explore'))
  await drain($.turn.step(step({ agentId: undefined })))
  await drain($.turn.step(step({ agentId: 'other1' })))
  expect(w.sent.length).toBe(2)
  expect(w.launches).toEqual([])
})

test('idle timeout: counts only while waiting on the model; the label says "waiting on"', async ($, on) => {
  const w = world(on, [
    ...lines({ type: 'thread.started', thread_id: THREAD }),
    { at: T0 + 30_000, stderr: '__hitch_idle__ 30' },
    { at: T0 + 301_000, stderr: '__hitch_idle__ 301' },
  ])
  w.end = ''
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  const { chunks, result } = await drain($.turn.step(step()))
  const thoughts = chunks.filter(c => c.kind === 'thinking').map(c => (c as { text: string }).text).join('')
  expect(thoughts).toContain('waiting on gpt-6-astra… 30s')
  expect(result.stopReason).toBe('end_turn')
  expect(result.answer).toContain('produced no output for 301s while waiting on gpt-6-astra')
  expect(result.answer).toContain('idle timeout 300s')
  expect(result.answer).toContain('SendMessage')
  expect(result.answer).toContain(THREAD)
  expect(w.runs).toContainEqual(['kill', '-TERM', '4242'])
  expect(w.delegations.at(-1)?.outcome).toBe('timeout')
  expect(w.sent).toEqual([])
})

test('a long command is not an idle timeout: "running: <command>", and it finishes', async ($, on) => {
  const w = world(on, [
    ...lines(
      { type: 'thread.started', thread_id: THREAD },
      { type: 'item.started', item: { id: 'c1', type: 'command_execution', command: "/bin/zsh -lc 'sleep 400'" } },
    ),
    { at: T0 + 95_000, stderr: '__hitch_idle__ 95' },
    { at: T0 + 400_000, stderr: '__hitch_idle__ 400' },
    ...lines({ type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: "/bin/zsh -lc 'sleep 400'", aggregated_output: '', exit_code: 0 } }),
  ])
  w.end = ''
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Run sleep 400', turnId: 't1', agentId: AGENT })
  const { chunks, result } = await drain($.turn.step(step()))
  const thoughts = chunks.filter(c => c.kind === 'thinking').map(c => (c as { text: string }).text).join('')
  expect(thoughts).toContain('running: sleep 400 · 95s')
  // 400 s past the 300 s idle limit, but a command was running: it's a row.
  expect(result.stopReason).toBe('tool_use')
  expect((result.toolUses[0]?.input as any).command).toBe('sleep 400')
  expect(w.runs).not.toContainEqual(['kill', '-TERM', '4242'])
  expect(w.sent).toEqual([])
})

test('a command past the command timeout stops the harness', { options: { codexCommandTimeoutSec: 600, codexIdleTimeoutSec: 45 } }, async ($, on) => {
  const w = world(on, [
    ...lines(
      { type: 'thread.started', thread_id: THREAD },
      { type: 'item.started', item: { id: 'c1', type: 'command_execution', command: "/bin/zsh -lc 'make build'" } },
    ),
    { at: T0 + 300_000, stderr: '__hitch_idle__ 300' },
    { at: T0 + 601_000, stderr: '__hitch_idle__ 601' },
  ])
  w.end = ''
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Build', turnId: 't1', agentId: AGENT })
  const { result } = await drain($.turn.step(step()))
  expect(result.stopReason).toBe('end_turn')
  expect(result.answer).toContain('command `make build` ran for 601s')
  expect(result.answer).toContain('command timeout 600s')
  expect(w.runs).toContainEqual(['kill', '-TERM', '4242'])
  // The reader's own limit is only a backstop past both.
  expect(Number(w.readers[0]?.[5])).toBeGreaterThan(600)
})

test('stopping mid-step kills the supervisor', async ($, on) => {
  const w = world(on, lines({ type: 'thread.started', thread_id: THREAD }, { type: 'item.started', item: { id: 'i', type: 'command_execution', command: 'sleep 90' } }), fixture.shell)
  w.end = ''
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Run sleep 90', turnId: 't1', agentId: AGENT })
  const stream = $.turn.step(step())
  await stream.next() // waiting…
  const live = await stream.next()
  expect((live.value as any).text).toContain('$ sleep 90')
  await stream.return(undefined as never)
  expect(w.runs).toContainEqual(['kill', '-TERM', '4242'])
  expect(w.sent).toEqual([])
})

test('after a reload: a run in the store is read on from where it stopped', async ($, on) => {
  const w = world(on, FIRST, fixture.shell)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.store.set('hitch:agent:old1', {
    agentId: 'old1', key: 'codex', sessionId: THREAD, model: 'gpt-6-astra', sandbox: 'workspace-write', turns: 0, tokens: 0,
    run: { dir: '/scratch/hitch/old1/turn-1-x', supervisor: '777', consumed: 9, startedAt: 0, model: 'gpt-6-astra', rows: 3 },
  })
  const { result } = await drain($.turn.step(step({ agentId: 'old1', turnId: 'tx', index: 7 })))
  expect(w.readers[0]?.[3]).toBe('/scratch/hitch/old1/turn-1-x')
  expect(w.readers[0]?.[4]).toBe('9')
  expect(w.launches).toEqual([])
  expect(result.answer).toBe('done')
})

test('auto mode, hand-back hidden: the last step is plain text', async ($, on) => {
  const w = world(on, PONG, fixture.shell)
  await boot($, w, TYPE, 'auto')
  const offered = await $.tool.offer({ tool: 'SubagentHandback', provider: { plugin: 'engine', tier: 'core' }, agentId: AGENT, subagentType: TYPE })
  expect(offered.isOffered).toBe(false)
  await $.turn.start({ text: 'Reply pong', turnId: 't1', agentId: AGENT })
  const { result } = await drain($.turn.step(step()))
  expect(result.stopReason).toBe('end_turn')
  expect(result.answer).toBe('pong')
})

test('auto mode, hand-back left offered: rows as usual, then the last step is a SubagentHandback call', async ($, on) => {
  const w = world(on, FIRST, fixture.shell)
  await boot($, w, TYPE, 'auto')
  await $.turn.start({ text: 'Patch a.txt', turnId: 't1', agentId: AGENT })
  for (let i = 0; i < 3; i++) {
    const s = await drain($.turn.step(step({ index: i })))
    expect(s.result.toolUses[0]?.name).toBe('HitchLog')
    await answerRow($, s.chunks)
  }
  const last = await drain($.turn.step(step({ index: 3 })))
  expect(last.result.stopReason).toBe('tool_use')
  expect(last.result.toolUses[0]).toEqual({ name: 'SubagentHandback', input: { message: 'done' } })
  // The call did not end the run: the next step reports as text, no new Codex turn.
  const again = await drain($.turn.step(step({ index: 4 })))
  expect(again.result.stopReason).toBe('end_turn')
  expect(again.result.answer).toBe('done')
  expect(w.launches.length).toBe(1)
  expect(w.sent).toEqual([])
})

test('/hitch lists the agent with its Codex session and no Claude usage', async ($, on) => {
  const w = world(on, PONG, fixture.shell)
  on('session.usage', () => ({ value: { startedAt: 0, context: {} as any, rateLimits: [], cost: { usd: 0 } as any } }))
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Reply pong', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  const out = await $.command.run({ command: 'hitch', args: '', origin: { kind: 'composer' } } as any)
  expect(out.text).toContain(THREAD)
  expect(out.text).toContain('no requests')
})

test('stampHarnessModel: steps report zero usage naming the Codex model', { options: { stampHarnessModel: true } }, async ($, on) => {
  const w = world(on, FIRST, fixture.shell)
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Patch a.txt', turnId: 't1', agentId: AGENT })
  const s0 = await drain($.turn.step(step()))
  const zero = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'codex/gpt-6-astra' }
  expect(s0.result.usage).toEqual(zero)
  expect(s0.chunks.at(-1)).toEqual({ kind: 'stop', stopReason: 'tool_use', usage: zero })
  expect(w.sent).toEqual([])
})
// ---------------------------------------------------------------- the delegation log

test('delegation log: one JSON line per finished turn, no prompt or report text; /hitch log summarizes', async ($, on) => {
  const w = world(on, PONG, fixture.shell)
  await boot($, w, TYPE)
  await $.turn.start({ text: 'Reply pong, secret-prompt-text', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  await $.agent.spawn({ ...spawnInput(TYPE), prompt: 'Again', permissionMode: 'default', resume: { agentId: AGENT } })
  await $.turn.start({ text: 'Again', turnId: 't2', agentId: AGENT })
  await drain($.turn.step(step({ turnId: 't2' })))

  expect(w.delegations.length).toBe(2)
  const [first, second] = w.delegations
  expect(first).toEqual({
    ts: expect.any(String),
    session: 'sess-1',
    agentId: AGENT,
    harness: 'codex',
    transport: 'cli-jsonl',
    model: 'gpt-6-astra',
    effort: null,
    sandbox: 'workspace-write', access: { level: 'workspace-write', decider: 'mode sandbox' },
    description: 'patch a.txt',
    promptChars: 'Reply pong, secret-prompt-text'.length,
    turn: 'first',
    durationMs: 0,
    rows: 0,
    tokens: 1020,
    outcome: 'done',
    exitCode: 0,
    exit: 'code 0',
  })
  expect(second.turn).toBe('follow-up')
  expect(JSON.stringify(w.delegations)).not.toContain('secret-prompt-text')
  expect(JSON.stringify(w.delegations)).not.toContain('pong')
  // Written to the default path through the shell (~ expanded there).
  const write = w.runs.find(r => String(r[2]).includes('mkdir -p "$(dirname'))
  expect(write?.[4]).toBe('~/.claude/hitch/delegations.jsonl')

  const out = await $.command.run({ command: 'hitch', args: 'log', origin: { kind: 'composer' } } as any)
  expect(out.text).toContain('codex')
  expect(out.text).toContain('gpt-6-astra')
  expect(out.text).toMatch(/codex\s+gpt-6-astra\s+2\s+0s\s+2040\s+0/)
})

test('delegation log path is an option', { options: { delegationLog: '/tmp/hn-test/log.jsonl' } }, async ($, on) => {
  const w = world(on, PONG, fixture.shell)
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  const write = w.runs.find(r => String(r[2]).includes('mkdir -p "$(dirname'))
  expect(write?.[4]).toBe('/tmp/hn-test/log.jsonl')
})

test('a HitchLog row renders with its harness label (from the row, not the tool name)', async ($, on) => {
  world(on, [], {})
  const render = $.ui.render as unknown as (e: object) => Promise<unknown>
  const props = (harness: string) => ({
    tool_use_id: 'toolu_01R',
    tool: 'HitchLog',
    input: { harness, kind: 'command', command: 'cat a.txt' },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    output: 'hello\n',
  })
  const devin = JSON.stringify(await render({ surface: 'terminal', component: 'ToolUse', requestId: 'toolu_01R', props: props('devin') }))
  expect(devin).toContain('Devin')
  expect(devin).toContain('$ cat a.txt')
  expect(devin).toContain('hello')
  const codex = JSON.stringify(await render({ surface: 'terminal', component: 'ToolUse', requestId: 'toolu_01R', props: props('codex') }))
  expect(codex).toContain('Codex')
})

test('one JSONL line with two actions becomes two ordered rows, including after reload', async ($, on) => {
  // Synthetic line pair assembled from recorded Amp shapes, not recorded.
  const assistant = JSON.parse(AMP_FIRST[2]!)
  assistant.message.content.push(JSON.parse(AMP_FIRST[4]!).message.content[0])
  const user = JSON.parse(AMP_FIRST[3]!)
  user.message.content.push(JSON.parse(AMP_FIRST[5]!).message.content[0])
  const w = world(on, [AMP_FIRST[0]!, ...lines(assistant, user), ...AMP_FIRST.slice(6)])
  await boot($, w, 'hitch:amp')
  await $.turn.start({ text: 'two tools', turnId: 't1', agentId: AGENT })
  const first = await drain($.turn.step(step()))
  expect(first.result.stopReason).toBe('tool_use')
  expect((first.result.toolUses[0]?.input as any).kind).toBe('file_change')
  expect((await answerRow($, first.chunks)).result).toContain('Successfully created file')
  const saved = JSON.parse(JSON.stringify(w.store.get(`hitch:agent:${AGENT}`)))
  expect(saved.run.consumed).toBe(3)
  expect(saved.run.pendingEvents.length).toBe(1)
  expect(saved.run.memo.turn.usage.input).toBeGreaterThan(0)
  // A fresh agent id loads only persisted data, as a reloaded mod would.
  w.store.set('hitch:agent:reloaded', { ...saved, agentId: 'reloaded' })
  const second = await drain($.turn.step(step({ agentId: 'reloaded', index: 1 })))
  expect(second.result.stopReason).toBe('tool_use')
  expect((second.result.toolUses[0]?.input as any).command).toBe('cat notes.txt')
  expect((await answerRow($, second.chunks)).result).toBe('alpha\n')
  expect(w.readers.length).toBe(1) // queued action needs no new stdout
  const last = await drain($.turn.step(step({ agentId: 'reloaded', index: 2 })))
  expect(last.result.answer).toBe('done\n\n[hitch] Amp context: 58.7k tokens.')
  expect(last.result.stopReason).toBe('end_turn')
  expect(w.delegations.at(-1)?.rows).toBe(2)
  expect(w.sent).toEqual([])
  expect(w.toolRan).toEqual([])
})

test('a bare executable on PATH launches by absolute path and is cached', async ($, on) => {
  const w = world(on, PONG)
  w.lookup = '/local/bin/codex\n'
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  expect(harnessArgv(w.launches[0])[0]).toBe('/local/bin/codex')
  await $.turn.start({ text: 'again', turnId: 't2', agentId: AGENT })
  await drain($.turn.step(step({ turnId: 't2' })))
  expect(w.runs.filter(r => r[2] === 'command -v "$1"').length).toBe(1)
  expect(w.launches[0]?.env).toBe(undefined)
})

test('a login shell supplies the executable and the child PATH', async ($, on) => {
  const w = world(on, PONG)
  w.lookup = ''
  w.loginLookup = '__hitch_path__/home/test/.nvm/bin:/usr/bin:/bin\n/home/test/.nvm/bin/codex\n'
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  expect(harnessArgv(w.launches[0])[0]).toBe('/home/test/.nvm/bin/codex')
  expect(w.launches[0]?.env).toEqual({ PATH: '/home/test/.nvm/bin:/usr/bin:/bin' })
  expect(w.runs.find(r => r[1] === '-l')).toEqual([
    '/bin/zsh', '-l', '-c', 'printf \'%s\\n\' "__hitch_path__$PATH"; command -v \'codex\'',
  ])
})

test('an explicit executable path is used without lookup', { options: { codexPath: '/custom path/codex' } }, async ($, on) => {
  const w = world(on, PONG)
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  expect(harnessArgv(w.launches[0])[0]).toBe('/custom path/codex')
  expect(w.runs.filter(r => String(r[2]).includes('command -v') || r[1] === '-l')).toEqual([])
})

test('a missing executable ends the turn with installation and option advice', async ($, on) => {
  const w = world(on, [])
  w.lookup = ''
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  const { result } = await drain($.turn.step(step()))
  expect(result.stopReason).toBe('end_turn')
  expect(result.answer).toBe('hitch could not find codex: looked on PATH and in a login shell. Install codex or set the codexPath option.')
  expect(w.launches).toEqual([])
  expect(w.readers).toEqual([])
  expect(w.sent).toEqual([])
})

test('login shell startup noise is ignored, taking the last absolute path', async ($, on) => {
  const w = world(on, PONG)
  w.lookup = ''
  w.loginLookup = 'Welcome!\n/noisy/startup/path\n__hitch_path__/local/bin:/usr/bin\n/local/bin/codex\nGoodbye!\n'
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  expect(harnessArgv(w.launches[0])[0]).toBe('/local/bin/codex')
  expect(w.launches[0]?.env).toEqual({ PATH: '/local/bin:/usr/bin' })
})

test('an explicit executable expands home without lookup', { options: { codexPath: '~/.local/bin/codex' } }, async ($, on) => {
  const w = world(on, PONG)
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  expect(harnessArgv(w.launches[0])[0]).toBe('/home/test/.local/bin/codex')
  expect(w.runs.filter(r => String(r[2]).includes('command -v') || r[1] === '-l')).toEqual([])
})

test('an exec startup failure drops the cached executable', async ($, on) => {
  const w = world(on, [])
  w.lookup = '/old/bin/codex\n'
  w.end = '__hitch_exit__ code 127'
  await boot($, w, TYPE)
  await $.turn.start({ text: 'x', turnId: 't1', agentId: AGENT })
  await drain($.turn.step(step()))
  w.lookup = '/new/bin/codex\n'
  w.stream = PONG
  w.end = '__hitch_exit__ code 0'
  await $.turn.start({ text: 'again', turnId: 't2', agentId: AGENT })
  await drain($.turn.step(step({ turnId: 't2' })))
  expect(harnessArgv(w.launches[1])[0]).toBe('/new/bin/codex')
  expect(w.runs.filter(r => r[2] === 'command -v "$1"').length).toBe(2)
})
