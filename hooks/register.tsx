import type { PluginOptions, Register, TurnStepInput } from 'claude-code'

import { revokeGrants, sessionGrants } from './core/grants'
import { readDelegations, summarizeDelegations } from './core/delegations'
import { choicesText, describeFor, harnessesText } from './core/describe'
import { ROW_TOOL, adapterForKey, adapterForType, enabledFor, formatTokens, settingsFor, typeOf } from './core/harness'
import { HANDBACK, adapterForAgent, adapterOf, agents, rowResults, stateFor } from './core/state'
import { harnessStep, runState, spawnMode, turnTexts } from './core/step'
import { printable } from './core/text'
import { HARNESSES } from './harnesses'

// hitch: other agent harnesses (see hooks/harnesses/) as Claude Code
// subagent types whose loop Claude Code owns. The engine spawns the agent
// (foreground or background, its row in the agent list, stop, notification,
// SendMessage follow-ups); hitch answers each of the agent's model
// requests (`turn.step`) itself, without `next`, from the harness's output.
// Each action the harness takes becomes a row of the shared display-only
// tool (`HitchLog`), answered here with the action's real result. No Agent,
// SendMessage or TaskStop tool call is hooked.

let opts: PluginOptions = {}

const settings = (a: (typeof HARNESSES)[number]) => settingsFor(a, opts)

// Never sent to a model while hitch is loaded: every step is answered by
// the turn.step hook. If something ever does send it, it says so.
const placeholder = (label: string) =>
  `You are a placeholder for hitch, which runs ${label} in your place. If you ` +
  'are reading this, hitch did not answer this step. Reply with exactly: "hitch: ' +
  'the step was not handled (is hitch loaded?)" and nothing else.'

// As short as it can be: where tool.offer is passed over, every
// loop lists this tool, deferred, by name and this line.
const ROW_TOOL_DESCRIPTION = 'Display-only log of a hitch agent. Never call.'

