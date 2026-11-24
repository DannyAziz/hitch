// The test world: every hook here stands for the engine beneath hitch.
// - The bottom `turn.step` hook stands for the request to Anthropic: `w.sent`
//   counts the steps that reached it (must stay empty for hitch agents).
// - The bottom `tool.call` and `classic.PreToolUse` hooks stand for running
//   a tool and the permission path: `w.toolRan` must stay empty for rows.
// - `process.run` answers the launcher (the supervisor's pid), mkdir, kill,
//   appends to a two-way run's input, the delegation log, and any shell
//   command a row's detail runs (`shell`, by a piece of its script);
//   `process.spawn` is the per-step reader: it prints the canned stream
//   after the line count it is given, then how it ended.

import type { AgentInfo, On, TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'

import { forgetListings } from '../hooks/core/models'

export const AGENT = 'a0agent1'
export const T0 = 1_000_000

export const lines = (...events: object[]) => events.map(e => JSON.stringify(e))

export type World = {
  spawnId?: string
  grants: string[]
  checks: any[]
  asks: any[]
  answered: { question: string; answer: string }[]
  verdict: { decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string }
  answer: string
  timeoutMs?: number
  checkHold?: boolean
  askHold?: boolean
  checkThrows: boolean
  askThrows: boolean
  sent: TurnStepInput[]
  toolRan: string[]
  launches: { argv: readonly string[]; cwd?: string; env?: Record<string, string> }[]
  lookup: string | undefined
  loginLookup: string
  readers: (readonly string[])[]
  runs: (readonly string[])[]
  store: Map<string, unknown>
  written: Map<string, string>
  agents: AgentInfo[]
  // Every $.agent.register call, in order (name, description, model, ...).
  registrations: any[]
  messages: { role: 'user' | 'assistant'; text: string; toolUses: []; toolResults?: { tool_use_id: string; text: string; isError: boolean }[] }[]
  // What the reader prints: stdout lines, and `{ at, stderr }` entries that
  // move the clock and/or print a reader signal at that point.
  stream: Entry[]
  now: number
  // JSON-RPC messages appended to a two-way run's <dir>/in.
  inWrites: any[]
  delegations: any[]
  // What a harness CLI's model listing (`<cli> models`) prints.
  models: string
  end: string // stderr line: `__hitch_exit__ code 0`, `__hitch_timeout__ 300`, or '' to hold
  release: () => void
}

export const agentInfo = (id: string, type: string, over: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  description: 'patch a.txt',
  type,
  status: 'running',
  kind: 'local_agent',
  taskStatus: 'running',
  label: 'patch a.txt',
  startTime: 0,
  cwd: '/repo',
  tokenCount: 0,
  tokenSamples: [],
  hasRow: true,
  ...over,
})

export type Entry = string | { at?: number; stderr?: string }

