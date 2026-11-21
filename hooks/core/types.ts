// The types every part of hitch shares: what a harness entry is, and what
// one line of a harness's output means. The entry contract itself is
// described in hooks/harnesses/README.md.

import type { AcpSpec } from '../transports/acp'
import type { CliJsonl } from '../transports/cli-jsonl'
import type { CliText } from '../transports/cli-text'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const isEffort = (v: unknown): v is Effort =>
  v === 'low' || v === 'medium' || v === 'high' || v === 'xhigh' || v === 'max'

export type Usage = { input: number; cached: number; output: number }

// Something the harness did that becomes one row (a tool call of the
// harness's row tool) in the agent's transcript, with its real result.
export type HarnessAction = {
  // What kind of thing: `command`, `file_change`, `permission`, ...
  kind: string
  // The row's one-line title (`cat a.txt`, `update src/a.ts`).
  title: string
  // The row's arguments as the transcript stores them.
  input: Record<string, unknown>
  // The real result: output, diff, ... (never produced by running it again).
  output: string
  isError?: boolean
  // The harness's own id for it, if any.
  id?: string
}

// What one line of the harness's output means. Every field is optional.
export type HarnessEvent = {
  // A short live progress line (shown, not recorded).
  line?: string
  // Raw thinking text to show live as it streams (not recorded).
  thought?: string
  // A whole message from the agent; the last one(s) of a turn are its answer.
  message?: string
  // A piece of a message as it streams (ACP): joined into one message.
  messageChunk?: string
  // A command or tool began: the command timeout runs until it finishes.
  started?: { id?: string; title: string }
  // A finished action: ends the current step with a row.
  action?: HarnessAction
  // Token usage of the turn so far (replaces earlier values).
  usage?: Usage
  // How full the harness's context window is after its latest model
  // request (replaces earlier values); `size` when the window is known.
  context?: { used: number; size?: number }
  // The harness's conversation id, to resume it.
  sessionId?: string
  error?: string
  // The harness's turn is over (ACP's prompt response): why.
  end?: { reason: string }
}

export type LaunchSpec = { prompt: string; model: string; effort?: Effort; sandbox?: string }
export type Invocation = { argv: string[]; input?: string }

export type DetailContext = {
  sessionId?: string
  run: (argv: string[]) => Promise<string>
}

export type Transport = 'cli-jsonl' | 'cli-text' | 'acp'

export type HarnessAdapter = {
  key: string
  label: string
  description: string
  defaultModel: string
  // The name the agent is registered under, shown where Claude Code names an
  // agent's model. Default: the configured model as is. Give one when the
  // model setting is a bare word that says nothing by itself ("auto", "medium").
  agentModel?(model: string): string
  accessLevels: readonly string[]
  workspaceSandbox?: boolean
  defaultSandbox?: string
  sandboxes?: readonly string[]
  transports: {
    'cli-jsonl'?: CliJsonl
    'cli-text'?: CliText
    acp?: AcpSpec
  }
}

// Whether a harness under a transport can continue a conversation.
export const canResume = (a: HarnessAdapter, t: Transport) =>
  t === 'acp' || (t === 'cli-jsonl' && Boolean(a.transports['cli-jsonl']?.resume))

