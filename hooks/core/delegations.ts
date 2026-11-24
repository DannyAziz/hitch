import type { EngineInterface } from 'claude-code'

// ---------------------------------------------------------------- delegation log

export type Outcome = 'done' | 'failed' | 'stopped' | 'timeout' | 'refused'

export type Delegation = {
  ts: string
  session?: string
  agentId: string
  harness: string
  transport: string
  model: string
  effort: string | null
  sandbox: string | null
  access?: { level: string | null; decider: string } | string | null
  description: string | null
  promptChars: number
  turn: 'first' | 'follow-up'
  durationMs: number
  rows: number
  tokens: number | null
  outcome: Outcome
  exitCode: number | null
  exit: string
}

// `~/` in the configured path is the user's home, as the shell expands it.
const EXPAND = 'p="$1"; case "$p" in "~/"*) p="$HOME/${p#\\~/}";; esac'

// Appends one JSON line to the delegation log, creating it (and its folder)
// on first write. Never throws: a log that can't be written loses a line.
export async function recordDelegation($: EngineInterface, path: string, entry: Delegation) {
  await $.process
    .run(['/bin/sh', '-c', `${EXPAND}; mkdir -p "$(dirname "$p")" && printf '%s\\n' "$2" >> "$p"`, 'sh', path, JSON.stringify(entry)])
    .catch(() => undefined)
}

export async function readDelegations($: EngineInterface, path: string): Promise<Delegation[]> {
  const read = await $.process
    .run(['/bin/sh', '-c', `${EXPAND}; [ -f "$p" ] && cat "$p" || true`, 'sh', path])
    .catch(() => undefined)
  const out: Delegation[] = []
  for (const line of (read?.stdout ?? '').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as Delegation)
    } catch {}
  }
  return out
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))

// A short table by harness and model: runs, median duration, total tokens,
// failures (anything but done).
export function summarizeDelegations(rows: Delegation[]): string {
  if (!rows.length) return 'No delegations logged yet.'
  const groups = new Map<string, Delegation[]>()
  for (const r of rows) {
    const k = `${r.harness}\t${r.model}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const lines = [
    `${pad('harness', 8)} ${pad('model', 22)} ${pad('runs', 5)} ${pad('median', 8)} ${pad('tokens', 10)} failed`,
  ]
  for (const [k, list] of groups) {
    const [harness, model] = k.split('\t') as [string, string]
    const tokens = list.reduce((n, r) => n + (r.tokens ?? 0), 0)
    const failed = list.filter(r => r.outcome !== 'done').length
    lines.push(
      `${pad(harness, 8)} ${pad(model, 22)} ${pad(String(list.length), 5)} ${pad(`${Math.round(median(list.map(r => r.durationMs)) / 1000)}s`, 8)} ${pad(String(tokens), 10)} ${failed}`,
    )
  }
  return lines.join('\n')
}
