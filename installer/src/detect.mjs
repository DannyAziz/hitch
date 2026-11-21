// Detection: for each harness, is its binary on PATH, what version does it
// report, does it look signed in, and which models can it list — all via
// read-only commands. Never throws for a missing/broken CLI; a probe that
// fails leaves the field null/'unknown'.

import { HARNESSES } from './harnesses.mjs'
import { extractVersion, firstLine, parseModelList, parseSignIn } from './parse.mjs'
import { isNotFound } from './run.mjs'

const VERSION_TIMEOUT_MS = 15000
const STATUS_TIMEOUT_MS = 20000
const MODELS_TIMEOUT_MS = 45000

async function probe(run, argv, timeoutMs) {
  if (!argv) return null
  try {
    return await run(argv, { timeoutMs })
  } catch (err) {
    return { error: err }
  }
}

export function eligible(d) {
  return d.found && d.signIn !== 'no'
}

export async function detectHarnesses({ run, piModel } = {}) {
  const out = []
  for (const h of HARNESSES) out.push(await detectOne(run, h, piModel))
  return out
}

async function detectOne(run, h, piModel) {
  const d = {
    key: h.key,
    label: h.label,
    binary: h.binary,
    vendor: h.vendor,
    testedVersion: h.testedVersion,
    found: false,
    version: null,
    versionDiffers: false,
    signIn: 'unknown', // 'yes' | 'no' | 'unknown'
    models: null, // [{ value, label, hint }] or null → text input fallback
    note: null,
  }

  const v = await probe(run, h.versionArgv, VERSION_TIMEOUT_MS)
  if (!v || v.error) {
    if (v?.error && isNotFound(v.error)) {
      d.note = 'not on PATH'
    } else {
      d.found = true
      d.note = v?.error ? `${h.binary} --version failed: ${v.error.message}` : 'probe failed'
    }
    return d
  }
  d.found = true

  const versionText = `${v.stdout || ''}\n${v.stderr || ''}`
  d.version = extractVersion(h.versionPattern, v) || firstLine(versionText) || 'unknown'
  if (h.testedVersion && d.version !== 'unknown') d.versionDiffers = d.version !== h.testedVersion

  const statusArgv = typeof h.statusArgv === 'function' ? h.statusArgv(piModel) : h.statusArgv
  if (statusArgv) {
    const s = await probe(run, statusArgv, STATUS_TIMEOUT_MS)
    if (s && !s.error) d.signIn = parseSignIn(h.key, s)
  }

  if (h.modelsArgv) {
    const m = await probe(run, h.modelsArgv, MODELS_TIMEOUT_MS)
    if (m && !m.error && m.code === 0) d.models = parseModelList(h.key, m.stdout)
  }

  return d
}

// Compact detection table, one line per harness.
export function formatDetection(detection) {
  const lines = []
  for (const d of detection) {
    if (!d.found) {
      lines.push(`${d.binary.padEnd(8)} not found — ${d.vendor}`)
      continue
    }
    const bits = [d.version || 'version unknown']
    bits.push(d.signIn === 'yes' ? 'signed in' : d.signIn === 'no' ? 'NOT signed in' : 'sign-in not checked')
    if (d.versionDiffers && d.testedVersion) bits.push(`differs from tested ${d.testedVersion}`)
    if (d.note) bits.push(d.note)
    lines.push(`${d.binary.padEnd(8)} ${bits.join('  ·  ')}`)
  }
  return lines.join('\n')
}
