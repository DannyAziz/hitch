// Cognition's Devin CLI: `devin acp` (transport acp, the default) or the
// older `devin -p` print mode (transport cli-text, option devinTransport).
// See README.md beside this file for what was tested and the quirks.

import type { Effort, HarnessAdapter, LaunchSpec } from '../../core/types'

// Effort is part of the model name on the free swe-2(-flash)-* models: the
// call's effort swaps the suffix. Any other model name is passed as set.
const DEVIN_SUFFIX: Record<Effort, 'medium' | 'high' | 'max'> = {
  low: 'medium',
  medium: 'medium',
  high: 'high',
  xhigh: 'max',
  max: 'max',
}

const devinModel = (spec: LaunchSpec) => {
  if (!spec.effort) return spec.model
  const m = /^swe-2(-flash)?-(medium|high|max)$/.exec(spec.model)
  return m ? `swe-2${m[1] ?? ''}-${DEVIN_SUFFIX[spec.effort]}` : spec.model
}

// `devin -p`: --permission-mode auto approves read-only tools only; smart
// also runs the edits and commands a fast model judges safe.
const devinPermission = (sandbox?: string) => (sandbox === 'read-only' ? 'auto' : 'smart')

export const devin: HarnessAdapter = {
  key: 'devin',
  label: 'Devin',
  description:
    'Cognition\'s Devin CLI as a subagent: a different model and agent harness, not Claude. Give it a self-contained task: it reads and edits files and runs commands itself in the working directory and returns its final message. Its edits and commands are checked against the session\'s permissions, and in default and auto modes it is read-only; it is not a filesystem sandbox. Continue it with SendMessage; it keeps its Devin session.',
  defaultModel: 'swe-2-flash-high',
  defaultSandbox: 'workspace-write',
  sandboxes: ['workspace-write', 'read-only'],
  accessLevels: ['read-only', 'workspace-write', 'full'],
  transports: {
    // `devin acp`: an ACP server over stdio. In-process, so the server is
    // this process tree alone (no shared background daemon to outlive it).
    // Its sessions persist on disk, and `session/load` continues one in a
    // later process (seen with devin 3000.14).
    acp: {
      argv: spec => ['devin', 'acp', '--process-model', 'in-process', '--model', devinModel(spec)],
      // Session modes it offers: accept-edits ("Code": workspace edits
      // auto-approved, other commands ask), smart, ask (no write or exec
      // tools at all), plan, bypass.
      mode: sandbox => (sandbox === 'read-only' ? 'ask' : 'accept-edits'),
    },
    // The old print mode: stdout is Devin's running commentary and final
    // answer as plain text; no rows, no resume. `devinTransport: cli-text`.
    'cli-text': {
      start: spec => ({
        argv: [
          'devin',
          '--model', devinModel(spec),
          '--permission-mode', devinPermission(spec.sandbox),
          '--respect-workspace-trust', 'false',
          '-p', spec.prompt,
        ],
      }),
    },
  },
}

