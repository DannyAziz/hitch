// The user settings: <key>Enabled, reviewer, builder, eagerness.
// A disabled harness is never registered; the rest reach Claude only
// through each agent type's description. These tests read what
// session.start registered, and what /hitch status and /hitch rubric say.

import { expect, test } from 'claude-code/testing'

import { THREAD } from '../hooks/harnesses/codex/fixture'
import { AGENT, boot, drain, lines, step, world } from './world'

const PONG = lines(
  { type: 'thread.started', thread_id: THREAD },
  { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'pong' } },
  { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 20 } },
)

const ASK_ONLY = 'Use only when the user asks for this harness by name or asks for another model\'s view.'
const RUBRIC = 'Use without being asked when the hitch delegation rubric fits the task.'
const EAGER = 'Prefer handing self-contained work to a harness over doing it yourself.'
const REVIEWER = 'The user\'s chosen harness for second opinions and reviews.'
const BUILDER = 'The user\'s chosen harness for well-specified builds.'

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
const command = ($: any, args: string) =>
  $.command.run({ command: 'hitch', args, origin: { kind: 'composer' } } as any)
const descriptions = (w: ReturnType<typeof world>) => w.registrations.map((r: any) => r.description as string)
const names = (w: ReturnType<typeof world>) => w.registrations.map((r: any) => r.name as string).sort()

test('defaults: the ask-only sentence on every description, no role or other eagerness sentence', async ($, on) => {
  const w = world(on, [])
  await start($)
  expect(names(w)).toEqual(['amp', 'codex', 'cursor', 'devin', 'pi'])
  for (const d of descriptions(w)) {
    expect(d).toContain(ASK_ONLY)
    // Each names its configured model and how a call picks another.
    expect(d).toMatch(/start the prompt or a follow-up with a line "model: <[\w/<>]+>"/)
    for (const s of [RUBRIC, EAGER, REVIEWER, BUILDER]) {
      expect(d).not.toContain(s)
    }
  }
})

test('codexEnabled false: hitch:codex is not registered and /hitch status lists it off', { options: { codexEnabled: false } }, async ($, on) => {
  const w = world(on, [])
  await start($)
  expect(names(w)).toEqual(['amp', 'cursor', 'devin', 'pi'])
  const out = await command($, 'status')
  expect(out.text).toContain('on cursor, amp, pi, devin')
  expect(out.text).toContain('off codex')
})

test('eagerness ask-only: its sentence on every description, and no other eagerness sentence', { options: { eagerness: 'ask-only' } }, async ($, on) => {
  const w = world(on, [])
  await start($)
  for (const d of descriptions(w)) {
    expect(d).toContain(ASK_ONLY)
    for (const s of [RUBRIC, EAGER]) expect(d).not.toContain(s)
  }
})

test('eagerness rubric: the rubric sentence on every description', { options: { eagerness: 'rubric' } }, async ($, on) => {
  const w = world(on, [])
  await start($)
  for (const d of descriptions(w)) {
    expect(d).toContain(RUBRIC)
    for (const s of [ASK_ONLY, EAGER]) expect(d).not.toContain(s)
  }
})

test('eagerness eager: the eager sentence on every description', { options: { eagerness: 'eager' } }, async ($, on) => {
  const w = world(on, [])
  await start($)
  for (const d of descriptions(w)) {
    expect(d).toContain(EAGER)
    for (const s of [ASK_ONLY, RUBRIC]) expect(d).not.toContain(s)
  }
})

test('reviewer and builder: their sentences appear only on the named harness', { options: { reviewer: 'codex', builder: 'devin' } }, async ($, on) => {
  const w = world(on, [])
  await start($)
  const byName = new Map(w.registrations.map((r: any) => [r.name as string, r.description as string]))
  expect(byName.get('codex')).toContain(REVIEWER)
  expect(byName.get('codex')).not.toContain(BUILDER)
  expect(byName.get('devin')).toContain(BUILDER)
  expect(byName.get('devin')).not.toContain(REVIEWER)
  for (const name of ['cursor', 'amp', 'pi']) {
    expect(byName.get(name)).not.toContain(REVIEWER)
    expect(byName.get(name)).not.toContain(BUILDER)
  }
})

test('a role naming an off or unknown harness is empty', { options: { reviewer: 'codex', builder: 'ghost', codexEnabled: false } }, async ($, on) => {
  const w = world(on, [])
  await start($)
  for (const d of descriptions(w)) {
    expect(d).not.toContain(REVIEWER)
    expect(d).not.toContain(BUILDER)
  }
})

test('/hitch rubric prints the current choices', { options: { codexEnabled: false, cursorEnabled: false, ampEnabled: false, piEnabled: false, reviewer: 'devin', builder: 'pi', eagerness: 'rubric' } }, async ($, on) => {
  const w = world(on, [])
  await start($)
  const out = await command($, 'rubric')
  expect(out.text).toContain('Harnesses on: devin')
  expect(out.text).toContain('Harnesses off: codex, cursor, amp, pi')
  expect(out.text).toContain('Reviewer: devin')
  expect(out.text).toContain('Builder: none')
  expect(out.text).not.toContain('Preference:')
  expect(out.text).toContain('Eagerness: rubric')
})

test('a disabled harness type still resolves for a running agent', { options: { codexEnabled: false } }, async ($, on) => {
  const w = world(on, PONG)
  await boot($, w, 'hitch:codex')
  await $.turn.start({ text: 'Reply pong', turnId: 't1', agentId: AGENT })
  const { result } = await drain($.turn.step(step()))
  expect(result.answer).toBe('pong')
})
