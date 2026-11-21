// Transport `cli-jsonl`: a CLI that takes the prompt (on stdin or argv),
// writes one JSON event per stdout line, and exits. The entry's `parse` maps
// each line to one or more HarnessEvents: `started` when a command or tool begins,
// `action` when it finishes (each action is a row), `message` for its text.
// `resume` continues a conversation by id; without it the harness can't be
// continued. Generic: nothing here knows any particular CLI.

import type { DetailContext, HarnessAction, HarnessEvent, Invocation, LaunchSpec } from '../core/types'

// Mutable plain JSON data owned by one run, persisted alongside its read position.
export type ParserMemo = Record<string, any>

export type CliJsonl = {
  start(spec: LaunchSpec): Invocation
  resume?(spec: LaunchSpec & { sessionId: string }): Invocation
  parse(line: string, memo: ParserMemo): HarnessEvent | HarnessEvent[]
  // Optional: extra text for an action's row (the real diff of a change).
  detail?(action: HarnessAction, ctx: DetailContext): Promise<string | undefined>
}

// The command for this turn: a resume when there is a conversation to
// continue and the CLI can, else a fresh start.
export const jsonlInvocation = (t: CliJsonl, spec: LaunchSpec, resumeId: string | undefined): Invocation =>
  resumeId && t.resume ? t.resume({ ...spec, sessionId: resumeId }) : t.start(spec)

// One stdout line to its events.
export function jsonlEvents(t: CliJsonl, raw: string, memo: ParserMemo): HarnessEvent[] {
  const line = raw.trim()
  if (!line) return []
  const events = t.parse(line, memo)
  return Array.isArray(events) ? events : [events]
}
