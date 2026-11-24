// The description each hitch agent type registers with: the entry's own
// line, then the user's choices (reviewer, builder, eagerness) as
// sentences — the only text Claude always sees when it picks an agent.
// `/hitch` status and `/hitch rubric` print the same choices.

import { HARNESSES } from '../harnesses'
import { enabledFor, settingsFor } from './harness'
import type { HarnessAdapter } from './types'

type Options = Readonly<Record<string, unknown>>

const EAGERNESS = {
  'ask-only': 'Use only when the user asks for this harness by name or asks for another model\'s view.',
  rubric: 'Use without being asked when the hitch delegation rubric fits the task.',
  eager: 'Prefer handing self-contained work to a harness over doing it yourself.',
} as const

export type Choices = {
  reviewer?: string
  builder?: string
  eagerness: keyof typeof EAGERNESS
}

// A role option names a harness key; an off or unknown key is no role.
const role = (options: Options, name: 'reviewer' | 'builder') => {
  const raw = options[name]
  const key = typeof raw === 'string' ? raw.trim() : ''
  const a = HARNESSES.find(h => h.key === key)
  return a && enabledFor(a, options) ? key : undefined
}

export function choicesFor(options: Options): Choices {
  const eagerness = options.eagerness
  return {
    reviewer: role(options, 'reviewer'),
    builder: role(options, 'builder'),
    eagerness: eagerness === 'rubric' || eagerness === 'eager' ? eagerness : 'ask-only',
  }
}

// The agent type's description: what the harness is and does, then when to
// use it — the user's reviewer/builder roles and the eagerness.
export function describeFor(a: HarnessAdapter, options: Options): string {
  const c = choicesFor(options)
  return [
    a.description,
    `It runs ${settingsFor(a, options).model}; to run another of its models, start the prompt with a line "model: <name>" (the ${a.label} CLI's own name for it).`,
    c.reviewer === a.key && 'The user\'s chosen harness for second opinions and reviews.',
    c.builder === a.key && 'The user\'s chosen harness for well-specified builds.',
    EAGERNESS[c.eagerness],
  ]
    .filter(Boolean)
    .join(' ')
}

const onOff = (options: Options) => ({
  on: HARNESSES.filter(a => enabledFor(a, options)).map(a => a.key),
  off: HARNESSES.filter(a => !enabledFor(a, options)).map(a => a.key),
})

// `/hitch` status: which harnesses are registered.
export function harnessesText(options: Options): string {
  const { on, off } = onOff(options)
  return `Harnesses: on ${on.join(', ') || 'none'}${off.length ? `; off ${off.join(', ')}` : ''}.`
}

// `/hitch rubric`: the current choices, one plain line each.
export function choicesText(options: Options): string {
  const { on, off } = onOff(options)
  const c = choicesFor(options)
  return [
    `Harnesses on: ${on.join(', ') || 'none'}`,
    `Harnesses off: ${off.join(', ') || 'none'}`,
    `Reviewer: ${c.reviewer ?? 'none'}`,
    `Builder: ${c.builder ?? 'none'}`,
    `Eagerness: ${c.eagerness}`,
  ].join('\n')
}
