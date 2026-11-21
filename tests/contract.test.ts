// The contract every harness entry must meet, run against each entry of the
// table with its own recorded fixture (hooks/harnesses/<key>/fixture.ts,
// listed in hooks/harnesses/fixtures.ts):
//
// - a first turn yields its rows (calls of the shared HitchLog tool, each
//   naming the harness) and ends on a clean closing report;
// - no step reaches the Claude request, and no step reports usage;
// - closing a step mid-run stops the harness's supervisor;
// - a follow-up is continued (a second run, its own closing report) when the
//   entry's default transport can resume, and refused with "cannot be
//   continued" when it can't.

import { expect, test } from 'claude-code/testing'
import type { TurnStepChunk, TurnStepResult } from 'claude-code'

import { settingsFor, typeOf } from '../hooks/core/harness'
import { type HarnessEvent, canResume } from '../hooks/core/types'
import { type ParserMemo, jsonlEvents } from '../hooks/transports/cli-jsonl'
import { HARNESSES } from '../hooks/harnesses'
import { FIXTURES } from '../hooks/harnesses/fixtures'
import { AGENT, type World, answerRow, boot, drain, spawnInput, step, world } from './world'

async function turn($: any, w: World, turnId: string, text: string) {
  await $.turn.start({ text, turnId, agentId: AGENT })
  const steps: { chunks: TurnStepChunk[]; result: TurnStepResult }[] = []
  for (let i = 0; i < 20; i++) {
    const s = await drain($.turn.step(step({ turnId, index: i })))
    steps.push(s)
    if (s.result.stopReason !== 'tool_use') break
    await answerRow($, s.chunks)
  }
  return steps
}

test('every harness in the table has a recorded fixture', () => {
  for (const a of HARNESSES) expect(FIXTURES[a.key] !== undefined).toBe(true)
})

for (const a of HARNESSES) {
  const fx = FIXTURES[a.key]
  if (!fx) continue
  const type = typeOf(a)
  const transport = settingsFor(a, {}).transport

  test(`contract ${type}: a first turn yields its rows and a clean closing report, with no Claude request and no usage`, async ($, on) => {
    const w = world(on, fx.first, fx.shell)
    await boot($, w, type)
    const steps = await turn($, w, 't1', 'the task')
    const rows = steps.filter(s => s.result.stopReason === 'tool_use')
    expect(rows.length).toBe(fx.rows)
    for (const r of rows) {
      expect(r.result.toolUses[0]?.name).toBe('HitchLog')
      expect((r.result.toolUses[0]?.input as { harness?: string }).harness).toBe(a.key)
    }
    const last = steps.at(-1)!
    expect(last.result.stopReason).toBe('end_turn')
    expect(last.result.answer).toBe(fx.closing)
    expect(steps.every(s => s.result.usage === null)).toBe(true)
    // Default follow never starts an unrestricted run without consent.
    const decision = w.delegations.at(-1)?.access
    const access = decision?.level
    if (access === 'full') {
      if (decision.decider === 'session grant') {
        expect(w.grants).toContain(a.key)
        expect(w.answered.some(q => q.answer === `Allow hitch:${a.key} for this session`)).toBe(true)
      } else {
        expect(decision.decider).toBe('person')
        expect(w.asks.length).toBe(1)
        expect(w.answer).toBe('Allow this run')
      }
    } else {
      expect(['read-only', 'workspace-write'].includes(access)).toBe(true)
      if (access === 'workspace-write') expect(a.workspaceSandbox).toBe(true)
    }
    if (transport === 'acp') {
      expect(w.inWrites.find(m => m.method === 'session/set_mode').params.modeId).toBe('ask')
      const permissions = w.inWrites.filter(m => m.result?.outcome?.optionId === 'allow_once')
      for (const _ of permissions) expect(w.checks.some(c => c.tool === 'Bash')).toBe(true)
    }
    expect(w.sent).toEqual([])
    expect(w.toolRan).toEqual([])
  })

  test(`contract ${type}: closing a step mid-run stops the harness`, async ($, on) => {
    const w = world(on, fx.first.slice(0, 2), fx.shell)
    w.end = ''
    await boot($, w, type)
    await $.turn.start({ text: 'the task', turnId: 't1', agentId: AGENT })
    const stream = $.turn.step(step())
    await stream.next()
    await stream.return(undefined as never)
    const killed =
      w.runs.some(r => r[0] === 'kill' && r[2] === '4242') ||
      w.runs.some(r => String(r[2]).includes('kill') && r[4] === '4242')
    expect(killed).toBe(true)
    expect(w.sent).toEqual([])
  })

  test(`contract ${type}: a follow-up is ${canResume(a, transport) ? 'continued' : 'refused'} as the entry declares (${transport})`, async ($, on) => {
    const w = world(on, fx.first, fx.shell)
    await boot($, w, type)
    await turn($, w, 't1', 'the task')
    await $.agent.spawn({ ...spawnInput(type), prompt: 'and then?', permissionMode: 'default', resume: { agentId: AGENT } })
    if (canResume(a, transport)) {
      expect(fx.followUp !== undefined).toBe(true)
      w.stream = fx.followUp ?? []
      const steps = await turn($, w, 't2', 'and then?')
      expect(w.launches.length).toBe(2)
      if (['cursor', 'pi', 'amp'].includes(a.key)) expect(w.asks.length).toBe(2)
      expect(steps.at(-1)?.result.answer).toBe(fx.followUpClosing ?? '')
    } else {
      const steps = await turn($, w, 't2', 'and then?')
      expect(w.launches.length).toBe(1)
      expect(steps.at(-1)?.result.answer).toContain('cannot be continued')
    }
    expect(w.sent).toEqual([])
  })
}

