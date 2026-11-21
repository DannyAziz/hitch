// Amp execute mode, transport cli-jsonl. See README.md for verified behavior.
import type { Effort, HarnessAdapter, LaunchSpec } from '../../core/types'
import { parseAmp } from './parse'

const MODES: Record<Effort, string> = {
  low: 'low', medium: 'medium', high: 'high', xhigh: 'ultra', max: 'ultra',
}
const args = (spec: LaunchSpec): string[] => [
  '-x', spec.prompt, '--stream-json', '--no-archive-after-execute',
  '-m', spec.effort ? MODES[spec.effort] : spec.model,
]

export const amp: HarnessAdapter = {
  key: 'amp',
  label: 'Amp',
  description:
    'The Amp CLI as a subagent: a different agent harness, not Claude. Give it a self-contained task: it reads and edits files and runs commands itself in the working directory and returns its final message. It has full access only: outside bypass mode the user is asked once per run, and it cannot run in plan mode. Continue it with SendMessage; it keeps its Amp thread.',
  defaultModel: 'medium',
  agentModel: mode => `amp-${mode}`,
  accessLevels: ['full'],
  transports: {
    'cli-jsonl': {
      start: spec => ({ argv: ['amp', ...args(spec)] }),
      resume: spec => ({ argv: ['amp', 'threads', 'continue', spec.sessionId, ...args(spec)] }),
      parse: parseAmp,
    },
  },
}
