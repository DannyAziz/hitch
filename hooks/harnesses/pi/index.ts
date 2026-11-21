// pi print mode, transport cli-jsonl. See README.md for tested behavior.
import type { HarnessAdapter, LaunchSpec } from '../../core/types'
import { parsePi } from './parse'

function argv(spec: LaunchSpec, sessionId?: string): string[] {
  const slash = spec.model.indexOf('/')
  if (slash <= 0 || slash === spec.model.length - 1) throw new Error('piModel must be provider/model')
  return [
    'pi', '-p', '--mode', 'json',
    '--provider', spec.model.slice(0, slash), '--model', spec.model.slice(slash + 1),
    ...(sessionId ? ['--session', sessionId] : []),
    ...(spec.effort ? ['--thinking', spec.effort] : []),
    ...(spec.sandbox === 'read-only' ? ['--tools', 'read,grep,find,ls'] : []),
    spec.prompt,
  ]
}

export const pi: HarnessAdapter = {
  key: 'pi',
  label: 'pi',
  description:
    'The pi CLI as a subagent, on the provider and model set in hitch\'s options: a different model and agent harness, not Claude. Give it a self-contained task: it reads and edits files and runs commands itself in the working directory and returns its final message. It has no sandbox: outside bypass mode the user is asked once per run before it gets full access, or it runs with read-only tools. Continue it with SendMessage; it keeps its pi session.',
  defaultModel: 'openrouter/~deepseek/deepseek-flash-latest',
  defaultSandbox: 'workspace-write',
  sandboxes: ['workspace-write', 'read-only'],
  accessLevels: ['read-only', 'full'],
  transports: {
    'cli-jsonl': {
      start: spec => ({ argv: argv(spec) }),
      resume: spec => ({ argv: argv(spec, spec.sessionId) }),
      parse: parsePi,
    },
  },
}
