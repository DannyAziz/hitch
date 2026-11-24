import type { EngineInterface, TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'

import { chooseAccess, permitAction } from './access'
import { type AcpState, acpCancel, acpHandle, acpOpen, acpPermission } from '../transports/acp'
import { jsonlEvents, jsonlInvocation } from '../transports/cli-jsonl'
import { type Outcome, recordDelegation } from './delegations'
import { ROW_TOOL, type Settings, contextNote, formatTokens, typeOf } from './harness'
import { forgetExecutable, resolveExecutable } from './resolve'
import { type ActiveRun, type AgentState, HANDBACK, keepRow, save } from './state'
import { appendArgv, launchArgv, readerArgv, readerSignal } from './supervise'
import { type HarnessAction, type HarnessAdapter, type HarnessEvent, type Invocation, type LaunchSpec, type Transport, canResume, isEffort } from './types'
import { listModels, listedName, unknownModelText } from './models'
import { takeModel, unwrapMessage } from './text'
import { logFile, runDir, touch } from './util'

// One `turn.step` of a hitch agent, answered without `next`: no
// request goes to Anthropic for it.
//
// A harness turn becomes several steps. Each finished action (a command, a
// file change, a permission decision, ...) ends a step with a call to the
// shared row tool (`HitchLog`), whose input says what was done; the
// tool.call hook in register.tsx answers that call with the action's real
// result (nothing runs again), and the engine asks for the next step.
// Messages the harness writes are the steps' text. The last step holds only
// the closing message(s), so the report is clean, and stops with end_turn.
// Live progress (reasoning, "starting <harness>…", "waiting on <model>…",
// "running: <command>") streams as thinking, which is shown and not recorded.
//
// Timeouts: the idle timeout counts while the harness starts or waits on its
// model (no command or tool in flight), from its last output; a command or
// tool in flight has its own, much longer ceiling, from when it started.

type StepGen = AsyncGenerator<TurnStepChunk, TurnStepResult>

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g
const clean = (s: string) => unwrapMessage(s.replace(REMINDER, '').replace(/\r\n?/g, '\n').trim())

// turnId -> the text its turn.start carried (the Agent prompt, or the
// message that woke the agent). Filled by register.ts.
export const turnTexts = new Map<string, string>()

// The most recent spawn's permission mode, for a first step that runs before
// its agent.spawn hook has the agent's id back.
export const spawnMode: { last?: string } = {}

// What a step reports as usage. null by default: nothing to count. With the
// `stampHarnessModel` option, all-zero counts that name the harness's model
// (`codex/gpt-6-astra`), the one field of a step's result that names a model.
type StepUsage = TurnStepResult['usage']
const usageFor = (settings: Settings, a: HarnessAdapter, model: string): StepUsage =>
  settings.stampModel
    ? { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: `${a.key}/${model}` }
    : null

const MAX_RESULT = 30_000
const clip = (s: string) =>
  s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}\n… (${s.length - MAX_RESULT} more characters)` : s

const toolUseId = () => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = 'toolu_01'
  for (let i = 0; i < 22; i++) s += abc[Math.floor(Math.random() * abc.length)]
  return s
}

// Block indexes: a new block whenever the kind changes.
class Blocks {
  index = -1
  kind: string | undefined
  at(kind: string) {
    if (kind !== this.kind) {
      this.index++
      this.kind = kind
    }
    return this.index
  }
}

const secs = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`

// What the row label and the live lines say while a turn runs.
export function runState(run: ActiveRun, now: number): string {
  return run.inFlight
    ? `running: ${run.inFlight.title.slice(0, 60)} · ${secs(now - run.inFlight.since)}`
    : !run.isModelSeen
      ? `starting ${run.label}… ${secs(now - run.startedAt)}`
      : `waiting on ${run.model}… ${secs(now - run.lastOutputAt)}`
}

// User text since the agent's last reply: the turn's own text on its first
// step, else what the transcript holds after the last assistant message.
// Tool results (the mod's own row answers) are left out unless asked.
async function newUserText(
  $: EngineInterface,
  e: TurnStepInput,
  withToolResults: boolean,
): Promise<string> {
  const own = e.index === 0 ? turnTexts.get(e.turnId) : undefined
  turnTexts.delete(e.turnId)
  if (own && clean(own)) return clean(own)
  const rows = await $.session.messages({ agentId: e.agentId!, last: 64 }).catch(() => undefined)
  if (!rows || !Array.isArray(rows)) return ''
  let start = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.role === 'assistant') {
      start = i + 1
      break
    }
  }
  const parts: string[] = []
  for (const row of rows.slice(start)) {
    if (row.role !== 'user') continue
    if (row.text && clean(row.text)) parts.push(clean(row.text))
    if (withToolResults) for (const r of row.toolResults ?? []) if (r.text) parts.push(r.text)
  }
  return clean(parts.join('\n\n'))
}

