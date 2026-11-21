import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  answersFromYes,
  buildSettingsValues,
  promptDefaults,
  validateAnswers,
} from '../src/settings.mjs'
import { buildPlan } from '../src/plan.mjs'
import { reviewText, actionText } from '../src/review.mjs'
import { parsePluginList, parseConfigureInputs, parseMarketplaceList } from '../src/parse.mjs'
import { HARNESSES } from '../src/harnesses.mjs'
import { makeDetection, pluginState } from './helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pluginJson = JSON.parse(readFileSync(join(here, '..', '..', '.claude-plugin', 'plugin.json'), 'utf8'))
const SCHEMA = pluginJson.userConfig

function assertSchemaValid(values) {
  for (const [key, value] of Object.entries(values)) {
    assert.equal(typeof value, 'string', `${key} must be a string`)
    assert.ok(!/[\r\n]/.test(value), `${key} must be single-line`)
    assert.ok(key in SCHEMA, `${key} is not a declared option`)
    const schema = SCHEMA[key]
    if (schema.options) assert.ok(schema.options.map(String).includes(value), `${key}=${value} not in ${schema.options}`)
    if (schema.type === 'boolean') assert.ok(['true', 'false'].includes(value), `${key} must be true/false`)
  }
}

const ALL = ['codex', 'cursor', 'amp', 'pi', 'devin']

function answers(overrides = {}) {
  return {
    chosen: [...ALL],
    models: Object.fromEntries(ALL.map(k => [k, SCHEMA[`${k}Model`].default])),
    accesses: Object.fromEntries(ALL.map(k => [k, 'follow'])),
    reviewer: '',
    builder: '',
    eagerness: 'ask-only',
    ...overrides,
  }
}

test('settings: defaults write Enabled/Model/Access for chosen, Enabled=false only for the rest', () => {
  const detection = makeDetection()
  const values = buildSettingsValues(answers(), {})
  assertSchemaValid(values)
  for (const k of ALL) {
    assert.equal(values[`${k}Enabled`], 'true')
    assert.equal(values[`${k}Model`], SCHEMA[`${k}Model`].default)
    assert.equal(values[`${k}Access`], 'follow')
  }
  assert.equal(values.reviewer, '')
  assert.equal(values.builder, '')
  assert.ok(!('prefer' in values), 'prefer is no longer a setting')
  assert.equal(values.eagerness, 'ask-only')
  assert.ok(!('hideRowTool' in values), 'hideRowTool untouched without sec-default')
})

test('settings: unchosen harnesses are disabled and keep their other options', () => {
  const values = buildSettingsValues(answers({ chosen: ['cursor', 'amp'] }), {})
  assertSchemaValid(values)
  for (const k of ['codex', 'pi', 'devin']) {
    assert.equal(values[`${k}Enabled`], 'false')
    assert.ok(!(`${k}Model` in values), `${k}Model must not be written`)
    assert.ok(!(`${k}Access` in values), `${k}Access must not be written`)
  }
  assert.equal(values.cursorEnabled, 'true')
  assert.equal(values.cursorModel, SCHEMA.cursorModel.default)
  assert.equal(values.ampEnabled, 'true')
})

test('settings: fully customised run — every value a string and schema-allowed', () => {
  const values = buildSettingsValues(answers({
    chosen: ['codex', 'cursor', 'amp'],
    models: { codex: 'gpt-6.2-sol', cursor: 'gpt-5.3-codex-high', amp: 'high' },
    accesses: { codex: 'workspace-write', cursor: 'full', amp: 'full' },
    reviewer: 'codex',
    builder: 'amp',
    eagerness: 'eager',
  }), { secDefault: true })
  assertSchemaValid(values)
  assert.equal(values.codexModel, 'gpt-6.2-sol')
  assert.equal(values.cursorAccess, 'full')
  assert.equal(values.ampModel, 'high')
  assert.equal(values.reviewer, 'codex')
  assert.equal(values.builder, 'amp')
  assert.equal(values.eagerness, 'eager')
  assert.equal(values.hideRowTool, 'false')
  for (const k of ['pi', 'devin']) assert.equal(values[`${k}Enabled`], 'false')
})

test('settings: reviewer/builder that were not chosen become empty', () => {
  const values = buildSettingsValues(answers({ chosen: ['codex'], reviewer: 'devin', builder: 'pi' }), {})
  assert.equal(values.reviewer, '')
  assert.equal(values.builder, '')
  assertSchemaValid(values)
})

test('settings: values are single-line even if an answer contains newlines', () => {
  const values = buildSettingsValues(answers({ models: { codex: 'gpt-6-astra\nINJECT' } }), {})
  assert.equal(values.codexModel, 'gpt-6-astra INJECT')
  assertSchemaValid(values)
})

