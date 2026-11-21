// Pure parsers for the read-only probe output. Each takes the raw result of
// one `run()` call ({ code, stdout, stderr }) and returns plain data.

const text = r => `${r.stdout || ''}\n${r.stderr || ''}`

export function firstLine(s) {
  const line = String(s || '').split('\n').map(l => l.trim()).find(Boolean)
  return line || ''
}

// A version token from `--version` output, or null.
export function extractVersion(pattern, r) {
  const m = pattern.exec(text(r))
  return m ? m[1] : null
}

// 'yes' | 'no' | 'unknown' — whether the CLI looks signed in. Negative
// phrases are checked first because they contain the positive substring
// ("Not logged in" contains "logged in").
export function parseSignIn(key, r) {
  const t = text(r)
  switch (key) {
    case 'codex':
    case 'cursor':
    case 'devin':
      if (/not logged in|logged out|not authenticated|no credentials/i.test(t)) return 'no'
      if (/logged in|authenticated|signed in/i.test(t)) return 'yes'
      return 'unknown'
    case 'amp': {
      if (r.code !== 0) return 'unknown'
      const trimmed = t.trim()
      if (!trimmed || /no .*accounts?/i.test(trimmed)) return 'no'
      if (/@/.test(trimmed) || /^\s*\*/m.test(trimmed)) return 'yes'
      return 'unknown'
    }
    case 'pi': {
      if (/not ready|no credentials|missing credentials|unknown provider/i.test(t)) return 'no'
      if (/\bready\b/i.test(t)) return 'yes'
      return 'unknown'
    }
    default:
      return 'unknown'
  }
}

// Model list for the select prompt: [{ value, label, hint }], or null when
// the output can't be understood (caller falls back to a text input).
export function parseModelList(key, stdout) {
  switch (key) {
    case 'codex':
      return parseCodexModels(stdout)
    case 'cursor':
      return parseCursorModels(stdout)
    case 'pi':
      return parsePiModels(stdout)
    case 'devin':
      return parseDevinModels(stdout)
    default:
      return null
  }
}

function parseCodexModels(stdout) {
  let data
  try {
    data = JSON.parse(stdout)
  } catch {
    return null
  }
  const models = Array.isArray(data?.models) ? data.models : []
  const out = models
    .filter(m => m && typeof m.slug === 'string' && m.visibility === 'list')
    .map(m => ({
      value: m.slug,
      label: m.display_name || m.slug,
      hint: m.display_name && m.display_name !== m.slug ? m.slug : undefined,
    }))
  return out.length ? out : null
}

function parseCursorModels(stdout) {
  const out = []
  for (const line of String(stdout).split('\n')) {
    const m = /^(\S+)\s+-\s+(.+?)\s*$/.exec(line.trim())
    if (m) out.push({ value: m[1], label: `${m[1]} — ${m[2]}` })
  }
  return out.length ? out : null
}

function parsePiModels(stdout) {
  const out = []
  for (const line of String(stdout).split('\n')) {
    if (!line.trim() || /^provider\s+model/i.test(line)) continue
    const parts = line.trim().split(/\s{2,}/)
    if (parts.length < 2 || !parts[0] || !parts[1]) continue
    const [provider, model, context] = parts
    out.push({
      value: `${provider}/${model}`,
      label: `${provider}/${model}`,
      hint: context ? `${context} context` : undefined,
    })
  }
  return out.length ? out : null
}

function parseDevinModels(stdout) {
  const out = []
  for (const line of String(stdout).split('\n')) {
    const m = /^\s+(\S+)\s{2,}(.+?)\s*$/.exec(line)
    if (!m || m[1].endsWith(':')) continue
    out.push({ value: m[1], label: m[2] })
  }
  return out.length ? out : null
}

const json = input => (typeof input === 'string' ? JSON.parse(input) : input)

// `claude plugin list --json` → the fields the installer needs.
export function parsePluginList(input) {
  const list = json(input)
  if (!Array.isArray(list)) throw new Error('unexpected plugin list shape')
  return {
    hitchInstalled: list.some(p => p && p.id === 'hitch@hitch'),
    inlineLoaded: list.some(p => p && p.id === 'hitch@inline'),
    // The managed security mod is a builtin/managed plugin
    // (sec-default@builtin / cc-plugin-sec-default*); it may not appear in
    // this list at all, so a miss is inconclusive, not a negative.
    secDefault: list.some(p => p && /sec-default/i.test(String(p.id || ''))),
  }
}

export function parseMarketplaceList(input) {
  const list = json(input)
  if (!Array.isArray(list)) throw new Error('unexpected marketplace list shape')
  return { marketplaceKnown: list.some(m => m && m.name === 'hitch') }
}

// `claude plugin configure <id> --json` → current values as strings.
// `inputs` maps option name → string; "" means unset (schema default applies).
export function parseConfigureInputs(input) {
  const data = json(input)
  return data && typeof data.inputs === 'object' && data.inputs ? data.inputs : {}
}