const result = (
  e: TurnStepInput,
  answer: string,
  stopReason: TurnStepResult['stopReason'],
  toolUses: TurnStepResult['toolUses'] = [],
  usage: StepUsage = null,
): TurnStepResult => ({ turnId: e.turnId, index: e.index, answer, toolUses, stopReason, usage })

// Messages, oldest first, each of which may open with a `model:` line: the
// last line names the model; the rest is the harness's input.
function gather(texts: string[]): { named?: string; input: string } {
  let named: string | undefined
  const parts: string[] = []
  for (const text of texts) {
    const p = takeModel(text)
    if (p.model) named = p.model
    if (p.prompt.trim()) parts.push(p.prompt.trim())
  }
  return { ...(named && { named }), input: parts.join('\n\n') }
}

async function* say(e: TurnStepInput, text: string, usage: StepUsage): StepGen {
  yield { kind: 'text', index: 0, text }
  yield { kind: 'stop', stopReason: 'end_turn', usage }
  return result(e, text, 'end_turn', [], usage)
}

// The command line a transport builds for `spec` (its first word is the CLI).
const buildArgv = (a: HarnessAdapter, transport: Transport, spec: LaunchSpec): string[] =>
  transport === 'acp'
    ? a.transports.acp!.argv(spec)
    : transport === 'cli-jsonl'
      ? jsonlInvocation(a.transports['cli-jsonl']!, spec, undefined).argv
      : a.transports['cli-text']!.start(spec).argv

// A run stopped before launch over its model: said, and one line in the
// delegation log, so refusals show there too.
async function* refusal(
  $: EngineInterface,
  e: TurnStepInput,
  st: AgentState,
  a: HarnessAdapter,
  settings: Settings,
  text: string,
  model: string,
  usage: StepUsage,
): StepGen {
  await recordDelegation($, settings.delegationLog, {
    ts: new Date().toISOString(),
    session: await $.session.id().catch(() => undefined),
    agentId: st.agentId,
    harness: a.key,
    transport: settings.transport,
    model,
    effort: st.effort ?? null,
    sandbox: st.sandbox ?? null,
    access: null,
    description: null,
    promptChars: 0,
    turn: st.turns > 0 ? 'follow-up' : 'first',
    durationMs: 0,
    rows: 0,
    tokens: null,
    outcome: 'refused',
    exitCode: null,
    exit: 'refused before launch',
  })
  return yield* say(e, text, usage)
}

export async function* harnessStep(
  $: EngineInterface,
  e: TurnStepInput,
  st: AgentState,
  a: HarnessAdapter,
  settings: Settings,
  signal: AbortSignal,
): StepGen {
  const stepUsage = usageFor(settings, a, st.run?.model ?? st.model)
  // A step after this turn's hand-back call: the call did not end the run
  // (refused, or the tool was not there after all). Report as plain text.
  if (st.handbackTurnId === e.turnId && !st.run) {
    st.handbackTurnId = undefined
    return yield* say(e, st.lastAnswer ?? '', stepUsage)
  }

  if (st.run) {
    // A row's result just went in; anything else the user said meanwhile
    // (SendMessage while the harness runs) waits for the next turn.
    const extra = await newUserText($, e, false)
    if (extra) (st.queued ??= []).push(extra)
    return yield* readStep($, e, st, a, settings, signal, new Blocks())
  }

  // The call may name the model: a first line `model: <name>`, here or in a
  // message that came while the last run went. It is kept for the agent's
  // follow-ups, once a run on it got going, until one of them names another.
  const { named, input } = gather([...(st.queued ?? []), await newUserText($, e, true)])
  if (!input) {
    if (!named) return yield* say(e, st.lastAnswer ?? `${a.label} was given no task.`, stepUsage)
    st.queued = [`model: ${named}`]
    await save($, st)
    return yield* say(e, `${a.label} was given no task: the next message to this agent runs on ${named}.`, stepUsage)
  }
  return yield* launch($, e, st, a, settings, signal, { input, ...(named && { named }) })
}