const ago = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`

export const register: Register = (on, options) => {
  opts = options

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    for (const a of HARNESSES) {
      if (!enabledFor(a, opts)) continue
      const spec = {
        name: a.key,
        description: describeFor(a, opts),
        prompt: placeholder(a.label),
        // Only its own row tool: everything it does, it does itself.
        tools: [ROW_TOOL],
        omitClaudeMd: true as const,
      }
      // Registered under the harness's own model name, so Claude Code's agent
      // views name what really ran, and a step that ever leaked to the API
      // would fail on the unknown model instead of running on a Claude model.
      // If the engine refuses the name, fall back to the cheapest Claude model.
      const configured = settingsFor(a, opts).model
      const model = a.agentModel ? a.agentModel(configured) : configured
      await $.agent.register({ ...spec, model }).catch(() => $.agent.register({ ...spec, model: 'haiku' }))
    }
    await $.command.register({
      name: 'hitch',
      description: 'hitch agents: harness session, tokens, and Claude usage (should be none); /hitch log: the delegation log; /hitch rubric: the harness choices; /hitch revoke [key]: revoke session grants',
      argumentHint: '[status | log | rubric | revoke [key]]',
    })
    return started
  })

  // A harness still running when the session ends goes with it (its
  // supervisor also stops by itself once Claude Code's process is gone).
  on('session.end', async ($, e, next) => {
    for (const st of agents.values()) {
      if (st.run) await $.process.run(['kill', '-TERM', st.run.supervisor]).catch(() => undefined)
    }
    return next(e)
  })

  // ------------------------------------------------------------ the row tool

  // One display-only tool, HitchLog, for every harness, so each harness's
  // actions are real rows in its agent's transcript.
  on('tool.list', async ($, e, next) => {
    const listed = await next(e)
    const pool = listed.value ?? []
    if (pool.some(t => t.name === ROW_TOOL)) return { value: pool }
    return {
      value: [...pool, { name: ROW_TOOL, description: ROW_TOOL_DESCRIPTION, mcp: false, inputSchema: { type: 'object' } }],
    }
  }).catch(($, e, next) => next(e))

  // The two hooks below hide the row tool from other loops. Where an
  // organisation's security mod runs first it passes over both events, so
  // they never run and Claude Code prints a "hook was skipped" line for each
  // at every session start. `hideRowTool: false` leaves them unregistered:
  // nothing changes on such a machine except that the two lines go away. (On
  // a machine without that security mod, turning it off shows the row tool to every
  // loop and makes auto mode always report through the hand-back call.)
  if (options.hideRowTool !== false) {
  // Behind ToolSearch for every loop, so a loop that is shown it anyway (see
  // ROW_TOOL) gets only its name in the deferred list. A hitch agent's own
  // step can still end on a call of it: the engine checks only that the
  // agent's tools hold it (its model is never sent anything).
  on('tool.describe', async ($, e, next) => {
    if (e.tool !== ROW_TOOL) return next(e)
    return { description: ROW_TOOL_DESCRIPTION, isDeferred: true }
  }).catch(($, e, next) => next(e))

  // Shown to no model but hitch agents' (whose model is never called anyway).
  //
  // Auto mode: the engine also gives a subagent a hand-back tool, and only a
  // call to it reaches the parent. Not offered, the agent's final text is its
  // report (auto mode reviews that text as it would the call).
  on('tool.offer', async ($, e, next) => {
    if (e.tool === ROW_TOOL) return { isOffered: adapterForType(e.subagentType) !== undefined }
    if (e.tool === HANDBACK) {
      const a = adapterForType(e.subagentType)
      if (!a) return next(e)
      if (e.agentId) (await stateFor($, e.agentId, a, settings(a))).isHandbackHidden = true
      return { isOffered: false }
    }
    return next(e)
  }).catch(($, e, next) =>
    next.called || (e.tool !== ROW_TOOL && !(e.tool === HANDBACK && adapterForType(e.subagentType)))
      ? next(e)
      : { isOffered: false },
  )
  }

  // A row's call: answered with the action's real result. Answering here,
  // without `next`, skips the permission check, so no prompt and no auto
  // mode classifier for these display-only calls; nothing runs. The harness
  // is the calling agent's.
  on('tool.call', async ($, e, next) => {
    // HitchLog is no built-in, so the typed call union has no member for it.
    const call = e as { tool: string; tool_use_id: string; agentId?: string }
    if (call.tool !== ROW_TOOL) return next(e)
    const row = rowResults.get(call.tool_use_id)
    if (row) {
      rowResults.delete(call.tool_use_id)
      return row.isError ? { result: row.text, isError: true } : { result: row.text }
    }
    if (call.agentId && (await adapterForAgent($, call.agentId))) {
      return { result: "(this row's result was lost in a reload of hitch)" }
    }
    return {
      deny:
        `${ROW_TOOL} only records a hitch agent's actions and can't be called. To run another ` +
        `harness, use the Agent tool with subagent_type ${HARNESSES.filter(a => enabledFor(a, opts)).map(a => `"${typeOf(a)}"`).join(' or ')}.`,
    }
  }).catch(($, e, next) =>
    next.called || (e as { tool: string }).tool !== ROW_TOOL ? next(e) : { deny: `${ROW_TOOL}: hitch failed to answer.` },
  )

  // The row: `Codex  $ cat a.txt` with its output under it (first lines, all
  // when expanded), in place of the generic `HitchLog(kind: …)`. The label is
  // the harness's, from the row's `harness` (the agent that wrote it).
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== ROW_TOOL) return next(e)
    const input = (e.props.input ?? {}) as { harness?: string; kind?: string; title?: string; command?: string }
    const label = adapterForKey(input.harness)?.label ?? 'hitch'
    const { Box, Text } = $.ui.resolve(e)
    const mark = input.kind === 'command' ? '$ ' : input.kind === 'file_change' ? '✎ ' : ''
    const title = printable(`${mark}${input.command ?? input.title ?? ''}`)
    const out = typeof e.props.output === 'string' ? e.props.output : e.props.output === undefined ? '' : JSON.stringify(e.props.output)
    const lines = printable(out).replace(/\n+$/, '').split('\n')
    const shown = e.props.isExpanded ? lines : lines.slice(0, 6)
    const more = lines.length - shown.length
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{label}</Text> {title}
        </Text>
        {out &&
          shown.map((line, i) => (
            <Text dimColor={!e.props.isErrored} color={e.props.isErrored ? 'red' : undefined} wrap="truncate-end">
              {i === 0 ? '  ⎿  ' : '     '}
              {line}
            </Text>
          ))}
        {more > 0 && <Text dimColor>{'     '}+{more} lines (ctrl+o to expand)</Text>}
      </Box>
    )
  })

  // ------------------------------------------------------------ the agent

  // Know our agents by id, and the parent's permission mode at each run.
  on('agent.spawn', async ($, e, next) => {
    const a = adapterForType(e.subagentType)
    if (!a) return next(e)
    spawnMode.last = e.permissionMode
    if (e.resume) {
      const st = await stateFor($, e.resume.agentId, a, settings(a))
      st.permissionMode = e.permissionMode
      // tool.offer asks about the hand-back tool again at each run.
      st.isHandbackHidden = false
    }
    const started = await next(e)
    if (started.agentId) {
      const st = await stateFor($, started.agentId, a, settings(a))
      st.permissionMode = e.permissionMode
    }
    return started
  }).catch(($, e, next) => next(e))

  // The text a subagent's turn begins with: the Agent prompt, or the message
  // (SendMessage) that woke it.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined && e.text) {
      turnTexts.set(e.turnId, e.text)
      if (turnTexts.size > 200) turnTexts.delete(turnTexts.keys().next().value!)
    }
    return next(e)
  })

  // Every model request of every loop passes here; ours never go further.
  on('turn.step', async function* ($, e, next) {
    const a = e.agentId === undefined ? undefined : await adapterForAgent($, e.agentId)
    if (!a || e.agentId === undefined) return yield* next(e)
    const st = await stateFor($, e.agentId, a, settings(a))
    return yield* harnessStep($, e, st, a, settings(a), next.signal)
  }).catch(async function* ($, e, next) {
    // Ours failed: answer anyway, so the placeholder never goes to Claude.
    const st = e.agentId === undefined ? undefined : agents.get(e.agentId)
    if (next.called || !st) return yield* next(e)
    const text = `hitch: the ${adapterOf(st)?.label ?? 'harness'} step failed (${next.error.kind}${
      next.error.message ? `: ${next.error.message}` : ''
    }).`
    yield { kind: 'text', index: 0, text }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return failed(e, text)
  })

  // ------------------------------------------------------------ the row label

  // The engine's row shows the agent's Claude model and token count, which
  // here are a placeholder and zero: say what the harness is doing instead.
  on('ui.render', { component: 'AgentRow' }, async ($, e, next) => {
    const a = adapterForType(e.props.type)
    if (!a) return next(e)
    const st = agents.get(e.props.id)
    const parts = [`${a.label} ${st?.run?.model ?? st?.model ?? settings(a).model}`]
    if (st?.tokens) parts.push(`${formatTokens(st.tokens)} tok`)
    if (st?.run) parts.push(ago(Date.now() - st.run.startedAt))
    if (st?.run && (st.run.inFlight || Date.now() - st.run.lastOutputAt > 4000)) {
      parts.push(runState(st.run, Date.now()))
    } else if (st?.activity) {
      parts.push(printable(st.activity).slice(0, 80))
    }
    return next({ ...e, props: { ...e.props, label: printable(parts.join(' · ')) } })
  })

  // ------------------------------------------------------------ /hitch

  on('command.run', { command: 'hitch' }, async ($, e) => {
    const args = e.args.trim().split(/\s+/)
    if (args[0] === 'revoke') {
      if (args.length > 2 || (args[1] && !adapterForKey(args[1]))) {
        return { text: 'Usage: /hitch revoke [key]. Keys: ' + HARNESSES.map(a => a.key).join(', '), isTextDisplayOnly: true }
      }
      const revoked = await revokeGrants($, args[1])
      return { text: revoked.length ? `Revoked session grants: ${revoked.map(k => `hitch:${k}`).join(', ')}.` : 'No matching session grants to revoke.', isTextDisplayOnly: true }
    }
    if (args[0] === 'rubric') {
      return { text: choicesText(opts), isTextDisplayOnly: true }
    }
    if (e.args.trim() === 'log') {
      const path = settingsFor(HARNESSES[0]!, opts).delegationLog
      const rows = await readDelegations($, path)
      return { text: `${summarizeDelegations(rows)}\n\n(${rows.length} turn${rows.length === 1 ? '' : 's'} in ${path})`, isTextDisplayOnly: true }
    }
    const listed = (await $.agent.list().catch(() => [])).filter(x => adapterForType(x.type))
    const usage = await $.session.usage().catch(() => undefined)
    const lines = listed.map(x => {
      const st = agents.get(x.id)
      const claude = (x.usage ?? []).reduce(
        (n, u) => n + u.input_tokens + u.output_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        0,
      )
      return [
        `${x.id}  ${x.type}  ${x.status}  ${x.description}`,
        `  harness: ${st?.model ?? '?'}${st?.effort ? ` (${st.effort})` : ''}  session ${st?.sessionId ?? '-'}  turns ${st?.turns ?? 0}  ${formatTokens(st?.tokens ?? 0)} tok${st?.run ? `  running (pid ${st.run.supervisor}, ${st.run.rows} rows, dir ${st.run.dir})` : ''}`,
        `  claude (engine's count for this agent): ${x.usage ? `${claude} tokens over ${x.usage.length} model(s)` : 'no requests'}, cost ${x.cost ? `$${x.cost.usd.toFixed(4)} (estimate)` : 'none'}, tokenCount ${x.tokenCount}`,
        `  last Claude request: ${x.lastRequest ? `${x.lastRequest.model} at ${new Date(x.lastRequest.at).toISOString()}` : 'none'}`,
        `  engine label: ${x.label.split('\n')[0]}  (a model-written label here means a progress summary ran)`,
        `  cwd ${x.cwd}`,
      ].join('\n')
    })
    const grants = await sessionGrants($)
    const grantLine = `Session grants: ${grants.length ? grants.map(k => `hitch:${k}`).join(', ') : 'none'}.`
    const total = usage?.cost ? `Session cost so far: $${usage.cost.usd.toFixed(4)} (estimate).` : ''
    return {
      text: [harnessesText(opts), grantLine, lines.length ? lines.join('\n') : 'No hitch agents listed.', total].filter(Boolean).join('\n\n'),
      isTextDisplayOnly: true,
    }
  })

}

const failed = (e: TurnStepInput, answer: string) => ({
  turnId: e.turnId,
  index: e.index,
  answer,
  toolUses: [],
  stopReason: 'end_turn' as const,
  usage: null,
})

