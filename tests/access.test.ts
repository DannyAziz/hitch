import { expect, test } from 'claude-code/testing'
import { AGENT, answerRow, boot, drain, harnessArgv, step, world } from './world'
import { FIRST } from '../hooks/harnesses/devin/fixture'
import { HARNESSES } from '../hooks/harnesses'
import { register } from '../hooks/register'
import { settingsFor } from '../hooks/core/harness'

async function run($: any, w: ReturnType<typeof world>, key: string, mode: string) {
  await boot($, w, `hitch:${key}`, mode)
  await $.turn.start({ text: 'task', turnId: 't1', agentId: AGENT })
  const results = []
  for (let index = 0; index < 12; index++) {
    const s = await drain($.turn.step(step({ index })))
    results.push(s)
    if (s.result.stopReason !== 'tool_use') break
    ;(s as any).rowAnswer = await answerRow($, s.chunks)
  }
  return results
}

for (const key of ['codex', 'cursor', 'pi', 'amp']) {
  for (const mode of ['plan', 'bypassPermissions', 'default', 'acceptEdits', 'auto', 'dontAsk']) {
    test(`follow ${key} ${mode}: enforced access and argv`, async ($, on) => {
      const w = world(on, [])
      const results = await run($, w, key, mode)
      const argv = harnessArgv(w.launches[0])
      const readonly = mode === 'plan'
      if (readonly && key === 'amp') {
        expect(w.launches.length).toBe(0)
        expect(results.at(-1)?.result.answer).toContain('plan requires read-only')
      } else {
        expect(w.launches.length).toBe(1)
        if (key === 'codex') expect(argv).toContain(readonly ? 'read-only' : 'workspace-write')
        if (key === 'cursor') { expect(argv.includes('--force')).toBe(!readonly); expect(argv.includes('ask')).toBe(readonly) }
        if (key === 'pi') expect(argv.includes('read,grep,find,ls')).toBe(readonly)
      }
      expect(w.asks.length).toBe(!['plan', 'bypassPermissions'].includes(mode) && key !== 'codex' ? 1 : 0)
      if (!['plan', 'bypassPermissions'].includes(mode) && key !== 'codex') {
        expect(w.answer).toBe('Allow this run')
        expect(results[0]?.chunks.some(c => c.kind === 'thinking' && c.text.includes('access: full (person)'))).toBe(true)
      }
    })
  }
  for (const answer of ['Allow this run', 'Run read-only instead', 'Refuse', 'unavailable', 'dismissed', 'throw']) {
    if (key === 'codex') continue
    test(`follow ${key} default decision ${answer}`, async ($, on) => {
      const w = world(on, [])
      w.answer = answer
      w.askThrows = ['unavailable', 'dismissed', 'throw'].includes(answer)
      const results = await run($, w, key, 'default')
      const unavailable = ['unavailable', 'dismissed', 'throw'].includes(answer)
      const read = key !== 'amp' && (answer === 'Run read-only instead' || unavailable)
      const launched = read || answer === 'Allow this run'
      expect(w.launches.length).toBe(launched ? 1 : 0)
      expect(w.asks.length).toBe(1)
      expect(w.checks.some(c => !c.tool_use_id)).toBe(false)
      if (unavailable && key !== 'amp') expect(results[0]?.chunks.some(c => c.kind === 'thinking' && c.text.includes('access: read-only (no answer)'))).toBe(true)
      if (read) expect(harnessArgv(w.launches[0])).toContain(key === 'cursor' ? 'ask' : 'read,grep,find,ls')
      if (!launched) expect(results.at(-1)?.result.answer).toContain(`${key}Access`)
    })
  }
}

for (const key of ['codex', 'cursor', 'pi', 'amp', 'devin']) {
  for (const mode of ['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan']) {
    test(`explicit ${key} full in ${mode}`, { options: { [`${key}Access`]: 'full' } }, async ($, on) => {
      const w = world(on, [])
      const results = await run($, w, key, mode)
      expect(w.asks.length).toBe(0)
      const fails = (key === 'amp' && mode === 'plan') || (key === 'codex' && mode !== 'plan')
      expect(w.launches.length).toBe(fails ? 0 : 1)
      if (fails) expect(results.at(-1)?.result.answer).toContain('could not start')
      if (mode === 'plan' && key === 'cursor') expect(harnessArgv(w.launches[0])).not.toContain('--force')
    })
  }
}