// What a run is asked to do: its input, the model a `model:` line named, and
// the answer of the run before it in the same turn, when a message queued
// during that run is answered right after it.
type Ask = { input: string; named?: string; carry?: string }

// Starts a harness run for `ask` and reads it to its first row or its end.
async function* launch(
  $: EngineInterface,
  e: TurnStepInput,
  st: AgentState,
  a: HarnessAdapter,
  settings: Settings,
  signal: AbortSignal,
  ask: Ask,
): StepGen {
  const stepUsage = usageFor(settings, a, st.model)
  const { input } = ask
  const transport = settings.transport
  const refuse = (text: string, model: string) => refusal($, e, st, a, settings, ask.carry ? `${ask.carry}\n\n${text}` : text, model, stepUsage)
  if (st.turns > 0 && !canResume(a, transport)) {
    return yield* say(
      e,
      `${a.label} cannot be continued: each run is a fresh session with no memory of the last. ` +
        `Start a new ${typeOf(a)} agent with a self-contained task instead.`,
      stepUsage,
    )
  }

  // Where and how: the agent's own directory (a worktree under
  // isolation: "worktree") and the effort its call or definition set.
  const info = (await $.agent.list().catch(() => [])).find(x => x.id === e.agentId)
  const cwd = info?.cwd || (await $.session.cwd().catch(() => undefined)) || ''
  if (isEffort(info?.effort)) st.effort = info.effort
  // A concurrent spawn's mode is not authority for this agent. Until its
  // own spawn metadata arrives (or after reload), use the restrictive mode.
  const permissionMode = st.permissionMode ?? 'plan'
  const access = await chooseAccess($, a, settings, permissionMode)
  if (access.error) return yield* say(e, access.error, stepUsage)
  const chosenAccess = access.level === 'follow' ? (permissionMode === 'acceptEdits' ? 'workspace-write' : 'read-only') : access.level
  st.sandbox = access.level

  // Which model: the one named, else the agent's. A name the harness cannot
  // run, or one its listing does not offer, stops here, before launch.
  const isPicked = ask.named !== undefined || st.isModelPicked === true
  let model = ask.named ?? st.model
  const bad = a.checkModel?.(model)
  if (bad) {
    return yield* refuse(`${a.label} was not started: ${bad}${isPicked ? '' : ` Set the ${a.key}Model option to one.`}`, model)
  }
  const cli = buildArgv(a, transport, { prompt: '', model })[0]!
  const executable = await resolveExecutable($, a.key, cli, settings.path)
  if (!executable) {
    return yield* say(e, `hitch could not find ${cli}: looked on PATH and in a login shell. Install ${cli} or set the ${a.key}Path option.`, stepUsage)
  }
  let names = await listModels($, a, executable)
  if (names && !listedName(names, model)) names = await listModels($, a, executable, true)
  if (names) {
    const found = listedName(names, model)
    if (!found) return yield* refuse(unknownModelText(a, model, names), model)
    model = found
  }
  // The name and effort it launches with: an effort may swap a tier in the
  // name. A swap to a name the listing lacks runs the name as it was.
  const ran = a.runModel
    ? a.runModel(model, st.effort, { isPicked, ...(names && { names }) })
    : { model, ...(st.effort && { effort: st.effort }) }
  if (names && ran.model !== model) {
    const found = listedName(names, ran.model)
    ran.model = found ?? model
  }
  const spec = {
    prompt: input,
    model: ran.model,
    ...(ran.effort && { effort: ran.effort }),
    ...(st.sandbox && { sandbox: st.sandbox }),
  }

  const dir = await runDir($, st.agentId, st.turns + 1)
  if (!dir) return yield* say(e, `${a.label} could not start: the session has no scratchpad directory.`, stepUsage)

  let argv: string[]
  let acp: AcpState | undefined
  if (transport === 'acp') {
    const t = a.transports.acp!
    argv = t.argv(spec)
    const mode = st.sandbox === 'follow' ? (permissionMode === 'acceptEdits' ? 'accept-edits' : 'ask') : t.mode?.(st.sandbox)
    const opened = acpOpen({
      cwd,
      decisionWho: access.who,
      prompt: input,
      ...(mode && { mode }),
      ...(st.sandbox && { sandbox: st.sandbox }),
      ...(st.sessionId && st.turns > 0 && { resumeId: st.sessionId }),
    })
    acp = opened.state
    // Written before the launch: the relay forwards <dir>/in from its start.
    await $.fs.write(`${dir}/in`, opened.writes.map(m => `${JSON.stringify(m)}\n`).join(''))
  } else {
    const resumeId = st.turns > 0 ? st.sessionId : undefined
    const inv: Invocation =
      transport === 'cli-jsonl'
        ? jsonlInvocation(a.transports['cli-jsonl']!, spec, resumeId)
        : a.transports['cli-text']!.start(spec)
    argv = inv.argv
    await $.fs.write(`${dir}/input`, inv.input ?? '')
  }

  argv = [executable.path, ...argv.slice(1)]
  // env overrides only PATH; the supervisor and its exec child inherit the rest.
  const launched = await $.process
    .run(launchArgv(dir, argv, transport === 'acp' ? 'tail' : 'file'), { ...(cwd && { cwd }), ...(executable.env && { env: executable.env }), timeoutMs: 15_000 })
    .catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
  const supervisor = launched.stdout.trim()
  if (launched.exitCode !== 0 || !/^\d+$/.test(supervisor)) {
    forgetExecutable(a.key)
    return yield* say(e, `${a.label} could not start: ${launched.stderr.trim() || `launcher exit ${launched.exitCode}`}`, stepUsage)
  }
  const now = await $.clock.now()
  st.queued = []
  st.run = {
    dir,
    supervisor,
    transport,
    consumed: 0,
    startedAt: now,
    lastOutputAt: now,
    label: a.label,
    model: ran.model,
    pick: model,
    isPicked,
    ...(ask.carry !== undefined && { carry: ask.carry }),
    ...(st.effort && { effort: st.effort }),
    ...(st.sandbox && { sandbox: st.sandbox }),
    access: chosenAccess,
    accessWho: access.who,
    rows: 0,
    promptChars: input.length,
    isFollowUp: st.turns > 0,
    ...(info?.description && { description: info.description }),
    ...(acp && { acp }),
    ...(transport === 'cli-jsonl' && { memo: {} }),
  }
  await save($, st)
  await appendLog($, st, [
    `--- turn ${st.turns + 1} (${transport}: ${argv.slice(0, 3).join(' ')}${st.sessionId && st.turns > 0 ? ` resume ${st.sessionId}` : ''}) ${new Date().toISOString()}`,
    `cwd: ${cwd || '(session)'}  dir: ${dir}`,
    `access: ${chosenAccess} (${access.who})`,
    `> ${input}`,
  ])

  // The opening "starting" line is yielded inside readStep's cleanup, so a
  // stop at that very first yield still stops the harness.
  return yield* readStep($, e, st, a, settings, signal, new Blocks(), `access: ${chosenAccess} (${access.who}) · starting ${a.label}…\n`)
}