test('validateAnswers: reviewer or builder not chosen is a problem', () => {
  const detection = makeDetection()
  assert.deepEqual(validateAnswers(answers({ chosen: ['codex'], reviewer: 'devin' }), detection), [
    'reviewer must be a chosen harness',
  ])
  assert.deepEqual(validateAnswers(answers({ chosen: [] }), detection), ['pick at least one harness'])
  assert.deepEqual(validateAnswers(answers({ chosen: ['codex'], reviewer: 'codex', builder: 'codex' }), detection), [])
})

test('plan: nothing installed → marketplace add + install + configure hitch@hitch', () => {
  const values = buildSettingsValues(answers({ chosen: ['codex'] }), {})
  const plan = buildPlan({ state: pluginState(), values })
  assert.equal(plan.action, 'install')
  assert.equal(plan.targetId, 'hitch@hitch')
  assert.deepEqual(plan.commands.map(c => c.argv), [
    ['claude', 'plugin', 'marketplace', 'add', 'DannyAziz/hitch'],
    ['claude', 'plugin', 'install', 'hitch@hitch'],
    ['claude', 'plugin', 'configure', 'hitch@hitch', '--values-stdin'],
  ])
  assert.equal(plan.commands.at(-1).input, plan.settingsJson)
  assert.deepEqual(JSON.parse(plan.settingsJson), values)
})

test('plan: marketplace already known skips the add step', () => {
  const plan = buildPlan({ state: pluginState({ marketplaceKnown: true }), values: {} })
  assert.deepEqual(plan.commands.map(c => c.argv.slice(0, 3)), [
    ['claude', 'plugin', 'install'],
    ['claude', 'plugin', 'configure'],
  ])
})

test('plan: hitch@hitch installed → configure only; --update adds update commands', () => {
  const state = pluginState({ hitchInstalled: true, marketplaceKnown: true })
  const plan = buildPlan({ state, values: {} })
  assert.equal(plan.action, 'configure')
  assert.equal(plan.targetId, 'hitch@hitch')
  assert.deepEqual(plan.commands.map(c => c.argv), [
    ['claude', 'plugin', 'configure', 'hitch@hitch', '--values-stdin'],
  ])

  const upd = buildPlan({ state, values: {}, update: true })
  assert.equal(upd.action, 'update')
  assert.deepEqual(upd.commands.map(c => c.argv), [
    ['claude', 'plugin', 'marketplace', 'update', 'hitch'],
    ['claude', 'plugin', 'update', 'hitch@hitch'],
    ['claude', 'plugin', 'configure', 'hitch@hitch', '--values-stdin'],
  ])
})

test('plan: hitch@inline loaded → configure inline, never a second install', () => {
  const plan = buildPlan({ state: pluginState({ inlineLoaded: true }), values: {}, update: true })
  assert.equal(plan.action, 'configure-inline')
  assert.equal(plan.targetId, 'hitch@inline')
  assert.equal(plan.commands.length, 1)
  assert.deepEqual(plan.commands[0].argv, ['claude', 'plugin', 'configure', 'hitch@inline', '--values-stdin'])
  assert.ok(!plan.commands.some(c => c.argv.includes('install')))
})

test('plan: both present prefers hitch@hitch', () => {
  const plan = buildPlan({ state: pluginState({ hitchInstalled: true, inlineLoaded: true }), values: {} })
  assert.equal(plan.targetId, 'hitch@hitch')
})

