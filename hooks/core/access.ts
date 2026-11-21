import type { EngineInterface } from 'claude-code'

import { grantSession, sessionGrants } from './grants'
import type { HarnessAdapter } from './types'
import type { Settings } from './harness'
import type { AcpCall } from '../transports/acp'

export type AccessDecision = { level?: string; who: string; error?: string }
export async function chooseAccess($: EngineInterface, a: HarnessAdapter, settings: Settings, mode: string): Promise<AccessDecision> {
  const read = a.accessLevels.includes('read-only')
  const fail = (why: string, who = 'mode'): AccessDecision => ({ who, error: `hitch:${a.key} could not start: ${why}. Set ${a.key}Access in settings to opt in to supported access (plan mode still forbids writes).` })
  if (mode === 'plan') return read ? { level: 'read-only', who: 'mode plan' } : fail('plan requires read-only, which this harness cannot enforce')
  if (settings.access !== 'follow') return a.accessLevels.includes(settings.access)
    ? { level: settings.access, who: 'settings' } : fail(`unsupported access ${settings.access}`, 'settings')
  if (mode === 'bypassPermissions') return { level: a.accessLevels.at(-1), who: 'mode bypassPermissions' }
  if (settings.transport === 'acp') return { level: 'follow', who: `mode ${mode}${mode === 'acceptEdits' ? '' : ' (read-only fallback: no verified all-actions permission mode)'}` }
  if (a.workspaceSandbox) return { level: 'workspace-write', who: 'mode sandbox' }
  try {
    if ((await sessionGrants($)).includes(a.key)) return { level: 'full', who: 'session grant' }
    const grantLabel = `Allow hitch:${a.key} for this session`
    const answer = await bounded($, $.ui.ask(`hitch:${a.key} cannot ask before each action. Run it with full access to this machine for this task?`,
      ['Allow this run', grantLabel, ...(read ? ['Run read-only instead'] : []), 'Refuse']), 300_000)
    if (answer === grantLabel) {
      await grantSession($, a.key)
      return { level: 'full', who: 'session grant' }
    }
    if (answer === 'Allow this run') return { level: 'full', who: 'person' }
    if (answer === 'Run read-only instead' && read) return { level: 'read-only', who: 'person' }
    return fail('person refused this run', 'person')
  } catch (error) {
    return read ? { level: 'read-only', who: 'no answer' } : fail(`no answer: ${String(error)}`, 'no answer')
  }
}

export type PermissionDecision = { allowed: boolean; who: string; reason?: string }
export async function permitAction($: EngineInterface, label: string, call: AcpCall): Promise<PermissionDecision> {
  try {
    let tool: string | undefined
    let input: Record<string, unknown> = {}
    if (call.command) { tool = 'Bash'; input = { command: call.command } }
    else if (call.path && ['edit', 'write', 'read'].includes(call.kind ?? '')) {
      tool = call.kind === 'read' ? 'Read' : call.kind === 'write' ? 'Write' : 'Edit'
      input = { ...call.rawInput, file_path: call.path }
    } else if (call.kind === 'fetch' && call.url) { tool = 'WebFetch'; input = { url: call.url, prompt: call.title ?? 'Fetch' } }
    const verdict = tool ? await bounded($, $.tool.check({ tool, input }), 60_000) : undefined
    if (verdict && verdict.decision !== 'ask') return { allowed: verdict.decision === 'allow', who: verdict.rule ? 'rule' : 'mode', reason: verdict.reason }
    if ((await sessionGrants($)).includes(label)) return { allowed: true, who: 'session grant', reason: verdict?.reason }
    const grantLabel = `Allow all hitch:${label} requests this session`
    const answer = await bounded($, $.ui.ask(`hitch:${label} requests ${call.command ?? call.path ?? call.url ?? call.title ?? 'an unknown action'}${tool ? '' : ` (${JSON.stringify(call)})`}. Allow once?`, ['Allow once', grantLabel, 'Refuse']), 300_000)
    if (answer === grantLabel) {
      await grantSession($, label)
      return { allowed: true, who: 'session grant', reason: verdict?.reason }
    }
    return { allowed: answer === 'Allow once', who: 'person', reason: verdict?.reason }
  } catch (error) {
    return { allowed: false, who: 'no answer', reason: `Permission check or ask failed or timed out: ${String(error)}` }
  }
}

// A late answer cannot revive a refused action. The underlying dialog may
// still finish: the API offers no cancellation argument to ui.ask.
async function bounded<T>($: EngineInterface, pending: Promise<T>, ms: number): Promise<T> {
  let refuse = () => {}
  const timeout = new Promise<never>((_, reject) => {
    refuse = () => reject(new Error('Permission decision timed out'))
  })
  const timer = $.clock.after(ms, refuse)
  try { return await Promise.race([pending, timeout]) }
  finally { timer.cancel() }
}