// Reads the running harness's output from where the last step stopped, up
// to its next finished action (a row) or its end.
async function* readStep(
  $: EngineInterface,
  e: TurnStepInput,
  st: AgentState,
  a: HarnessAdapter,
  settings: Settings,
  signal: AbortSignal,
  blocks: Blocks,
  opening?: string,
): StepGen {
  const run = st.run as ActiveRun
  // Runs persisted before the label was stored still know their adapter.
  run.label ??= a.label
  const stepUsage = usageFor(settings, a, run.model)
  const messages: string[] = []
  let current = '' // an ACP message being streamed in chunks
  const plain: string[] = []
  const log: string[] = []
  let ended: 'action' | 'exit' | 'end' | 'timeout' | 'lost' | undefined
  let endReason = ''
  let exitHow = ''
  let timeoutWhy = ''
  let action: HarnessAction | undefined
  let isDone = false
  const errors = (run.errors ??= [])

  st.isRunning = true
  st.activity = runState(run, await $.clock.now())
  touch($)

  // CLI: stop the supervisor now. ACP: ask the server to cancel first, and
  // stop the supervisor a moment later whatever happens.
  const stopHarness = (gently: boolean) => {
    const cancel = gently && run.acp ? acpCancel(run.acp) : []
    if (cancel.length) {
      void $.process.run(appendArgv(run.dir, cancel)).catch(() => undefined)
      void $.process
        .run(['/bin/sh', '-c', '(sleep 3; kill -TERM "$1") >/dev/null 2>&1 &', 'sh', run.supervisor])
        .catch(() => undefined)
    } else {
      void $.process.run(['kill', '-TERM', run.supervisor]).catch(() => undefined)
    }
  }

  let reader: ReturnType<EngineInterface['process']['spawn']> | undefined
  const onAbort = () => {
    stopHarness(true)
    void Promise.resolve()
      .then(() => reader?.return(undefined as never))
      .catch(() => undefined)
  }
  signal.addEventListener('abort', onAbort, { once: true })

  const thinking = (text: string): TurnStepChunk => ({ kind: 'thinking', index: blocks.at('thinking'), text })
  const flush = () => {
    if (current.trim()) messages.push(current.trim())
    current = ''
  }
  // The timeouts, checked at each line and each idle tick.
  const overdue = (now: number): string | undefined => {
    if (run.inFlight) {
      const ran = now - run.inFlight.since
      return ran >= settings.commandTimeoutSec * 1000
        ? `${a.label}'s command \`${run.inFlight.title}\` ran for ${secs(ran)} and was stopped (command timeout ${settings.commandTimeoutSec}s).`
        : undefined
    }
    const quiet = now - run.lastOutputAt
    return quiet >= settings.idleTimeoutSec * 1000
      ? `${a.label} produced no output for ${secs(quiet)} while ${run.isModelSeen ? `waiting on ${run.model}` : 'starting'}, and was stopped (idle timeout ${settings.idleTimeoutSec}s).`
      : undefined
  }
  // The reader's own limit is only a backstop: the mod decides.
  const backstop = Math.max(settings.idleTimeoutSec, settings.commandTimeoutSec) + 120
  let lastLiveLine = -Infinity

  async function* handleEvents(events: HarnessEvent[]): AsyncGenerator<TurnStepChunk> {
    for (const [index, ev] of events.entries()) {
      if (run.transport === 'cli-jsonl') run.pendingEvents = events.slice(index + 1)
      if (ev.sessionId && ev.sessionId !== st.sessionId) {
        st.sessionId = ev.sessionId
        await save($, st)
      }
      if (!run.isModelSeen && (
        ev.thought !== undefined || ev.messageChunk !== undefined || ev.message !== undefined ||
        ev.usage !== undefined || ev.context !== undefined || ev.started !== undefined || ev.action !== undefined ||
        ev.isPrompted === true ||
        // Reasoning (·) and plan (☐) lines come from the model too.
        /^[·☐] /.test(ev.line ?? '')
      )) {
        run.isModelSeen = true
        st.activity = runState(run, await $.clock.now())
        await save($, st)
        touch($)
      }
      if (ev.usage) run.usage = ev.usage
      if (ev.context) run.context = ev.context
      if (ev.error) errors.push(ev.error)
      if (ev.thought) yield thinking(ev.thought)
      if (ev.line) {
        log.push(ev.line)
        st.activity = ev.line
        yield thinking(`${ev.line}\n`)
        touch($)
      }
      if (ev.started) {
        const at = await $.clock.now()
        run.inFlight = { title: ev.started.title, since: at }
        st.activity = runState(run, at)
        await save($, st)
      }
      if (ev.messageChunk) {
        yield { kind: 'text', index: blocks.at('text'), text: `${!current && messages.length ? '\n\n' : ''}${ev.messageChunk}` }
        current += ev.messageChunk
      }
      if (ev.message !== undefined && ev.message.trim()) {
        flush()
        const text = ev.message.trim()
        yield { kind: 'text', index: blocks.at('text'), text: `${messages.length ? '\n\n' : ''}${text}` }
        messages.push(text)
      }
      if (ev.action) {
        flush()
        if (ev.action.kind !== 'permission') delete run.inFlight
        action = ev.action
        ended = 'action'
        if (run.transport === 'cli-jsonl') break
      }
      if (ev.end) {
        flush()
        endReason = ev.end.reason
        ended = 'end'
      }
    }
  }

  try {
    if (opening) yield thinking(opening)
    if (run.pendingEvents?.length) {
      const events = run.pendingEvents
      run.pendingEvents = []
      yield* handleEvents(events)
    }
    let attempts = 0
    reading: while (!ended && !signal.aborted && attempts < 3) {
      attempts++
      reader = $.process.spawn({ argv: readerArgv(run.dir, run.consumed, backstop) })
      let out = ''
      let err = ''
      while (!signal.aborted) {
        const piece = await reader.next()
        if (piece.done) break
        if (piece.value.stream === 'stderr') {
          err += piece.value.text
          let nl: number
          while ((nl = err.indexOf('\n')) >= 0) {
            const sig = readerSignal(err.slice(0, nl))
            err = err.slice(nl + 1)
            if (!sig) continue
            const now = await $.clock.now()
            if (sig.kind === 'exit') {
              exitHow = sig.how
              ended = 'exit'
            } else if (sig.kind === 'timeout') {
              timeoutWhy = `${a.label} produced no output for ${sig.seconds}s and was stopped.`
              ended = 'timeout'
            } else {
              const late = overdue(now)
              if (late) {
                timeoutWhy = late
                ended = 'timeout'
              } else {
                st.activity = runState(run, now)
                touch($)
                if (now - lastLiveLine >= 30_000) {
                  lastLiveLine = now
                  yield thinking(`${st.activity}\n`)
                }
              }
            }
          }
          if (ended) break reading
          continue
        }
        out += piece.value.text
        let nl: number
        while ((nl = out.indexOf('\n')) >= 0) {
          const raw = out.slice(0, nl)
          out = out.slice(nl + 1)
          run.consumed++
          run.lastOutputAt = await $.clock.now()

          if (run.transport === 'cli-text') {
            // Plain output is the model's report: the harness has started.
            if (raw.trim()) run.isModelSeen = true
            plain.push(raw)
            log.push(raw)
            st.activity = raw.slice(0, 80) || st.activity
            if (raw.trim()) yield thinking(`${raw}\n`)
            continue
          }

          let events: HarnessEvent[]
          if (run.transport === 'acp' && run.acp) {
            const handled = acpHandle(run.acp, raw, a.transports.acp!)
            if (handled.permission) {
              const decision = await permitAction($, a.key, handled.permission.call)
              const answered = acpPermission(run.acp, handled.permission.msg, handled.permission.call, decision)
              handled.writes.push(...answered.writes)
              handled.events.push(...answered.events)
            }
            if (handled.writes.length) {
              await $.process.run(appendArgv(run.dir, handled.writes)).catch(() => undefined)
            }
            events = handled.events
          } else {
            events = jsonlEvents(a.transports['cli-jsonl']!, raw, run.memo ??= {})
            if (!events.length) continue
          }

          yield* handleEvents(events)
          if (ended) break reading
          const late = overdue(await $.clock.now())
          if (late) {
            timeoutWhy = late
            ended = 'timeout'
            break reading
          }
        }
      }
      // The reader ended with no verdict (killed by a reload, or it failed):
      // start another from the same line.
    }
    if (!ended && !signal.aborted) ended = 'lost'
    isDone = true
  } finally {
    signal.removeEventListener('abort', onAbort)
    st.isRunning = false
    void Promise.resolve()
      .then(() => reader?.return(undefined as never))
      .catch(() => undefined)
    // Left early (stopped, or the stream was closed under us): the harness
    // and everything it started must go, and the turn is over.
    if (!isDone) {
      stopHarness(true)
      st.activity = 'stopped'
      st.run = undefined
      await finish($, st, a, run, settings, 'stopped', 'stopped').catch(() => undefined)
    }
  }
  flush()

  if (signal.aborted) {
    stopHarness(true)
    st.activity = 'stopped'
    st.run = undefined
    await appendLog($, st, [...log, '(stopped)'])
    await finish($, st, a, run, settings, 'stopped', 'stopped')
    touch($)
    return result(e, '', null, [], stepUsage)
  }

  // ---- an action: end this step on a row of the harness's tool
  if (ended === 'action' && action) {
    const id = toolUseId()
    let text = action.output
    const detail = run.transport === 'cli-jsonl' ? a.transports['cli-jsonl']?.detail : undefined
    if (detail) {
      const extra = await detail(action, {
        ...(st.sessionId && { sessionId: st.sessionId }),
        run: async argv => (await $.process.run(argv, { timeoutMs: 10_000 })).stdout,
      }).catch(() => undefined)
      if (extra) text = extra
    }
    keepRow(id, { text: clip(text), ...(action.isError && { isError: true }) })
    run.rows++
    st.activity = `${action.kind === 'command' ? '$ ' : ''}${action.title}`.slice(0, 120)
    log.push(`[${action.kind}] ${action.title}`)
    await appendLog($, st, log)
    await save($, st)
    touch($)
    const input = { harness: a.key, ...action.input, title: action.title }
    const index = blocks.at('tool')
    yield { kind: 'tool', index, id, name: ROW_TOOL }
    yield { kind: 'input', index, json: JSON.stringify(input) }
    yield { kind: 'stop', stopReason: 'tool_use', usage: stepUsage }
    return result(e, messages.join('\n\n'), 'tool_use', [{ name: ROW_TOOL, input }], stepUsage)
  }

  // ---- the end of the harness's turn
  // An ACP server stays up after its prompt's answer: the session is saved
  // on its side, so stop the process (and anything it left running).
  if (run.transport === 'acp' || ended === 'timeout' || ended === 'lost') stopHarness(false)

  const usage = run.usage
  const tokens = usage ? usage.input + usage.output : 0
  st.tokens += tokens
  st.turns++
  if (exitHow === 'code 127' || exitHow === 'code 126') forgetExecutable(a.key)

  const seconds = Math.round(((await $.clock.now()) - run.startedAt) / 1000)
  st.run = undefined

  let answer = run.transport === 'cli-text' ? plain.join('\n').trim() : messages.join('\n\n')
  let failure: string | undefined
  let outcome: Outcome = 'done'
  if (ended === 'timeout') {
    outcome = 'timeout'
    failure =
      timeoutWhy +
      (canResume(a, run.transport) && st.sessionId
        ? ` Its conversation (${st.sessionId}) is kept: send this agent a message (SendMessage) to continue it.`
        : '')
  } else if (ended === 'lost') {
    outcome = 'failed'
    failure = `hitch lost track of ${a.label}'s output (the reader kept failing).`
  } else if (ended === 'end' && endReason !== 'end_turn') {
    outcome = endReason === 'cancelled' ? 'stopped' : 'failed'
    failure = `${a.label} ended its turn early (${endReason})${errors.length ? `: ${errors.at(-1)}` : '.'}`
  } else if (!answer) {
    outcome = 'failed'
    const why = errors.at(-1)
    failure = `${a.label} ended without an answer (${exitHow || endReason || 'unknown exit'})${why ? `: ${why}` : '.'}`
    if (!why && exitHow && exitHow !== 'code 0') {
      const tail = await $.fs.read(`${run.dir}/err`).catch(() => '')
      const last = (typeof tail === 'string' ? tail : '').trim().split('\n').slice(-3).join('\n')
      if (last) failure += `\n${last}`
    }
  }
  // The model this run was asked for becomes the agent's once the run got
  // going on it: a name the harness refused is not kept for follow-ups.
  if (run.pick && (outcome === 'done' || run.usage || messages.length)) {
    st.model = run.pick
    st.isModelPicked = run.isPicked === true
  }
  // How full the harness's context window is, when it says: one line on
  // the report, so a SendMessage follow-up shows it too. `run.context` is
  // this turn's latest; `st.context` the last one a turn reported.
  const ctx = run.context ?? st.context
  const ctxNote = !failure && ctx ? contextNote(a.label, ctx) : undefined
  if (ctxNote) answer = answer ? `${answer}\n\n${ctxNote}` : ctxNote

  // A run that answered a message queued during the one before it in this
  // turn: the report carries both answers, as one new text block (Claude
  // gets the last text block only).
  const carried = run.carry
  if (carried !== undefined) {
    if (failure) answer = answer ? `${answer}\n\n${failure}` : failure
    answer = [carried, answer].filter(Boolean).join('\n\n')
    yield thinking(`${a.label} answered the message sent while it worked\n`)
    yield { kind: 'text', index: blocks.at('text'), text: answer }
  } else if (failure) {
    yield { kind: 'text', index: blocks.at('text'), text: `${messages.length || plain.length ? '\n\n' : ''}${failure}` }
    answer = answer ? `${answer}\n\n${failure}` : failure
  } else if (run.transport === 'cli-text' && answer) {
    // Plain text: the whole stdout is the report, as one text block.
    yield { kind: 'text', index: blocks.at('text'), text: answer }
  }
  // Streamed transports already yielded the report's text: the context
  // line joins that text block (cli-text's is inside `answer`). Claude gets
  // the last text block only, so when a live line (a hook, say) came after
  // the report, the line opens a new block that carries the whole report.
  if (carried === undefined && ctxNote && run.transport !== 'cli-text') {
    const isJoined = blocks.kind === 'text'
    yield { kind: 'text', index: blocks.at('text'), text: isJoined ? `\n\n${ctxNote}` : answer }
  }

  st.lastAnswer = answer
  const summary = [
    `${a.label} ${run.model}${run.effort ? ` (${run.effort})` : ''}`,
    `${run.rows} row${run.rows === 1 ? '' : 's'}`,
    ...(usage ? [`${formatTokens(tokens)} tokens`] : []),
    `${seconds}s`,
  ].join(' · ')
  st.activity = `${outcome === 'done' ? 'done' : outcome} · ${summary}`
  log.push(`= ${answer}`, `(${summary}, ${exitHow || endReason || ended})`)
  await appendLog($, st, log)
  await finish($, st, a, run, settings, outcome, exitHow || endReason || String(ended))
  touch($)
  yield thinking(`${summary}\n`)

  // A message sent while this run went: answer it now, in the same turn,
  // rather than leave it for a follow-up that may never come.
  if (st.queued?.length && outcome === 'done' && canResume(a, run.transport) && !signal.aborted) {
    const next = gather(st.queued)
    if (next.input) {
      yield thinking(`${a.label} goes on with the message sent while it worked\n`)
      return yield* launch($, e, st, a, settings, signal, { input: next.input, ...(next.named && { named: next.named }), carry: answer })
    }
  }

  // Auto mode with the hand-back tool still offered (the server decides auto
  // mode's checks, or tool.offer hooks are passed over): only a hand-back
  // call reaches the parent. End on that call; the engine runs it.
  const mode = st.permissionMode ?? spawnMode.last
  if (mode === 'auto' && !st.isHandbackHidden) {
    st.handbackTurnId = e.turnId
    const id = toolUseId()
    const input = { message: answer }
    const index = blocks.at('tool')
    yield { kind: 'tool', index, id, name: HANDBACK }
    yield { kind: 'input', index, json: JSON.stringify(input) }
    yield { kind: 'stop', stopReason: 'tool_use', usage: stepUsage }
    return result(e, messages.join('\n\n'), 'tool_use', [{ name: HANDBACK, input }], stepUsage)
  }

  if (carried === undefined && !messages.length && !failure && !(run.transport === 'cli-text' && answer)) {
    // Nothing was said at all: still end on text, so the report isn't empty.
    answer = `${a.label} finished without a closing message.`
    st.lastAnswer = answer
    yield { kind: 'text', index: blocks.at('text'), text: answer }
  }
  yield { kind: 'stop', stopReason: 'end_turn', usage: stepUsage }
  return result(e, answer, 'end_turn', [], stepUsage)
}

