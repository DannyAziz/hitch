// The interactive flow, built on @clack/prompts. Every prompt cancel returns
// { cancelled: true } so main can exit cleanly with nothing written.

import { confirm, isCancel, multiselect, note, select, text } from '@clack/prompts'
import {
  ACCESS_HINTS,
  AMP_MODES,
  EAGERNESS_OPTIONS,
  HARNESS_BY_KEY,
} from './harnesses.mjs'

const CANCELLED = { cancelled: true }

function choiceHint(d) {
  const bits = []
  if (d.signIn === 'no') bits.push('not signed in — may not work')
  if (d.versionDiffers && d.testedVersion) bits.push(`tested with ${d.testedVersion}`)
  return bits.join(' · ') || undefined
}

function withCurrent(options, value) {
  if (value && !options.some(o => o.value === value)) {
    return [{ value, label: `${value} (current)`, hint: 'not in the list the CLI reported' }, ...options]
  }
  return options
}

async function askModel(d, fallback) {
  const h = HARNESS_BY_KEY[d.key]
  if (h.modelSource === 'amp-modes') {
    const options = withCurrent(AMP_MODES, fallback)
    const v = await select({
      message: `${h.label} agent mode`,
      options,
      initialValue: options.some(o => o.value === fallback) ? fallback : options[0].value,
    })
    return isCancel(v) ? CANCELLED : v
  }
  if (Array.isArray(d.models) && d.models.length) {
    const options = withCurrent(d.models, fallback)
    const v = await select({
      message: `${h.label} model (${d.models.length} reported by the CLI)`,
      options,
      initialValue: options.some(o => o.value === fallback) ? fallback : options[0].value,
    })
    return isCancel(v) ? CANCELLED : v
  }
  const v = await text({
    message: `${h.label} model`,
    initialValue: fallback,
    validate: value => (value && value.trim() ? undefined : 'A model is required'),
  })
  return isCancel(v) ? CANCELLED : v.trim()
}

async function askAccess(d, fallback) {
  const h = HARNESS_BY_KEY[d.key]
  const options = [
    { value: 'follow', label: 'follow', hint: ACCESS_HINTS.follow },
    ...h.accessLevels.map(level => ({ value: level, label: level, hint: ACCESS_HINTS[level] })),
  ]
  const v = await select({
    message: `${h.label} access`,
    options,
    initialValue: options.some(o => o.value === fallback) ? fallback : 'follow',
  })
  return isCancel(v) ? CANCELLED : v
}

function roleOptions(chosen, noneHint) {
  return [
    ...chosen.map(key => ({
      value: key,
      label: `${HARNESS_BY_KEY[key].label} (${key})`,
      hint: 'its agent description says it is your chosen harness for this',
    })),
    { value: '', label: 'nobody in particular', hint: noneHint },
  ]
}

// detection: detectHarnesses() result; defaults: promptDefaults() result;
// preview(answers) → the review text for the note + confirm.
// Returns { cancelled: true } or { cancelled: false, answers }.
export async function promptInstaller({ detection, defaults, preview, dryRun = false }) {
  const found = detection.filter(d => d.found)
  if (!found.length) return CANCELLED

  const chosen = await multiselect({
    message: 'Which harnesses should hitch use?',
    options: found.map(d => ({
      value: d.key,
      label: `${d.label} (${d.binary})`,
      hint: choiceHint(d),
    })),
    initialValues: defaults.selection,
  })
  if (isCancel(chosen)) return CANCELLED
  if (!chosen.length) {
    await note('Pick at least one harness to continue.', 'Nothing to do')
    return CANCELLED
  }

  const useDefaults = await confirm({
    message: 'Use the default model and access for each?',
    initialValue: true,
  })
  if (isCancel(useDefaults)) return CANCELLED

  const models = {}
  const accesses = {}
  if (useDefaults) {
    for (const key of chosen) {
      models[key] = defaults.models[key]
      accesses[key] = defaults.accesses[key]
    }
  } else {
    for (const key of chosen) {
      const d = detection.find(x => x.key === key)
      const model = await askModel(d, defaults.models[key])
      if (model === CANCELLED) return CANCELLED
      models[key] = model
      const access = await askAccess(d, defaults.accesses[key])
      if (access === CANCELLED) return CANCELLED
      accesses[key] = access
    }
  }

  // First: when Claude uses hitch at all. The questions after it depend on it.
  const eagerness = await select({
    message: 'When should Claude use hitch?',
    options: EAGERNESS_OPTIONS,
    initialValue: defaults.eagerness,
  })
  if (isCancel(eagerness)) return CANCELLED

  const reviewerOptions = roleOptions(chosen, 'nobody in particular')
  const reviewer = await select({
    message: 'When you ask for a second opinion or a review, which harness should give it?',
    options: reviewerOptions,
    initialValue: reviewerOptions.some(o => o.value === defaults.reviewer) ? defaults.reviewer : '',
  })
  if (isCancel(reviewer)) return CANCELLED

  const builderOptions = roleOptions(chosen, 'nobody in particular')
  const builder = await select({
    message: 'When you hand off a build, which harness should take it?',
    options: builderOptions,
    initialValue: builderOptions.some(o => o.value === defaults.builder) ? defaults.builder : '',
  })
  if (isCancel(builder)) return CANCELLED

  const answers = { chosen, models, accesses, reviewer, builder, eagerness }

  await note(preview(answers).text, 'Review')
  const ok = await confirm({
    message: dryRun ? 'Does this plan look right?' : 'Apply these settings?',
    initialValue: true,
  })
  if (isCancel(ok) || !ok) return CANCELLED

  return { cancelled: false, answers }
}
