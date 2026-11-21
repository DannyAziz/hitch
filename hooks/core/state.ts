import type { EngineInterface } from 'claude-code'

import { HARNESSES } from '../harnesses'
import type { AcpState } from '../transports/acp'
import type { ParserMemo } from '../transports/cli-jsonl'
import { typeOf } from './harness'
import type { Effort, HarnessAdapter, HarnessEvent, Transport, Usage } from './types'

// The engine's hand-back tool (auto mode), as the binary names it.
export const HANDBACK = 'SubagentHandback'

// A harness turn in flight: the detached supervisor and how far the agent's
// steps have read its output.
export type ActiveRun = {
  dir: string
  supervisor: string
  transport: Transport
  // Complete stdout lines already parsed (remaining events are queued below).
  consumed: number
  startedAt: number
  model: string
  effort?: Effort
  sandbox?: string
  access?: string
  accessWho?: string
  // Rows so far this turn.
  rows: number
  // For the delegation log: never the prompt itself.
  promptChars: number
  isFollowUp: boolean
  description?: string
  // A command or tool the harness is running now (the command timeout runs
  // from `since`); absent while it waits on its model.
  inFlight?: { title: string; since: number }
  // When its output last moved (the idle timeout runs from here).
  lastOutputAt: number
  usage?: Usage
  errors?: string[]
  // The ACP client's state (transport 'acp').
  acp?: AcpState
  // JSONL parser state and unhandled events from the last consumed line.
  memo?: ParserMemo
  pendingEvents?: HarnessEvent[]
}

// One agent of a hitch type as hitch knows it. The engine owns
// the agent (its id, row, transcript, status); this is what the harness needs.
export type AgentState = {
  agentId: string
  key: string
  // The harness's conversation, once its first turn started one.
  sessionId?: string
  model: string
  effort?: Effort
  sandbox?: string
  turns: number
  tokens: number
  lastAnswer?: string
  run?: ActiveRun
  // Messages that arrived (SendMessage) while a turn ran, for the next one.
  queued?: string[]
  // Not persisted:
  permissionMode?: string
  isHandbackHidden?: boolean
  // The turn whose last step was a hand-back call; a later step of that
  // turn means the call failed.
  handbackTurnId?: string
  isRunning?: boolean
  activity?: string
}

type Persisted = Omit<
  AgentState,
  'permissionMode' | 'isHandbackHidden' | 'handbackTurnId' | 'isRunning' | 'activity'
>

const keyOf = (agentId: string) => `hitch:agent:${agentId}`

export const agents = new Map<string, AgentState>()
// Agents listed by the engine under some other type.
export const others = new Set<string>()

// The row tool's results by tool_use_id, for the tool.call hook that answers
// them. Bounded; a result is read once, right after its step.
export const rowResults = new Map<string, { text: string; isError?: boolean }>()
export function keepRow(id: string, value: { text: string; isError?: boolean }) {
  rowResults.set(id, value)
  if (rowResults.size > 500) rowResults.delete(rowResults.keys().next().value!)
}

export const adapterOf = (st: AgentState): HarnessAdapter | undefined =>
  HARNESSES.find(a => a.key === st.key)

export async function load($: EngineInterface, agentId: string): Promise<Persisted | undefined> {
  const raw = await $.store.get(keyOf(agentId)).catch(() => undefined)
  return raw && typeof raw === 'object' ? (raw as Persisted) : undefined
}

export async function save($: EngineInterface, st: AgentState): Promise<void> {
  const value: Persisted = {
    agentId: st.agentId,
    key: st.key,
    ...(st.sessionId && { sessionId: st.sessionId }),
    model: st.model,
    ...(st.effort && { effort: st.effort }),
    ...(st.sandbox && { sandbox: st.sandbox }),
    turns: st.turns,
    tokens: st.tokens,
    ...(st.lastAnswer !== undefined && { lastAnswer: st.lastAnswer.slice(0, 20_000) }),
    ...(st.run && { run: st.run }),
    ...(st.queued?.length && { queued: st.queued }),
  }
  await $.store.set(keyOf(st.agentId), value).catch(() => undefined)
}

export type Defaults = { model: string; sandbox?: string }

// The state for an agent of adapter `a`, made from the store or fresh.
export async function stateFor(
  $: EngineInterface,
  id: string,
  a: HarnessAdapter,
  defaults: Defaults,
): Promise<AgentState> {
  const had = agents.get(id)
  if (had) return had
  const stored = await load($, id)
  const raced = agents.get(id)
  if (raced) return raced
  const st: AgentState = {
    ...(stored ?? {}),
    agentId: id,
    key: a.key,
    model: stored?.model ?? defaults.model,
    ...((stored?.sandbox ?? defaults.sandbox) && { sandbox: stored?.sandbox ?? defaults.sandbox }),
    turns: stored?.turns ?? 0,
    tokens: stored?.tokens ?? 0,
  }
  agents.set(id, st)
  others.delete(id)
  return st
}

// Which harness an agent id belongs to: known here, listed by the engine
// under one of the types, or persisted by an earlier copy of hitch (a
// reload).
export async function adapterForAgent(
  $: EngineInterface,
  id: string,
): Promise<HarnessAdapter | undefined> {
  const known = agents.get(id)
  if (known) return adapterOf(known)
  if (others.has(id)) return undefined
  const listed = (await $.agent.list().catch(() => [])).find(a => a.id === id)
  if (listed) {
    const a = HARNESSES.find(h => typeOf(h) === listed.type)
    if (!a) others.add(id)
    return a
  }
  const stored = await load($, id)
  return stored ? HARNESSES.find(h => h.key === stored.key) : undefined
}
