// Checking a run's model against the names its harness lists, for harnesses
// that run another model in place of a name they do not know (Devin).

import type { EngineInterface } from 'claude-code'

import type { HarnessAdapter } from './types'

type Executable = { path: string; env?: Record<string, string> }

// Lookup cache only: the names last listed, per harness and executable.
const listed = new Map<string, Set<string>>()

async function list($: EngineInterface, a: HarnessAdapter, executable: Executable): Promise<Set<string> | undefined> {
  const run = await $.process
    .run([executable.path, ...a.models!.argv.slice(1)], { ...(executable.env && { env: executable.env }), timeoutMs: 20_000 })
    .catch(() => undefined)
  if (!run || run.exitCode !== 0) return undefined
  const names = a.models!.parse(run.stdout)
  return names.length ? new Set(names) : undefined
}

// Why a run of `model` must not start, or undefined when it may. A harness
// with no list, or a listing that fails or comes back empty, is not checked.
// A name missing from a remembered list is checked again against a fresh
// one, in case the harness has added the model since.
export async function unknownModel(
  $: EngineInterface,
  a: HarnessAdapter,
  executable: Executable,
  model: string,
): Promise<string | undefined> {
  if (!a.models) return undefined
  const key = `${a.key}\0${executable.path}`
  let names = listed.get(key)
  if (!names?.has(model)) {
    names = await list($, a, executable)
    if (names) listed.set(key, names)
    else listed.delete(key)
  }
  if (!names || names.has(model)) return undefined
  return unknownModelText(a, model, [...names])
}

// How many leading dash-separated words two names share.
const shared = (x: string, y: string) => {
  const xs = x.split('-')
  const ys = y.split('-')
  let n = 0
  while (n < xs.length && n < ys.length && xs[n] === ys[n]) n++
  return n
}

// The listed names that share the most leading words with `model`, at least
// two (gemini-4-neon-max: the gemini-4-neon models, not every gemini-4).
const nearest = (model: string, names: string[]) => {
  const best = Math.max(0, ...names.map(n => shared(n, model)))
  return best < 2 ? [] : names.filter(n => shared(n, model) === best)
}

export function unknownModelText(a: HarnessAdapter, model: string, names: string[]): string {
  const near = nearest(model, names).slice(0, 8)
  const listCommand = a.models!.argv.join(' ')
  return [
    `${a.label} was not started: it offers no model named "${model}", and given one it does not know it would run another model in its place.`,
    near.length ? `Names it offers that start the same way: ${near.join(', ')}.` : '',
    `\`${listCommand}\` lists them all.`,
  ].filter(Boolean).join(' ')
}