export function world(on: On, stream: Entry[], shell: Record<string, string> = {}): World {
  // Model listings are cached per process: each test starts with none.
  forgetListings()
  const w: World = {
    grants: [],
    checks: [], asks: [], answered: [], verdict: { decision: 'allow' }, answer: 'Allow this run', checkThrows: false, askThrows: false,
    sent: [],
    toolRan: [],
    launches: [],
    lookup: undefined,
    loginLookup: '',
    readers: [],
    runs: [],
    store: new Map(),
    written: new Map(),
    agents: [],
    registrations: [],
    messages: [],
    stream,
    now: 1_000_000,
    inWrites: [],
    delegations: [],
    models: '',
    end: '__hitch_exit__ code 0',
    release: () => undefined,
  }
  let killed = () => undefined as void
  const held = () =>
    new Promise<void>(resolve => {
      w.release = () => resolve()
      killed = () => resolve()
    })

  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/test' : '/bin/zsh' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.after', async (_, e) => {
    if (w.timeoutMs !== e.ms) await new Promise<void>(() => {})
    return { value: undefined }
  })
  on('clock.now', () => ({ value: w.now }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('agent.register', (_, e) => {
    w.registrations.push(e)
    return { value: { agent: `hitch:${e.name}` } }
  })
  on('command.register', () => ({ value: { command: 'hitch' } }))
  on('agent.list', () => ({ value: w.agents }))
  on('agent.spawn', (_, e) => ({ model: 'haiku', agentId: e.resume?.agentId ?? w.spawnId ?? AGENT }))
  on('tool.offer', () => ({ isOffered: true }))
  on('tool.list', () => ({ value: [{ name: 'Bash', description: 'shell', mcp: false }] }))
  let grantVersion = 0
  on('state.get', (_, e, next) => e.plugin === 'hitch' && e.key === 'grants'
    ? { value: { value: [...w.grants], version: grantVersion } } : next(e))
  on('state.set', (_, e, next) => {
    if (e.plugin !== 'hitch' || e.key !== 'grants') return next(e)
    if (e.ifVersion !== undefined && e.ifVersion !== grantVersion) return { value: { isSet: false, version: grantVersion } }
    w.grants = [...e.value as string[]]
    return { value: { isSet: true, version: ++grantVersion } }
  })
  on('tool.check', async (_, e) => {
    w.checks.push(e)
    if (e.tool === 'AskUserQuestion') return { decision: 'allow' }
    if (w.checkHold) await new Promise<void>(() => {})
    if (w.checkThrows) throw new Error('check failed')
    return w.verdict
  })
  on('tool.call', async (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      w.asks.push(e)
      if (w.askHold) await new Promise<void>(() => {})
      if (w.askThrows) throw new Error('ask failed')
      const q = (e as any).questions?.[0]
      w.answered.push({ question: q?.question ?? '', answer: w.answer })
      return { result: { answers: { [q?.question ?? '']: w.answer } } }
    }
    w.toolRan.push(e.tool)
    return { result: 'ran' }
  })
  on('classic.PreToolUse', (_, e) => {
    if (e.tool === 'AskUserQuestion') return {}
    w.toolRan.push('PreToolUse')
    return {}
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.info', () => ({ value: { transcriptPath: '/t/s.jsonl', scratchpadDir: '/scratch' } }))
  on('session.cwd', () => ({ value: '/session' }))
  on('session.messages', () => ({ value: w.messages as any }))
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = w.written.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_, e) => {
    w.written.set(e.path, e.text)
    return { value: undefined }
  })
  const ok = (stdout = '') => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('process.run', (_, e) => {
    w.runs.push(e.argv)
    if (e.argv[0] === '/usr/bin/perl') {
      w.launches.push({ argv: e.argv, ...(e.init?.cwd && { cwd: e.init.cwd }), ...(e.init?.env && { env: e.init.env }) })
      return ok('4242\n')
    }
    if (e.argv[1] === '-l') return ok(w.loginLookup)
    if (e.argv[2] === 'command -v "$1"') return ok(w.lookup ?? `/mock/bin/${e.argv[4]}\n`)
    if (e.argv[0] === 'kill') killed()
    if (e.argv.length === 2 && e.argv[1] === 'models') return ok(w.models)
    const script = String(e.argv[2] ?? '')
    for (const [piece, stdout] of Object.entries(shell)) {
      if (e.argv[0] === '/bin/sh' && script.includes(piece)) return ok(`${stdout}\n`)
    }
    if (e.argv[0] === '/bin/sh' && script.includes('/in"')) {
      for (const l of String(e.argv[5]).split('\n')) if (l.trim()) w.inWrites.push(JSON.parse(l))
    }
    if (e.argv[0] === '/bin/sh' && script.includes('mkdir -p "$(dirname')) w.delegations.push(JSON.parse(String(e.argv[5])))
    if (e.argv[0] === '/bin/sh' && script.includes('cat "$p"')) return ok(w.delegations.map(d => `${JSON.stringify(d)}\n`).join(''))
    if (e.argv[0] === '/bin/sh' && script.includes('sleep 3; kill')) killed()
    return ok()
  })
  on('process.spawn', async function* (_, e) {
    w.readers.push(e.argv)
    const skip = Number(e.argv[4])
    let n = 0
    for (const entry of w.stream) {
      if (typeof entry === 'string') {
        n++
        if (n > skip) yield { stream: 'stdout' as const, text: `${entry}\n` }
        continue
      }
      if (n < skip) continue
      if (entry.at !== undefined) w.now = entry.at
      if (entry.stderr) yield { stream: 'stderr' as const, text: `${entry.stderr}\n` }
    }
    if (!w.end) await held()
    if (w.end) yield { stream: 'stderr' as const, text: `${w.end}\n` }
    return { value: { code: 0, signal: null } }
  })
  // The request to Anthropic.
  on('turn.step', async function* (_, e) {
    w.sent.push(e)
    yield { kind: 'text' as const, index: 0, text: 'from claude' }
    return { turnId: e.turnId, index: e.index, answer: 'from claude', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  return w
}

export async function drain(stream: AsyncGenerator<TurnStepChunk, TurnStepResult>) {
  const chunks: TurnStepChunk[] = []
  while (true) {
    const r = await stream.next()
    if (r.done) return { chunks, result: r.value }
    chunks.push(r.value)
  }
}

export const step = (over: Partial<TurnStepInput> = {}): TurnStepInput => ({
  turnId: 't1',
  index: 0,
  model: 'claude-haiku',
  messageCount: 1,
  agentId: AGENT,
  ...over,
})

export const spawnInput = (subagentType: string) => ({
  tool_use_id: 'toolu_01SPAWN',
  prompt: 'Patch a.txt',
  description: 'patch a.txt',
  subagentType,
  provider: { plugin: 'hitch', tier: 'user' as const },
  parentModel: 'claude-opus',
  background: true,
  fork: false,
})

// The session starts and the engine spawns an agent of `type`.
export async function boot($: any, w: World, type: string, permissionMode = 'default') {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  w.agents.push(agentInfo(AGENT, type))
  await $.agent.spawn({ ...spawnInput(type), permissionMode })
}

// The harness's own argv inside the launcher: perl -e <script> <dir> <stdin mode> ...
export const harnessArgv = (launch: { argv: readonly string[] } | undefined) => (launch?.argv ?? []).slice(5)

// Answers a row step's tool call as the engine would: through tool.call.
export async function answerRow($: any, chunks: TurnStepChunk[], agentId = AGENT) {
  const tool = chunks.find(c => c.kind === 'tool') as { id: string; name: string; index: number }
  const json = chunks.filter(c => c.kind === 'input').map(c => (c as { json: string }).json).join('')
  return $.tool.call({ tool: tool.name, tool_use_id: tool.id, agentId, ...JSON.parse(json) })
}
