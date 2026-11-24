// Amp execute mode, transport cli-jsonl. See README.md for verified behavior.
import type { Effort, HarnessAdapter, LaunchSpec } from '../../core/types'
import { parseAmp } from './parse'

const MODES: Record<Effort, string> = {
  low: 'low', medium: 'medium', high: 'high', xhigh: 'ultra', max: 'ultra',
}

// `-m` takes an agent mode (low, medium, high, ultra, ...) or a model as
// provider/name. A mode is itself an effort: the call's effort picks the
// mode in place of the configured one. A model keeps its name and takes the
// effort as `--effort`. A mode a `model:` line named runs as named.
export const ampRunModel = (model: string, effort: Effort | undefined, { isPicked }: { isPicked: boolean }) =>
  model.includes('/') ? { model, ...(effort && { effort }) }
    : !effort || isPicked ? { model }
      : { model: MODES[effort] }

const args = (spec: LaunchSpec): string[] => [
  '-x', spec.prompt, '--stream-json', '--no-archive-after-execute',
  '-m', spec.model,
  ...(spec.effort ? ['--effort', spec.effort] : []),
]

export const amp: HarnessAdapter = {
  key: 'amp',
  label: 'Amp',
  description:
    'The Amp CLI as a subagent: a different agent harness, not Claude. Give it a self-contained task: it reads and edits files and runs commands itself in the working directory and returns its final message. It has full access only: outside bypass mode the user is asked once per run, and it cannot run in plan mode. Continue it with SendMessage; it keeps its Amp thread.',
  defaultModel: 'medium',
  agentModel: mode => `amp-${mode}`,
  runModel: ampRunModel,
  modelHint: mode =>
    `It runs Amp's ${mode.includes('/') ? `model ${mode}` : `${mode} mode`}; to run another mode (low, medium, high, ultra) or a model as provider/name (openai/gpt-6-astra), start the prompt or a follow-up with a line "model: <name>". A mode named this way is run as named, whatever the effort.`,
  accessLevels: ['full'],
  transports: {
    'cli-jsonl': {
      start: spec => ({ argv: ['amp', ...args(spec)] }),
      resume: spec => ({ argv: ['amp', 'threads', 'continue', spec.sessionId, ...args(spec)] }),
      parse: parseAmp,
    },
  },
}
