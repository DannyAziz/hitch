// Settings: turn stored `claude plugin configure` inputs into prompt defaults,
// and turn the user's answers into the values object written with
// `--values-stdin`. Every value is a single-line string; options left out of
// the object keep their stored values.

import { HARNESSES, HARNESS_BY_KEY } from './harnesses.mjs'
import { eligible } from './detect.mjs'

const str = v => (typeof v === 'string' ? v : '')

export const EAGERNESS_VALUES = ['ask-only', 'rubric', 'eager']

function clean(v) {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').trim()
}

// Defaults for every prompt, from detection plus the plugin's stored inputs
// ({} on a first run — configure --json reports schema defaults as values,
// "" where unset).
export function promptDefaults({ detection, inputs = {} }) {
  const models = {}
  const accesses = {}
  for (const h of HARNESSES) {
    const m = clean(inputs[`${h.key}Model`])
    models[h.key] = m || h.defaultModel
    const a = clean(inputs[`${h.key}Access`])
    accesses[h.key] = h.accessLevels.includes(a) ? a : 'follow'
  }

  const reviewer = clean(inputs.reviewer)
  const builder = clean(inputs.builder)
  const eagerness = clean(inputs.eagerness)

  return {
    // Preselect: found, signed in or not checked, and not disabled last run.
    selection: detection
      .filter(d => eligible(d) && inputs[`${d.key}Enabled`] !== 'false')
      .map(d => d.key),
    models,
    accesses,
    reviewer: detection.some(d => d.key === reviewer && eligible(d)) ? reviewer : '',
    builder: detection.some(d => d.key === builder && eligible(d)) ? builder : '',
    eagerness: EAGERNESS_VALUES.includes(eagerness) ? eagerness : 'ask-only',
  }
}

// The answers object the prompts produce (and --yes synthesizes):
// { chosen: [keys], models: {key: model}, accesses: {key: access},
//   reviewer, builder, eagerness }

// → the settings object for --values-stdin. Chosen harnesses get
// Enabled/Model/Access; unchosen get Enabled "false" only, so their other
// stored options (custom models, paths, timeouts) are preserved.
export function buildSettingsValues(answers, { secDefault = false } = {}) {
  const values = {}
  const chosen = new Set(answers.chosen || [])
  for (const h of HARNESSES) {
    values[`${h.key}Enabled`] = chosen.has(h.key) ? 'true' : 'false'
    if (chosen.has(h.key)) {
      values[`${h.key}Model`] = clean(answers.models?.[h.key] ?? h.defaultModel) || h.defaultModel
      values[`${h.key}Access`] = clean(answers.accesses?.[h.key] ?? 'follow') || 'follow'
    }
  }
  // A reviewer/builder that is not among the chosen harnesses counts as none.
  values.reviewer = chosen.has(answers.reviewer) ? clean(answers.reviewer) : ''
  values.builder = chosen.has(answers.builder) ? clean(answers.builder) : ''
  values.eagerness = clean(answers.eagerness) || 'ask-only'
  // Only ever written when the managed security mod is positively detected:
  // its hooks are skipped there and the two "hook was skipped" lines per
  // session are the price. Otherwise left alone — absence from the plugin
  // list is inconclusive for a managed/builtin mod.
  if (secDefault) values.hideRowTool = 'false'
  return values
}

// --yes: no prompts — the preselected (eligible, still-enabled) harnesses,
// stored-or-default values everywhere, no reviewer/builder unless already
// set and still chosen, no test.
export function answersFromYes(detection, defaults) {
  const chosen = defaults.selection.filter(k => detection.some(d => d.key === k && eligible(d)))
  const models = {}
  const accesses = {}
  for (const k of chosen) {
    models[k] = defaults.models[k]
    accesses[k] = defaults.accesses[k]
  }
  const reviewer = chosen.includes(defaults.reviewer) ? defaults.reviewer : ''
  const builder = chosen.includes(defaults.builder) ? defaults.builder : ''
  return { chosen, models, accesses, reviewer, builder, eagerness: defaults.eagerness }
}

// Problems with an answers object, as human-readable strings ([] = valid).
export function validateAnswers(answers, detection) {
  const problems = []
  const found = new Set(detection.filter(d => d.found).map(d => d.key))
  const chosen = answers.chosen || []
  if (!chosen.length) problems.push('pick at least one harness')
  for (const k of chosen) {
    if (!found.has(k)) problems.push(`${k} is not installed`)
    const h = HARNESS_BY_KEY[k]
    const access = answers.accesses?.[k] || 'follow'
    if (h && access !== 'follow' && !h.accessLevels.includes(access)) {
      problems.push(`${k} does not support access "${access}"`)
    }
  }
  if (answers.reviewer && !chosen.includes(answers.reviewer)) problems.push('reviewer must be a chosen harness')
  if (answers.builder && !chosen.includes(answers.builder)) problems.push('builder must be a chosen harness')
  return problems
}
