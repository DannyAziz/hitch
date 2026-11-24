// pi print mode, transport cli-jsonl. See README.md for tested behavior.
import type { Effort, HarnessAdapter, LaunchSpec } from '../../core/types'
import { parsePi } from './parse'

// A model is provider/model, split at the first slash.
export const piCheckModel = (model: string): string | undefined => {
  const slash = model.indexOf('/')
  return slash > 0 && slash < model.length - 1
    ? undefined
    : `pi needs a model as provider/model (openrouter/google/gemini-2.5-flash-lite), and "${model}" names no provider.`
}

// pi reads a thinking level at the end of the model name (`...:low`). One a
// `model:` line named wins over the call's effort.
export const piRunModel = (model: string, effort: Effort | undefined, { isPicked }: { isPicked: boolean }) =>
  isPicked && /:(off|minimal|low|medium|high|xhigh)$/.test(model) ? { model } : { model, ...(effort && { effort }) }

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
  checkModel: piCheckModel,
  runModel: piRunModel,
  modelHint: model =>
    `It runs ${model}; to run another, start the prompt or a follow-up with a line "model: <provider>/<model>" (pi's own names, as in \`pi --list-models\`).`,
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
