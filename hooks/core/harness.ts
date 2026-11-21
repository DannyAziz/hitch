// Looking harnesses up, and the settings an entry gets from the options.

import { HARNESSES } from '../harnesses'
import type { HarnessAdapter, Transport } from './types'

export const PLUGIN = 'hitch'
export const typeOf = (a: HarnessAdapter) => `${PLUGIN}:${a.key}`

export const adapterForType = (type: string | undefined) =>
  HARNESSES.find(a => typeOf(a) === type)

export const adapterForKey = (key: string | undefined) => HARNESSES.find(a => a.key === key)

// `<key>Enabled: false` leaves the harness unregistered as an agent type.
// Lookups still resolve it, so a reload never orphans a running agent.
export const enabledFor = (a: HarnessAdapter, options: Readonly<Record<string, unknown>>) =>
  options[`${a.key}Enabled`] !== false

// The one display-only tool every harness's action rows are calls of. One
// for all harnesses: on a machine where the organisation's security mod
// passes over `tool.offer`, every loop is shown this tool (deferred, by
// name), so the leak stays at one tool however many harnesses there are. The
// row's harness comes from its agent (and its input's `harness`), never from
// the tool's name.
export const ROW_TOOL = 'HitchLog'

export const formatTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

const positive = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// The harness's settings from hitch's options (`<key>Model`, ...).
export function settingsFor(a: HarnessAdapter, options: Readonly<Record<string, unknown>>) {
  const path = options[`${a.key}Path`]
  const model = options[`${a.key}Model`]
  const sandbox = options[`${a.key}Sandbox`]
  const configured = options[`${a.key}Access`]
  const access = typeof configured === 'string' && configured !== 'follow' ? configured
    : typeof sandbox === 'string' && sandbox !== a.defaultSandbox && a.sandboxes?.includes(sandbox) ? sandbox : 'follow'
  const transport = options[`${a.key}Transport`]
  const offered = Object.keys(a.transports) as Transport[]
  return {
    access,
    path: typeof path === 'string' ? path : '',
    model: typeof model === 'string' && model.trim() ? model.trim() : a.defaultModel,
    sandbox:
      typeof sandbox === 'string' && a.sandboxes?.includes(sandbox) ? sandbox : a.defaultSandbox,
    transport: (offered.includes(transport as Transport) ? transport : offered[0]) as Transport,
    idleTimeoutSec: positive(options[`${a.key}IdleTimeoutSec`], 300),
    commandTimeoutSec: positive(options[`${a.key}CommandTimeoutSec`], 3600),
    stampModel: options.stampHarnessModel === true,
    delegationLog:
      typeof options.delegationLog === 'string' && options.delegationLog.trim()
        ? options.delegationLog.trim()
        : '~/.claude/hitch/delegations.jsonl',
  }
}

export type Settings = ReturnType<typeof settingsFor>