test('review: plain lines for the action, harnesses, rubric and commands', () => {
  const values = buildSettingsValues(answers({ chosen: ['codex'] }), {})
  const plan = buildPlan({ state: pluginState(), values })
  const text = reviewText(plan, values)
  assert.match(text, /Install the hitch plugin into Claude Code, then save these settings\./)
  assert.match(text, /claude plugin marketplace add DannyAziz\/hitch/)
  assert.match(text, /Harnesses on:\n  codex {3}gpt-6-astra\n {10}access: follows the session's permission mode/)
  assert.match(text, /Harnesses off: cursor, amp, pi, devin/)
  assert.match(text, /Claude uses hitch: only when you ask/)
  assert.match(text, /Reviews go to: {5}nobody in particular/)
  // The raw settings JSON is one very long line: the review must not print it.
  assert.doesNotMatch(text, /stdin:/)
  assert.doesNotMatch(text, /When several fit/)
  for (const line of text.split('\n')) assert.ok(line.length <= 78, `line too wide: ${line}`)
  assert.equal(
    actionText(buildPlan({ state: pluginState({ inlineLoaded: true }), values: {} })),
    'hitch is loaded from a folder on this machine. Only the settings change.',
  )
})

test('review: rubric choices show eagerness, reviewer and builder, never a tie-breaker', () => {
  const values = buildSettingsValues(answers({ chosen: ['codex', 'pi'], eagerness: 'rubric', reviewer: 'codex' }), {})
  const text = reviewText(buildPlan({ state: pluginState(), values }), values)
  assert.match(text, /Claude uses hitch: when a task suits a harness/)
  assert.match(text, /Reviews go to: {5}codex/)
  assert.match(text, /Builds go to: {6}nobody in particular/)
  assert.doesNotMatch(text, /When several fit/)
})

test('parsers: plugin list, marketplace list, configure inputs, sec-default', () => {
  const state = parsePluginList(JSON.stringify([
    { id: 'other@some-marketplace' },
    { id: 'hitch@inline', scope: 'session' },
    { id: 'sec-default@builtin' },
  ]))
  assert.deepEqual(state, { hitchInstalled: false, inlineLoaded: true, secDefault: true })

  assert.equal(parseMarketplaceList(JSON.stringify([{ name: 'hitch' }, { name: 'other' }])).marketplaceKnown, true)
  assert.equal(parseMarketplaceList(JSON.stringify([{ name: 'other' }])).marketplaceKnown, false)

  const inputs = parseConfigureInputs(JSON.stringify({ pluginId: 'hitch@inline', inputs: { codexModel: '', eagerness: 'eager' } }))
  assert.deepEqual(inputs, { codexModel: '', eagerness: 'eager' })
})

test('sec-default: hideRowTool=false only when the managed mod is detected', () => {
  const values = buildSettingsValues(answers(), { secDefault: true })
  assert.equal(values.hideRowTool, 'false')
  assertSchemaValid(values)
})

test('defaults: preselection is found + signed-in-or-unchecked + not disabled last run', () => {
  const detection = makeDetection({
    codex: { signIn: 'no' },
    cursor: { found: false },
    pi: { signIn: 'unknown' },
  })
  const defaults = promptDefaults({ detection, inputs: {} })
  // codex signed out and cursor missing drop out; pi (unchecked) and the rest stay.
  assert.deepEqual(defaults.selection, ['amp', 'pi', 'devin'])
})

test('defaults: a harness disabled on a previous run stays unselected', () => {
  const detection = makeDetection()
  const defaults = promptDefaults({ detection, inputs: { codexEnabled: 'false' } })
  assert.ok(!defaults.selection.includes('codex'))
  assert.ok(defaults.selection.includes('cursor'))
})

test('defaults: second run uses stored settings for every prompt', () => {
  const detection = makeDetection()
  const defaults = promptDefaults({
    detection,
    inputs: {
      codexModel: 'gpt-6.2-sol',
      cursorAccess: 'full',
      ampModel: 'high',
      reviewer: 'devin',
      builder: 'cursor',
      eagerness: 'rubric',
      piModel: '', // unset → schema default
      piAccess: 'workspace-write', // declared in plugin.json but unsupported by pi → follow
    },
  })
  assert.equal(defaults.models.codex, 'gpt-6.2-sol')
  assert.equal(defaults.models.pi, 'openrouter/~deepseek/deepseek-flash-latest')
  assert.equal(defaults.accesses.cursor, 'full')
  assert.equal(defaults.accesses.pi, 'follow') // stored value unsupported → follow
  assert.equal(defaults.reviewer, 'devin')
  assert.equal(defaults.builder, 'cursor')
  assert.equal(defaults.eagerness, 'rubric')
  // a stored reviewer that is not installed falls back to none
  const d2 = promptDefaults({ detection: makeDetection({ devin: { found: false } }), inputs: { reviewer: 'devin' } })
  assert.equal(d2.reviewer, '')
})

test('--yes: chooses the eligible found harnesses with defaults everywhere', () => {
  const detection = makeDetection({
    codex: { signIn: 'no' }, // signed out → not eligible
    cursor: { found: false }, // missing → not eligible
  })
  const defaults = promptDefaults({ detection, inputs: {} })
  const a = answersFromYes(detection, defaults)
  assert.deepEqual([...a.chosen].sort(), ['amp', 'devin', 'pi'])
  assert.ok(!('prefer' in a))
  assert.equal(a.eagerness, 'ask-only')
  assert.equal(a.reviewer, '')
  assert.equal(a.builder, '')
  assert.deepEqual(validateAnswers(a, detection), [])
  const values = buildSettingsValues(a, {})
  assertSchemaValid(values)
  assert.equal(values.codexEnabled, 'false')
  assert.equal(values.cursorEnabled, 'false')
})

test('--yes on a second run keeps stored rubric answers', () => {
  const detection = makeDetection()
  const defaults = promptDefaults({
    detection,
    inputs: { reviewer: 'codex', builder: 'pi', eagerness: 'eager', codexEnabled: 'false' },
  })
  const a = answersFromYes(detection, defaults)
  assert.ok(!a.chosen.includes('codex')) // disabled last run stays off
  assert.equal(a.reviewer, '') // reviewer not chosen → none
  assert.equal(a.builder, 'pi')
  assert.ok(!('prefer' in a))
  assert.equal(a.eagerness, 'eager')
})

test('a stored prefer from an older install is ignored, not carried forward', () => {
  const detection = makeDetection()
  const defaults = promptDefaults({ detection, inputs: { prefer: 'strongest', eagerness: 'eager' } })
  assert.equal(defaults.eagerness, 'eager')
  assert.ok(!('prefer' in defaults))
  const values = buildSettingsValues(answersFromYes(detection, defaults), {})
  assert.ok(!('prefer' in values))
  assertSchemaValid(values)
})
