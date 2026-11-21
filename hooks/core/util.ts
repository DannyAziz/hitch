import type { EngineInterface } from 'claude-code'

let lastTouch = 0

// Asks the agent rows to draw again (their label says what the harness is
// doing), once a second at most.
export function touch($: EngineInterface) {
  const now = Date.now()
  if (now - lastTouch < 1000) return
  lastTouch = now
  try {
    $.ui.invalidate('ui.render')
  } catch {}
}

let scratch: string | undefined

async function base($: EngineInterface) {
  if (scratch === undefined) {
    scratch = (await $.session.info().catch(() => undefined))?.scratchpadDir
    if (!scratch) {
      // A headless (`claude -p`) session has no scratchpad directory: use a
      // private temporary folder instead (mktemp makes it mode 700).
      const made = await $.process
        .run(['/bin/sh', '-c', 'mktemp -d "${TMPDIR:-/tmp}/hitch-XXXXXXXX"'])
        .catch(() => undefined)
      const path = made?.exitCode === 0 ? made.stdout.trim().split('\n').at(-1) : undefined
      if (path?.startsWith('/')) scratch = path
    }
  }
  return scratch ? `${scratch}/hitch` : undefined
}

// Where an agent's harness activity is logged: the session's scratchpad.
export async function logFile($: EngineInterface, agentId: string) {
  const dir = await base($)
  return dir ? `${dir}/${agentId}.log` : undefined
}

// A fresh directory for one harness turn's files (input, out, err, exit).
export async function runDir($: EngineInterface, agentId: string, turn: number) {
  const dir = await base($)
  if (!dir) return undefined
  const path = `${dir}/${agentId}/turn-${turn}-${Date.now().toString(36)}`
  const made = await $.process.run(['mkdir', '-p', path]).catch(() => undefined)
  return made?.exitCode === 0 ? path : undefined
}