// Compare complete events too: rows alone would miss mixed usage or thinking.
for (const a of HARNESSES) {
  const cli = a.transports['cli-jsonl']
  const fx = FIXTURES[a.key]
  if (!cli || !fx) continue

  function alone() {
    const memo: ParserMemo = {}
    return fx!.first.flatMap(line => jsonlEvents(cli!, line, memo))
  }

  function check(events: HarnessEvent[], expected: HarnessEvent[]) {
    expect(events).toEqual(expected)
    const rows = events.flatMap(e => e.action ? [e.action] : [])
    expect(rows).toEqual(expected.flatMap(e => e.action ? [e.action] : []))
    expect(rows.length).toBe(fx!.rows)
    expect(events.filter(e => e.message).at(-1)?.message).toBe(fx!.closing)
  }

  test(`contract hitch:${a.key}: strictly interleaved JSONL runs are isolated`, () => {
    const expected = alone()
    // Even the same conversation and tool ids must be isolated by run.
    const memoA: ParserMemo = {}
    const memoB: ParserMemo = {}
    const eventsA: HarnessEvent[] = []
    const eventsB: HarnessEvent[] = []
    for (const line of fx.first) {
      eventsA.push(...jsonlEvents(cli, line, memoA))
      eventsB.push(...jsonlEvents(cli, line, memoB))
    }
    check(eventsA, expected)
    check(eventsB, expected)
  })

  test(`contract hitch:${a.key}: JSON round-tripped memo continues the fixture`, () => {
    const expected = alone()
    // Include halfway, and every other boundary to cover pending tools,
    // running usage and incomplete thinking regardless of fixture length.
    for (let split = 1; split < fx.first.length; split++) {
      let memo: ParserMemo = {}
      const events: HarnessEvent[] = []
      for (const [index, line] of fx.first.entries()) {
        if (index === split) memo = JSON.parse(JSON.stringify(memo))
        events.push(...jsonlEvents(cli, line, memo))
      }
      check(events, expected)
    }
  })
}