// The end of a harness turn, whatever the outcome: state saved and one line
// in the delegation log (no prompt or report text).
async function finish(
  $: EngineInterface,
  st: AgentState,
  a: HarnessAdapter,
  run: ActiveRun,
  settings: Settings,
  outcome: Outcome,
  exit: string,
) {
  // A turn that reported context fullness keeps it on the agent; one that
  // didn't leaves the previous value.
  if (run.context) st.context = run.context
  await save($, st)
  const code = /^code (-?\d+)$/.exec(exit)
  await recordDelegation($, settings.delegationLog, {
    ts: new Date().toISOString(),
    session: await $.session.id().catch(() => undefined),
    agentId: st.agentId,
    harness: a.key,
    transport: run.transport,
    model: run.model,
    effort: run.effort ?? null,
    sandbox: run.sandbox ?? null,
    access: { level: run.access ?? run.sandbox ?? null, decider: run.accessWho ?? 'unknown' },
    description: run.description ?? null,
    promptChars: run.promptChars,
    turn: run.isFollowUp ? 'follow-up' : 'first',
    durationMs: (await $.clock.now()) - run.startedAt,
    rows: run.rows,
    tokens: run.usage ? run.usage.input + run.usage.output : null,
    outcome,
    exitCode: code ? Number(code[1]) : null,
    exit,
  })
}

async function appendLog($: EngineInterface, st: AgentState, lines: string[]) {
  if (!lines.length) return
  const file = await logFile($, st.agentId).catch(() => undefined)
  if (!file) return
  const before = await $.fs.read(file).catch(() => '')
  const text = typeof before === 'string' ? before : ''
  await $.fs.write(file, `${text}${lines.join('\n')}\n`).catch(() => undefined)
}
