// Cursor's agent CLI (`agent -p --output-format stream-json`), transport
// cli-jsonl. See README.md beside this file for what was tested and the
// quirks.

import type { Effort, HarnessAdapter } from '../../core/types'
import { parseCursor } from './parse'

// `agent models`: "<id> - <label>" lines under a header, then a tip.
export const parseCursorModels = (stdout: string): string[] =>
  stdout.split('\n').flatMap(line => {
    const m = /^([a-z0-9][\w.-]*) - \S/i.exec(line.trim())
    return m ? [m[1]!] : []
  })

// Effort is part of the model name where Cursor offers tiers: the last word,
// or the one before -fast (gemini-4-neon-high, gpt-5.6-sol-xhigh-fast); a
// medium tier is often the bare name (gpt-5.3-codex). The call's effort
// swaps the tier of the configured model, only to a name Cursor lists; with
// no such name (gpt-5.5-extra-high has no -extra-low), or no listing, the
// name is run as set. A name a `model:` line gave runs as named.
export const cursorRunModel = (
  model: string,
  effort: Effort | undefined,
  { isPicked, names }: { isPicked: boolean; names?: ReadonlySet<string> },
): { model: string } => {
  if (!effort || isPicked || !names || model.includes('[')) return { model }
  const m = /^(.+?)(?:-(low|medium|high|xhigh|max))?(-fast)?$/.exec(model)!
  const base = m[1]!
  const fast = m[3] ?? ''
  const tries = [`${base}-${effort}${fast}`, ...(effort === 'medium' ? [`${base}${fast}`] : [])]
  // Only a name in the family: one with a tier, or a bare one beside tiered ones.
  const isTiered = Boolean(m[2]) || names.has(`${base}-high${fast}`) || names.has(`${base}-low${fast}`)
  const swap = isTiered ? tries.find(n => names.has(n)) : undefined
  return { model: swap ?? model }
}

// full runs with --force (the verified form); read-only is
// Cursor's ask mode, without --force. --trust is always passed.
const cursorSandbox = (sandbox?: string) => (sandbox === 'read-only' ? ['--mode', 'ask'] : ['--force'])

export const cursor: HarnessAdapter = {
  key: 'cursor',
  label: 'Cursor',
  description:
    'Cursor\'s agent CLI as a subagent: a different model and agent harness, not Claude. Give it a self-contained task: it reads and edits files and runs commands itself in the working directory and returns its final message. It has no sandbox: outside bypass mode the user is asked once per run before it gets full access, or it runs in Cursor\'s read-only ask mode. Continue it with SendMessage; it keeps its Cursor session.',
  defaultModel: 'auto',
  agentModel: model => `cursor-${model}`,
  models: { argv: ['agent', 'models'], parse: parseCursorModels },
  runModel: cursorRunModel,
  defaultSandbox: 'workspace-write',
  sandboxes: ['workspace-write', 'read-only'],
  accessLevels: ['read-only', 'full'],
  transports: {
    'cli-jsonl': {
      start: spec => ({
        argv: [
          'agent', '-p',
          '--output-format', 'stream-json',
          '--model', spec.model,
          ...cursorSandbox(spec.sandbox),
          '--trust',
          spec.prompt,
        ],
      }),
      // The same command with --resume <session_id> added (verified: the
      // follow-up recording continues the first run's session).
      resume: spec => ({
        argv: [
          'agent', '-p',
          '--output-format', 'stream-json',
          '--model', spec.model,
          ...cursorSandbox(spec.sandbox),
          '--trust',
          '--resume', spec.sessionId,
          spec.prompt,
        ],
      }),
      parse: parseCursor,
    },
  },
}
