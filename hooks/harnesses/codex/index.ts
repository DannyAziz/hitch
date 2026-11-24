// OpenAI Codex CLI (`codex exec --json`), transport cli-jsonl.
// See README.md beside this file for what was tested and the quirks.

import type { Effort, HarnessAdapter } from '../../core/types'
import { codexDetail, parseCodex } from './parse'

const CODEX_EFFORT: Record<Effort, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max', // the GPT-6 and 5.6 models; gpt-5.5 stops at xhigh
}

const codexEffort = (effort: Effort | undefined): string[] =>
  effort ? ['-c', `model_reasoning_effort="${CODEX_EFFORT[effort]}"`] : []

export const codex: HarnessAdapter = {
  key: 'codex',
  label: 'Codex',
  description:
    'OpenAI\'s Codex CLI as a subagent: a different model and agent harness, not Claude. Give it a self-contained task: it reads and edits files and runs commands itself in the working directory and returns its final message. It runs in a real sandbox, read-only or workspace-write, chosen from the session\'s permission mode. Continue it with SendMessage; it keeps its Codex thread.',
  defaultModel: 'gpt-6-astra',
  defaultSandbox: 'workspace-write',
  sandboxes: ['workspace-write', 'read-only'],
  accessLevels: ['read-only', 'workspace-write'],
  workspaceSandbox: true,
  transports: {
    'cli-jsonl': {
      start: spec => ({
        argv: [
          'codex', 'exec',
          '-m', spec.model,
          '--json',
          '--color', 'never',
          '--skip-git-repo-check',
          ...(spec.sandbox ? ['--sandbox', spec.sandbox] : []),
          ...codexEffort(spec.effort),
          '-',
        ],
        input: spec.prompt,
      }),
      // `exec resume` takes no --sandbox or --color: the sandbox goes in as
      // config. It re-emits thread.started with the same thread_id.
      resume: spec => ({
        argv: [
          'codex', 'exec', 'resume',
          '-m', spec.model,
          '--json',
          '--skip-git-repo-check',
          ...(spec.sandbox ? ['-c', `sandbox_mode="${spec.sandbox}"`] : []),
          ...codexEffort(spec.effort),
          spec.sessionId,
          '-',
        ],
        input: spec.prompt,
      }),
      parse: parseCodex,
      detail: codexDetail,
    },
  },
}

