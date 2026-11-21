// Cursor's agent CLI (`agent -p --output-format stream-json`), transport
// cli-jsonl. See README.md beside this file for what was tested and the
// quirks.

import type { HarnessAdapter } from '../../core/types'
import { parseCursor } from './parse'

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