for (const scenario of ['allow', 'deny', 'person allow', 'person refuse', 'nobody', 'dismissed', 'check throws', 'ask throws']) {
  test(`ACP follow default: ${scenario}`, async ($, on) => {
    const w = world(on, FIRST)
    w.verdict = { decision: scenario === 'allow' ? 'allow' : scenario === 'deny' ? 'deny' : 'ask', reason: 'engine reason' }
    w.answer = scenario === 'person allow' ? 'Allow once' : 'Refuse'
    w.checkThrows = scenario === 'check throws'
    w.askThrows = ['nobody', 'dismissed', 'ask throws'].includes(scenario)
    const results = await run($, w, 'devin', 'default')
    const reply = w.inWrites.find(m => m.result?.outcome)
    expect(reply.result.outcome.optionId).toBe(['allow', 'person allow'].includes(scenario) ? 'allow_once' : 'reject_once')
    const command = w.checks.find(e => e.tool === 'Bash')
    expect(command.input.command).toBe('mkdir -p out && cp notes.txt out/ && cat out/notes.txt')
    expect(w.asks.length).toBe(['person allow', 'person refuse', 'nobody', 'dismissed', 'ask throws'].includes(scenario) ? 1 : 0)
    const permission = results.find(s => (s.result.toolUses[0]?.input as any)?.kind === 'permission')
    if (['person allow', 'person refuse'].includes(scenario)) expect((permission?.result.toolUses[0]?.input as any).who).toBe('person')
    if (['nobody', 'dismissed', 'ask throws'].includes(scenario)) expect((permission?.result.toolUses[0]?.input as any).who).toBe('no answer')
    if (scenario === 'deny') {
      const row = results.find(s => (s.result.toolUses[0]?.input as any)?.kind === 'permission')!
      expect(String((row as any).rowAnswer.result)).toContain('engine reason')
    }
  })
}
for (const mode of ['bypassPermissions', 'plan', 'acceptEdits']) {
  test(`ACP follow ${mode}`, async ($, on) => {
    const w = world(on, FIRST)
    await run($, w, 'devin', mode)
    expect(w.inWrites.find(m => m.method === 'session/set_mode').params.modeId).toBe(mode === 'plan' ? 'ask' : 'accept-edits')
    if (mode !== 'acceptEdits') expect(w.checks.length).toBe(0)
    expect(w.inWrites.find(m => m.result?.outcome).result.outcome.optionId).toBe(mode === 'plan' ? 'reject_once' : 'allow_once')
  })
}
for (const access of ['read-only', 'workspace-write']) {
  test(`ACP explicit ${access}`, { options: { devinAccess: access } }, async ($, on) => {
    const w = world(on, FIRST)
    await run($, w, 'devin', 'default')
    expect(w.checks.length).toBe(0)
    expect(w.asks.length).toBe(0)
    expect(w.inWrites.find(m => m.method === 'session/set_mode').params.modeId).toBe(access === 'read-only' ? 'ask' : 'accept-edits')
    expect(w.inWrites.find(m => m.result?.outcome).result.outcome.optionId).toBe(access === 'read-only' ? 'reject_once' : 'allow_once')
  })
}

test('legacy sandbox fallback only for non-default values and no explicit Access', () => {
  for (const a of HARNESSES) {
    expect(settingsFor(a, {}).access).toBe('follow')
    if (!a.sandboxes) continue
    expect(settingsFor(a, { [`${a.key}Sandbox`]: 'workspace-write' }).access).toBe('follow')
    expect(settingsFor(a, { [`${a.key}Sandbox`]: 'read-only', [`${a.key}Access`]: 'follow' }).access).toBe('read-only')
    expect(settingsFor(a, { [`${a.key}Sandbox`]: 'read-only', [`${a.key}Access`]: 'full' }).access).toBe('full')
  }
})

