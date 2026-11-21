import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectHarnesses, formatDetection } from '../src/detect.mjs'
import { fakeRun, enoent, probeRoutes } from './helpers.mjs'

const PI_MODEL = 'openrouter/~deepseek/deepseek-flash-latest'

test('detection: all five found, signed in, versions and models parsed', async () => {
  const run = fakeRun(probeRoutes())
  const d = await detectHarnesses({ run, piModel: PI_MODEL })
  assert.equal(d.length, 5)
  const byKey = Object.fromEntries(d.map(x => [x.key, x]))

  assert.equal(byKey.codex.found, true)
  assert.equal(byKey.codex.version, '0.171.0')
  assert.equal(byKey.codex.versionDiffers, true) // tested with 0.167.0
  assert.equal(byKey.codex.signIn, 'yes')
  assert.deepEqual(byKey.codex.models.map(m => m.value), ['gpt-6-astra', 'gpt-6.2-sol'])

  assert.equal(byKey.cursor.found, true)
  assert.equal(byKey.cursor.version, '2026.11.19-f005e9d')
  assert.equal(byKey.cursor.versionDiffers, false)
  assert.equal(byKey.cursor.signIn, 'yes')
  assert.deepEqual(byKey.cursor.models.map(m => m.value), ['auto', 'gpt-5.3-codex', 'composer-2.5'])

  assert.equal(byKey.amp.found, true)
  assert.equal(byKey.amp.signIn, 'yes')
  assert.equal(byKey.amp.versionDiffers, false) // tested version unknown
  assert.equal(byKey.amp.models, null) // fixed modes, no list command

  assert.equal(byKey.pi.found, true)
  assert.equal(byKey.pi.version, '1.2.0')
  assert.equal(byKey.pi.versionDiffers, false)
  assert.equal(byKey.pi.signIn, 'yes')
  assert.deepEqual(byKey.pi.models.map(m => m.value), [
    'openrouter/~deepseek/deepseek-flash-latest',
    'openai-codex/gpt-5.5',
  ])

  assert.equal(byKey.devin.found, true)
  assert.equal(byKey.devin.version, '3000.14.30821')
  assert.equal(byKey.devin.versionDiffers, false)
  assert.equal(byKey.devin.signIn, 'yes')
  assert.deepEqual(byKey.devin.models.map(m => m.value), ['swe-2-high', 'swe-2-medium'])

  // pi's auth check used the provider from the configured model.
  const authCall = run.calls.find(c => c.argv[0] === 'pi' && c.argv[1] === 'auth')
  assert.ok(authCall)
  assert.deepEqual(authCall.argv.slice(0, 4), ['pi', 'auth', 'check', '--provider'])
  assert.equal(authCall.argv[4], 'openrouter')
})

test('detection: missing binary → found=false, others unaffected', async () => {
  const run = fakeRun(probeRoutes({ 'codex --version': enoent('codex') }))
  const d = await detectHarnesses({ run, piModel: PI_MODEL })
  const byKey = Object.fromEntries(d.map(x => [x.key, x]))
  assert.equal(byKey.codex.found, false)
  assert.equal(byKey.codex.signIn, 'unknown')
  assert.equal(byKey.codex.models, null)
  assert.equal(byKey.cursor.found, true)
  assert.equal(byKey.amp.found, true)
})

test('detection: not signed in', async () => {
  const run = fakeRun(probeRoutes({
    'codex login status': { code: 0, stdout: 'Not logged in\n', stderr: '' },
    'agent status': { code: 0, stdout: 'Not logged in\n', stderr: '' },
    'devin auth status': { code: 0, stdout: 'Not logged in.\n', stderr: '' },
  }))
  const d = await detectHarnesses({ run, piModel: PI_MODEL })
  const byKey = Object.fromEntries(d.map(x => [x.key, x]))
  assert.equal(byKey.codex.signIn, 'no')
  assert.equal(byKey.cursor.signIn, 'no')
  assert.equal(byKey.devin.signIn, 'no')
})

test('detection: sign-in not checked when the status command fails or is unclear', async () => {
  // amp's account list errors; pi's auth check prints something unrecognised.
  const routes = probeRoutes({ 'amp account list': { code: 1, stdout: '', stderr: 'boom' } })
    .map(r => (typeof r.match === 'function' ? { match: r.match, result: { code: 0, stdout: '', stderr: '' } } : r))
  const run = fakeRun(routes)
  const d = await detectHarnesses({ run, piModel: PI_MODEL })
  const byKey = Object.fromEntries(d.map(x => [x.key, x]))
  assert.equal(byKey.amp.signIn, 'unknown')
  assert.equal(byKey.pi.signIn, 'unknown')
})

test('detection: version mismatch and unparseable versions', async () => {
  const run = fakeRun(probeRoutes({
    'pi --version': { code: 0, stdout: '9.9.9\n', stderr: '' },
    'agent --version': { code: 0, stdout: '\n\n', stderr: '' },
  }))
  const d = await detectHarnesses({ run, piModel: PI_MODEL })
  const byKey = Object.fromEntries(d.map(x => [x.key, x]))
  assert.equal(byKey.pi.version, '9.9.9')
  assert.equal(byKey.pi.versionDiffers, true)
  assert.equal(byKey.cursor.versionDiffers, false) // 'unknown' never flags a diff
})

test('detection: model list failure falls back to text input (models null)', async () => {
  const run = fakeRun(probeRoutes({ 'devin models': { code: 1, stdout: '', stderr: 'no' } }))
  const d = await detectHarnesses({ run, piModel: PI_MODEL })
  const byKey = Object.fromEntries(d.map(x => [x.key, x]))
  assert.equal(byKey.devin.models, null)
  assert.equal(byKey.codex.models.length, 2)
})

test('formatDetection: compact one line per harness', async () => {
  const run = fakeRun(probeRoutes({ 'agent --version': enoent('agent') }))
  const d = await detectHarnesses({ run, piModel: PI_MODEL })
  const text = formatDetection(d)
  assert.match(text, /agent\s+not found — Cursor's agent CLI/)
  assert.match(text, /codex\s+0\.171\.0/)
  assert.match(text, /differs from tested 0\.167\.0/)
})
