import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executePlan, runHarnessTest, testSkipped, ApplyError } from '../src/apply.mjs'
import { buildPlan } from '../src/plan.mjs'
import { fakeRun, pluginState } from './helpers.mjs'

test('apply: runs every command in order through the injected run', async () => {
  const run = fakeRun([
    { match: 'claude plugin marketplace add DannyAziz/hitch', result: { code: 0, stdout: '', stderr: '' } },
    { match: 'claude plugin install hitch@hitch', result: { code: 0, stdout: '', stderr: '' } },
    { match: argv => argv[0] === 'claude' && argv[1] === 'plugin' && argv[2] === 'configure', result: { code: 0, stdout: '', stderr: '' } },
  ])
  const plan = buildPlan({ state: pluginState(), values: { codexEnabled: 'true' } })
  const done = await executePlan(run, plan)
  assert.equal(done.length, 3)
  assert.equal(run.calls.length, 3)
  // settings JSON went to stdin of the configure call
  const configure = run.calls.at(-1)
  assert.equal(configure.argv.at(-1), '--values-stdin')
  assert.equal(configure.opts.input, plan.settingsJson)
})

test('apply: a failing command stops with nothing further run', async () => {
  const run = fakeRun([
    { match: 'claude plugin marketplace add DannyAziz/hitch', result: { code: 0, stdout: '', stderr: '' } },
    { match: 'claude plugin install hitch@hitch', result: { code: 1, stdout: '', stderr: 'clone failed\nmore detail' } },
    { match: argv => argv[2] === 'configure', result: { code: 0, stdout: '', stderr: '' } },
  ])
  const plan = buildPlan({ state: pluginState(), values: {} })
  await assert.rejects(executePlan(run, plan), err => {
    assert.ok(err instanceof ApplyError)
    assert.match(err.message, /install hitch@hitch failed: clone failed/)
    assert.equal(err.completed.length, 1)
    assert.equal(err.remaining.length, 1)
    assert.match(err.remaining[0].label, /configure/)
    return true
  })
  assert.equal(run.calls.length, 2, 'the configure command must never run')
})

test('apply: spawn failure also stops the plan', async () => {
  const run = fakeRun([
    { match: 'claude plugin marketplace add DannyAziz/hitch', result: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) },
  ])
  const plan = buildPlan({ state: pluginState(), values: {} })
  await assert.rejects(executePlan(run, plan), /could not run/)
  assert.equal(run.calls.length, 1)
})

test('apply: dry run reports commands but never calls run', async () => {
  const run = fakeRun()
  const plan = buildPlan({ state: pluginState(), values: { codexEnabled: 'true' } })
  const steps = []
  const done = await executePlan(run, plan, { dryRun: true, onStep: s => steps.push(s.phase) })
  assert.deepEqual(done, [])
  assert.equal(run.calls.length, 0, 'dry run must not execute anything')
  assert.ok(steps.includes('dry'))
})

test('test: runHarnessTest passes when output contains pong', async () => {
  const run = fakeRun([{ match: argv => argv[0] === 'claude' && argv[1] === '-p', result: { code: 0, stdout: 'pong\n', stderr: '' } }])
  const r = await runHarnessTest(run, 'codex')
  assert.equal(r.result, 'pass')
  const call = run.calls[0]
  assert.equal(call.argv[0], 'claude')
  assert.equal(call.argv[1], '-p')
  assert.equal(call.argv.at(-2), '--model')
  assert.equal(call.argv.at(-1), 'haiku')
  assert.match(call.argv[2], /hitch:codex/)
  assert.equal(call.opts.timeoutMs, 120000)
})

test('test: runHarnessTest fails with the first line of output', async () => {
  const run = fakeRun([{ match: argv => argv[1] === '-p', result: { code: 0, stdout: 'agent errored\nstack', stderr: '' } }])
  const r = await runHarnessTest(run, 'pi')
  assert.equal(r.result, 'fail')
  assert.equal(r.firstLine, 'agent errored')
})

test('test: amp under follow is skipped, other access runs', () => {
  assert.equal(testSkipped('amp', 'follow'), true)
  assert.equal(testSkipped('amp', 'full'), false)
  assert.equal(testSkipped('codex', 'follow'), false)
  assert.equal(testSkipped('codex', undefined), false)
})

test('state reading: plugin list + configure inputs through injected run', async () => {
  const { readPluginState, readPluginSettings } = await import('../src/state.mjs')
  const run = fakeRun([
    {
      match: 'claude plugin list --json',
      result: { code: 0, stdout: JSON.stringify([
        { id: 'hitch@inline', scope: 'session', enabled: true },
        { id: 'sec-default@builtin' },
      ]), stderr: '' },
    },
    { match: 'claude plugin marketplace list --json', result: { code: 0, stdout: '[]', stderr: '' } },
    {
      match: argv => argv[2] === 'configure',
      result: { code: 0, stdout: JSON.stringify({ pluginId: 'hitch@inline', inputs: { codexEnabled: 'false', eagerness: 'eager' } }), stderr: '' },
    },
  ])
  const state = await readPluginState(run)
  assert.equal(state.inlineLoaded, true)
  assert.equal(state.hitchInstalled, false)
  assert.equal(state.secDefault, true)
  const inputs = await readPluginSettings(run, 'hitch@inline')
  assert.equal(inputs.codexEnabled, 'false')
  assert.equal(inputs.eagerness, 'eager')
})

test('state reading: plugin list failure is an error, settings failure is empty', async () => {
  const { readPluginState, readPluginSettings } = await import('../src/state.mjs')
  const run = fakeRun([
    { match: 'claude plugin list --json', result: { code: 1, stdout: '', stderr: 'denied' } },
  ])
  await assert.rejects(readPluginState(run), /installed plugins/)
  const inputs = await readPluginSettings(run, 'hitch@hitch')
  assert.deepEqual(inputs, {})
})
