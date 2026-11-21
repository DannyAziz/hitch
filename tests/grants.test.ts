import { expect, test } from 'claude-code/testing'
import { agentInfo, answerRow, drain, harnessArgv, spawnInput, step, world, type World } from './world'
import { FIXTURES } from '../hooks/harnesses/fixtures'
import { FIRST } from '../hooks/harnesses/devin/fixture'

async function turn($: any, w: World, key: string, id: string, mode = 'default', follow = false) {
  w.spawnId = id
  if (!w.agents.some(a => a.id === id)) w.agents.push(agentInfo(id, `hitch:${key}`))
  await $.agent.spawn({ ...spawnInput(`hitch:${key}`), permissionMode: mode, ...(follow && { resume: { agentId: id } }) })
  const turnId = `${id}-${w.launches.length}-${w.asks.length}`
  await $.turn.start({ text: 'task', turnId, agentId: id })
  const results = []
  for (let index = 0; index < 12; index++) {
    const s = await drain($.turn.step(step({ agentId: id, turnId, index })))
    results.push(s)
    if (s.result.stopReason !== 'tool_use') break
    // These tests inspect row inputs; no action is executed by answering one.
    await answerRow($, s.chunks, id)
  }
  expect(w.toolRan).toEqual([])
  return results
}

async function command($: any, args: string) {
  return $.command.run({ command: 'hitch', args, origin: { kind: 'composer' } })
}

for (const key of ['cursor', 'pi', 'amp']) {
  test(`${key} session grant covers new agents and follow-ups, survives state reload, plan wins, revoke asks again`, async ($, on) => {
    const fx = FIXTURES[key]!
    const w = world(on, fx.first, fx.shell)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    w.answer = `Allow hitch:${key} for this session`
    await turn($, w, key, 'first')
    expect(w.grants).toEqual([key])
    expect(w.asks.length).toBe(1)
    const labels = w.asks[0].questions[0].options.map((o: any) => o.label)
    expect(labels).toEqual(['Allow this run', w.answer, ...(key !== 'amp' ? ['Run read-only instead'] : []), 'Refuse'])
    expect(w.delegations.at(-1).access).toEqual({ level: 'full', decider: 'session grant' })
    // Replace the state backend with its serialized snapshot, as after reload.
    w.grants = JSON.parse(JSON.stringify(w.grants))
    const second = await turn($, w, key, 'second')
    expect(w.asks.length).toBe(1)
    expect(second[0]?.chunks.some(c => c.kind === 'thinking' && c.text.includes('access: full (session grant)'))).toBe(true)
    w.stream = fx.followUp!
    await turn($, w, key, 'second', 'default', true)
    expect(w.asks.length).toBe(1)
    expect(w.launches.length).toBe(3)
    const plans = await turn($, w, key, 'plan', 'plan')
    expect(w.asks.length).toBe(1)
    if (key === 'amp') expect(plans.at(-1)?.result.answer).toContain('plan requires read-only')
    else expect(harnessArgv(w.launches.at(-1))).toContain(key === 'pi' ? 'read,grep,find,ls' : 'ask')
    const bypass = await turn($, w, key, 'bypass', 'bypassPermissions')
    expect(w.asks.length).toBe(1)
    expect(bypass[0]?.chunks.some(c => c.kind === 'thinking' && c.text.includes('(mode bypassPermissions)'))).toBe(true)
    expect((await command($, '')).text).toContain(`Session grants: hitch:${key}`)
    expect((await command($, `revoke ${key}`)).text).toContain(`Revoked session grants: hitch:${key}`)
    expect(w.grants).toEqual([])
    w.answer = 'Allow this run'
    await turn($, w, key, 'after-revoke')
    expect(w.asks.length).toBe(2)
    expect(w.delegations.at(-1).access).toEqual({ level: 'full', decider: 'person' })
    expect(w.grants).toEqual([])
    expect([...w.store.keys()].some(k => k.includes('grant'))).toBe(false)
  })
}

for (const answer of ['Allow this run', 'Allow hitch:pi for this session ', 'Allow hitch:cursor for this session', 'Refuse']) {
  test(`only exact grant answer persists: ${JSON.stringify(answer)}`, async ($, on) => {
    const w = world(on, [])
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    w.answer = answer
    await turn($, w, 'pi', 'p')
    expect(w.grants).toEqual([])
    expect(w.launches.length).toBe(answer === 'Allow this run' ? 1 : 0)
  })
}

test('grants are per harness; revoke all reports and clears each grant', async ($, on) => {
  const w = world(on, [])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const key of ['pi', 'cursor']) {
    w.answer = `Allow hitch:${key} for this session`
    await turn($, w, key, key)
  }
  expect(w.asks.length).toBe(2)
  expect(w.grants).toEqual(['pi', 'cursor'])
  expect((await command($, 'revoke pi')).text).toContain('Revoked session grants: hitch:pi')
  expect(w.grants).toEqual(['cursor'])
  w.answer = 'Allow hitch:pi for this session'
  await turn($, w, 'pi', 'pi-again')
  expect(w.asks.length).toBe(3)
  expect((await command($, 'revoke')).text).toContain('hitch:cursor, hitch:pi')
  expect(w.grants).toEqual([])
  expect((await command($, 'status')).text).toContain('Session grants: none')
  expect((await command($, 'revoke')).text).toContain('No matching')
})

test('ACP session grant replaces asks, never engine denials; revoke restores question', async ($, on) => {
  const w = world(on, FIRST)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.verdict = { decision: 'ask' }
  w.answer = 'Allow all hitch:devin requests this session'
  const first = await turn($, w, 'devin', 'd1')
  expect(w.grants).toEqual(['devin'])
  expect(w.asks[0].questions[0].options.map((o: any) => o.label)).toEqual(['Allow once', w.answer, 'Refuse'])
  const permission = (results: typeof first) => results.flatMap(s => s.result.toolUses).find(t => (t.input as any).kind === 'permission')?.input as any
  expect(permission(first).who).toBe('session grant')
  const second = await turn($, w, 'devin', 'd2')
  expect(w.asks.length).toBe(1)
  expect(permission(second).decision).toBe('allow_once')
  expect(permission(second).who).toBe('session grant')
  w.verdict = { decision: 'deny', reason: 'denied by engine', rule: 'Bash(*)' }
  const denied = await turn($, w, 'devin', 'd3')
  expect(permission(denied).decision).toBe('reject_once')
  expect(permission(denied).who).toBe('rule')
  expect(w.asks.length).toBe(1)
  w.verdict = { decision: 'ask' }
  const plan = await turn($, w, 'devin', 'd4', 'plan')
  expect(permission(plan).decision).toBe('reject_once')
  expect(w.asks.length).toBe(1)
  await command($, 'revoke devin')
  w.answer = 'Refuse'
  const revoked = await turn($, w, 'devin', 'd5')
  expect(permission(revoked).decision).toBe('reject_once')
  expect(w.asks.length).toBe(2)
})

for (const answer of ['Allow once', 'Allow all hitch:devin requests this session ', 'Refuse']) {
  test(`ACP only exact grant label persists: ${JSON.stringify(answer)}`, async ($, on) => {
    const w = world(on, FIRST)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    w.verdict = { decision: 'ask' }
    w.answer = answer
    await turn($, w, 'devin', 'd')
    expect(w.grants).toEqual([])
  })
}