for (const kind of ['check', 'ask']) {
  test(`ACP ${kind} timeout refuses`, async ($, on) => {
    const w = world(on, FIRST)
    w.timeoutMs = kind === 'check' ? 60_000 : 300_000
    w.checkHold = kind === 'check'
    w.askHold = kind === 'ask'
    w.verdict = { decision: 'ask' }
    await run($, w, 'devin', 'default')
    expect(w.inWrites.find(m => m.result?.outcome).result.outcome.optionId).toBe('reject_once')
  })
  for (const key of ['cursor', 'pi', 'amp']) {
    test(`${key} ${kind === 'check' ? 'rejected ask' : 'ask timeout'} never gives full access`, async ($, on) => {
      const w = world(on, [])
      w.timeoutMs = 300_000
      w.askThrows = kind === 'check'
      w.askHold = kind === 'ask'
      await run($, w, key, 'default')
      if (key === 'amp') expect(w.launches.length).toBe(0)
      else expect(harnessArgv(w.launches[0])).toContain(key === 'pi' ? 'read,grep,find,ls' : 'ask')
    })
  }
}

for (const [kind, tool, rawInput] of [
  ['read', 'Read', { file_path: '/repo/a.txt' }],
  ['edit', 'Edit', { file_path: '/repo/a.txt', old_string: 'a', new_string: 'b' }],
  ['write', 'Write', { file_path: '/repo/a.txt', content: 'b' }],
  ['fetch', 'WebFetch', { url: 'https://example.invalid' }],
] as const) {
  test(`ACP maps ${kind} to ${tool}`, async ($, on) => {
    const request = { jsonrpc: '2.0', id: 'permission', method: 'session/request_permission', params: {
      toolCall: { toolCallId: 'q', kind, rawInput },
      options: [{ kind: 'allow_once', optionId: 'yes' }, { kind: 'reject_once', optionId: 'no' }],
    } }
    const w = world(on, [...FIRST.slice(0, 3), JSON.stringify(request)])
    await run($, w, 'devin', 'default')
    expect(w.checks.find(c => c.tool === tool)?.input).toEqual(tool === 'WebFetch' ? { ...rawInput, prompt: 'Fetch' } : rawInput)
    expect(w.inWrites.find(m => m.id === 'permission').result.outcome.optionId).toBe('yes')
    expect(w.asks.length).toBe(0)
  })
}

test('unknown ACP action asks directly and never selects always', async ($, on) => {
  const w = world(on, [...FIRST.slice(0, 3), JSON.stringify({ jsonrpc: '2.0', id: 'unknown', method: 'session/request_permission', params: {
    toolCall: { toolCallId: 'unknown', kind: 'mystery', title: 'unknown action' },
    options: [{ kind: 'allow_always', optionId: 'always' }, { kind: 'reject_once', optionId: 'no' }],
  } })])
  w.answer = 'Allow once'
  await run($, w, 'devin', 'default')
  expect(w.asks.length).toBe(1)
  expect(w.checks.some(c => !c.tool_use_id)).toBe(false)
  expect(w.inWrites.find(m => m.id === 'unknown').result.outcome).toEqual({ outcome: 'cancelled' })
})

for (const mode of ['plan', 'default', 'acceptEdits']) {
  test(`ACP ${mode} protective mode failure sends no prompt`, async ($, on) => {
    const w = world(on, [...FIRST.slice(0, 2), JSON.stringify({ jsonrpc: '2.0', id: 3, error: { message: 'unsupported mode' } })])
    const results = await run($, w, 'devin', mode)
    expect(w.inWrites.some(m => m.method === 'session/prompt')).toBe(false)
    expect(results.at(-1)?.result.answer).toContain('unsupported mode')
  })
}

test('missing agent mode never borrows bypassPermissions from another spawn', async ($, on) => {
  const w = world(on, [])
  await boot($, w, 'hitch:cursor', 'bypassPermissions')
  // A different agent is visible but has no spawn-mode metadata in hitch.
  w.agents.push({ ...w.agents[0]!, id: 'unobserved' })
  await $.turn.start({ text: 'task', turnId: 't1', agentId: 'unobserved' })
  await drain($.turn.step(step({ agentId: 'unobserved' })))
  expect(harnessArgv(w.launches[0])).toContain('ask')
  expect(harnessArgv(w.launches[0])).not.toContain('--force')
})

// Registration is synchronous: record the actual entrypoint's hook names.
test('hitch registers no tool.check observer or gate', () => {
  const events: string[] = []
  const on = (event: string) => {
    events.push(event)
    return { catch: () => undefined }
  }
  register(on as any, {})
  expect(events).not.toContain('tool.check')
  expect(events).toContain('turn.step')
})
