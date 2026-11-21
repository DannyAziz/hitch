// Shared fakes for the installer unit tests. No real commands are run.

import { HARNESSES } from '../src/harnesses.mjs'

export function enoent(cmd) {
  return Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' })
}

// routes: [{ match, result }] where match is an argv.join(' ') string, an
// argv array, or a predicate (argv) => bool. result is a result object, an
// Error to throw, or (argv, opts) => result.
export function fakeRun(routes = []) {
  const calls = []
  async function run(argv, opts = {}) {
    calls.push({ argv: [...argv], opts })
    for (const route of routes) {
      let hit = false
      if (typeof route.match === 'function') hit = route.match(argv)
      else if (Array.isArray(route.match)) hit = route.match.join(' ') === argv.join(' ')
      else hit = route.match === argv.join(' ')
      if (!hit) continue
      const r = typeof route.result === 'function' ? route.result(argv, opts) : route.result
      if (r instanceof Error) throw r
      return r
    }
    return { code: 1, stdout: '', stderr: `unexpected command: ${argv.join(' ')}`, timedOut: false }
  }
  run.calls = calls
  return run
}

const ok = (stdout, code = 0) => ({ code, stdout, stderr: '', timedOut: false })

// Canned read-only probe output in the shapes the real CLIs print (captured
// on this machine while building the installer).
export const PROBE = {
  'codex --version': ok('codex-cli 0.171.0\n'),
  'codex login status': ok('Logged in using ChatGPT\n'),
  'codex debug models --bundled': ok(JSON.stringify({
    models: [
      { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list' },
      { slug: 'gpt-6.2-sol', display_name: 'GPT-6.2-Sol', visibility: 'list' },
      { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hide' },
    ],
  })),
  'agent --version': ok('2026.11.19-f005e9d\n'),
  'agent status': ok('✓ Logged in as someone@example.com\nTeam: Example (id 1)\n'),
  'agent models': ok('Available models\n\nauto - Auto (current, default)\ngpt-5.3-codex - Codex 5.3\ncomposer-2.5 - Composer 2.5\n'),
  'amp --version': ok('0.0.1791288059-gdc93b0 (released 2026-10-06T12:00:59.000Z, 1mo ago)\n'),
  'amp account list': ok('* someone@example.com (user_01)\n'),
  'pi --version': ok('1.2.0\n'),
  'pi --list-models': ok('provider      model                             context  max-out  thinking  images\n'
    + 'openrouter    ~deepseek/deepseek-flash-latest     1.0M     943.7K   yes       yes\n'
    + 'openai-codex  gpt-5.5                             272K     128K     yes       yes\n'),
  'devin --version': ok('devin 3000.14.30821 (a09cd7f323ee)\n'),
  'devin auth status': ok('Logged in (via Devin).\n\nCredentials:\n  File: /x/credentials.toml\n'),
  'devin models': ok('Available models (1 families)\n\nSWE-2 (swe-2)\n  aliases: swe\n'
    + '  swe-2-high     SWE-2 High  [262K context, Free]\n'
    + '  swe-2-medium   SWE-2 Medium  [262K context, Free]\n'),
}

// pi's auth check argv depends on the configured model's provider.
export function probeRoutes(overrides = {}) {
  const routes = Object.entries({ ...PROBE, ...overrides }).map(([match, result]) => ({ match, result }))
  routes.push({
    match: argv => argv[0] === 'pi' && argv[1] === 'auth',
    result: ok('ready\n'),
  })
  return routes
}

// A detection result per harness, all found/eligible unless overridden.
export function makeDetection(overrides = {}) {
  return HARNESSES.map(h => ({
    key: h.key,
    label: h.label,
    binary: h.binary,
    vendor: h.vendor,
    testedVersion: h.testedVersion,
    found: true,
    version: h.testedVersion || 'unknown',
    versionDiffers: false,
    signIn: 'yes',
    models: null,
    note: null,
    ...(overrides[h.key] || {}),
  }))
}

export function pluginState(overrides = {}) {
  return {
    hitchInstalled: false,
    inlineLoaded: false,
    secDefault: false,
    marketplaceKnown: false,
    ...overrides,
  }
}
