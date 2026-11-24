// A harness's model listing: read once per harness and executable, used to
// refuse a name the CLI does not offer before launching it, to settle the
// listed spelling of a name, and to check a name an effort swap produced.

import type { EngineInterface } from 'claude-code'

import type { HarnessAdapter } from './types'

type Executable = { path: string; env?: Record<string, string> }

// Lookup cache only: the names last listed, per harness and executable.
const listed = new Map<string, Set<string>>()
// A listing that failed is not tried again for a while, so a CLI that hangs
// or is signed out does not hold up every run.
const failedAt = new Map<string, number>()
const RETRY_MS = 5 * 60_000

async function read($: EngineInterface, a: HarnessAdapter, executable: Executable): Promise<Set<string> | undefined> {
  const run = await $.process
    .run([executable.path, ...a.models!.argv.slice(1)], { ...(executable.env && { env: executable.env }), timeoutMs: 20_000 })
    .catch(() => undefined)
  if (!run || run.exitCode !== 0) return undefined
  const names = a.models!.parse(run.stdout)
  return names.length ? new Set(names) : undefined
}

// The names the harness lists, or undefined when it has no listing or it
// could not be read. `fresh`: read again even when a listing is remembered
// (a name missing from it may have been added since).
export async function listModels(
  $: EngineInterface,
  a: HarnessAdapter,
  executable: Executable,
  fresh = false,
): Promise<ReadonlySet<string> | undefined> {
  if (!a.models) return undefined
  const key = `${a.key}\0${executable.path}`
  const had = listed.get(key)
  if (had && !fresh) return had
  const failed = failedAt.get(key)
  if (failed !== undefined && Date.now() - failed < RETRY_MS) return had
  const names = await read($, a, executable)
  if (names) {
    listed.set(key, names)
    failedAt.delete(key)
    return names
  }
  failedAt.set(key, Date.now())
  return had
}

// Test hook: forget every listing.
export const forgetListings = () => {
  listed.clear()
  failedAt.clear()
}

// `model` as the listing spells it, or undefined when it is not listed.
// Case is ignored, and Cursor's `[key=value]` overrides are not part of
// the name.
export function listedName(names: ReadonlySet<string>, model: string): string | undefined {
  if (names.has(model)) return model
  const bracket = model.indexOf('[')
  const base = bracket > 0 ? model.slice(0, bracket) : model
  const lower = base.toLowerCase()
  for (const n of names) {
    if (n.toLowerCase() === lower) return bracket > 0 ? `${n}${model.slice(bracket)}` : n
  }
  return undefined
}

// Edit distance, for "did you mean".
function distance(x: string, y: string): number {
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    const row = [i]
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[y.length]!
}

// How many leading dash-separated words two names share.
const shared = (x: string, y: string) => {
  const xs = x.split('-')
  const ys = y.split('-')
  let n = 0
  while (n < xs.length && n < ys.length && xs[n] === ys[n]) n++
  return n
}

// The listed names nearest `model`: those a few typos away, closest first;
// failing that, those sharing the most leading words with it, at least two
// (gemini-4-neon-max: the gemini-4-neon models, not every gemini-4).
export function nearest(model: string, names: Iterable<string>, limit = 8): string[] {
  const want = model.toLowerCase()
  const all = [...new Set(names)]
  const near = Math.max(2, Math.floor(want.length / 5))
  const close = all
    .map(n => ({ n, d: distance(want, n.toLowerCase()) }))
    .filter(x => x.d <= near)
    .sort((x, y) => x.d - y.d)
    .map(x => x.n)
  if (close.length) return close.slice(0, limit)
  const best = Math.max(0, ...all.map(n => shared(n.toLowerCase(), want)))
  return best < 2 ? [] : all.filter(n => shared(n.toLowerCase(), want) === best).slice(0, limit)
}

export function unknownModelText(a: HarnessAdapter, model: string, names: Iterable<string>): string {
  const near = nearest(model, names)
  const listCommand = a.models!.argv.join(' ')
  return [
    `${a.label} was not started: it offers no model named "${model}"${a.models!.why ? `, ${a.models!.why}` : ''}.`,
    near.length ? `Nearest names it offers: ${near.join(', ')}.` : '',
    `\`${listCommand}\` lists them all.`,
  ].filter(Boolean).join(' ')
}
