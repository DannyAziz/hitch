// Static description of each harness hitch can drive, plus the read-only
// commands the installer uses to detect it. Mirrors hooks/harnesses/*/index.ts
// (defaultModel, accessLevels) and each harness README's "Tested with" line.
// Every command listed here is a --version, --help-class, status or list
// command: none of them makes a model call, signs in, or changes configuration.

export const HARNESSES = [
  {
    key: 'codex',
    label: 'Codex',
    binary: 'codex',
    vendor: "OpenAI's Codex CLI",
    testedVersion: '0.167.0',
    versionPattern: /(\d+\.\d+\.\d+)/,
    defaultModel: 'gpt-6-astra',
    accessLevels: ['read-only', 'workspace-write'],
    modelSource: 'codex-debug-models',
    versionArgv: ['codex', '--version'],
    statusArgv: ['codex', 'login', 'status'],
    modelsArgv: ['codex', 'debug', 'models', '--bundled'],
  },
  {
    key: 'cursor',
    label: 'Cursor',
    binary: 'agent',
    vendor: "Cursor's agent CLI",
    testedVersion: '2026.11.19-f005e9d',
    versionPattern: /^(\S+)/m,
    defaultModel: 'auto',
    accessLevels: ['read-only', 'full'],
    modelSource: 'cursor-models',
    versionArgv: ['agent', '--version'],
    statusArgv: ['agent', 'status'],
    modelsArgv: ['agent', 'models'],
  },
  {
    key: 'amp',
    label: 'Amp',
    binary: 'amp',
    vendor: 'Amp CLI',
    testedVersion: null, // recordings only; the CLI version was never captured
    versionPattern: /^(\S+)/m,
    defaultModel: 'medium',
    accessLevels: ['full'],
    modelSource: 'amp-modes',
    versionArgv: ['amp', '--version'],
    statusArgv: ['amp', 'account', 'list'],
    modelsArgv: null,
  },
  {
    key: 'pi',
    label: 'pi',
    binary: 'pi',
    vendor: 'pi CLI',
    testedVersion: '1.2.0',
    versionPattern: /^(\S+)/m,
    defaultModel: 'openrouter/~deepseek/deepseek-flash-latest',
    accessLevels: ['read-only', 'full'],
    modelSource: 'pi-list-models',
    versionArgv: ['pi', '--version'],
    // `pi auth check` needs a provider; use the one in the configured model.
    statusArgv: piModel => {
      const provider = providerOf(piModel)
      return provider ? ['pi', 'auth', 'check', '--provider', provider, '--no-refresh'] : null
    },
    modelsArgv: ['pi', '--list-models'],
  },
  {
    key: 'devin',
    label: 'Devin',
    binary: 'devin',
    vendor: "Cognition's Devin CLI",
    testedVersion: '3000.14.30821',
    versionPattern: /(\d+\.\d+\.\d+)/,
    defaultModel: 'swe-2-flash-high',
    accessLevels: ['read-only', 'workspace-write', 'full'],
    modelSource: 'devin-models',
    versionArgv: ['devin', '--version'],
    statusArgv: ['devin', 'auth', 'status'],
    modelsArgv: ['devin', 'models'],
  },
]

export const HARNESS_BY_KEY = Object.fromEntries(HARNESSES.map(h => [h.key, h]))

// Provider part of a `provider/model` string (pi splits at the first slash).
export function providerOf(model) {
  if (typeof model !== 'string') return null
  const i = model.indexOf('/')
  return i > 0 ? model.slice(0, i) : null
}

export const ACCESS_HINTS = {
  follow: "Follow the session's permission mode — asks before risky actions",
  'read-only': 'Read files and answer; no writes or commands (where supported)',
  'workspace-write': 'Edit files in the workspace; commands follow the harness',
  full: "Full access under the harness's own permissions",
}

export const AMP_MODES = [
  { value: 'low', label: 'low', hint: 'Fastest, least capable' },
  { value: 'medium', label: 'medium', hint: 'Balanced (default)' },
  { value: 'high', label: 'high', hint: 'More capable, slower' },
  { value: 'ultra', label: 'ultra', hint: 'Most capable' },
]

export const EAGERNESS_OPTIONS = [
  { value: 'ask-only', label: 'Only when I ask', hint: 'Claude uses a harness only when you name one or ask for another model' },
  { value: 'rubric', label: 'When a task suits a harness', hint: 'Claude may also hand off by itself, following the delegation guide hitch ships' },
  { value: 'eager', label: 'Whenever it can', hint: 'Claude hands off most self-contained work and mostly coordinates' },
]
