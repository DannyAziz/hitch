// Execute the plan's commands in order through the injected run(). A
// non-zero exit or spawn failure stops everything after it and throws an
// ApplyError describing what was and was not done. dryRun never calls run()
// for the plan's commands — it only reports them.

import { firstLine } from './parse.mjs'

export class ApplyError extends Error {
  constructor(message, { command, completed = [], remaining = [] } = {}) {
    super(message)
    this.name = 'ApplyError'
    this.command = command
    this.completed = completed
    this.remaining = remaining
  }
}

const describe = cmd => cmd.label || cmd.argv.join(' ')

export async function executePlan(run, plan, { dryRun = false, onStep } = {}) {
  const completed = []
  for (let i = 0; i < plan.commands.length; i++) {
    const cmd = plan.commands[i]
    onStep?.({ phase: 'start', command: cmd, index: i })
    if (dryRun) {
      onStep?.({ phase: 'dry', command: cmd, index: i })
      continue
    }
    let r
    try {
      r = await run(cmd.argv, { input: cmd.input, timeoutMs: cmd.timeoutMs ?? 120000 })
    } catch (err) {
      throw new ApplyError(`could not run ${describe(cmd)}: ${err.message}`, {
        command: cmd,
        completed,
        remaining: plan.commands.slice(i + 1),
      })
    }
    if (r.code !== 0) {
      const detail = r.timedOut
        ? `timed out after ${cmd.timeoutMs ?? 120000}ms`
        : firstLine(r.stderr || r.stdout || '') || `exit code ${r.code}`
      throw new ApplyError(`${describe(cmd)} failed: ${detail}`, {
        command: cmd,
        completed,
        remaining: plan.commands.slice(i + 1),
      })
    }
    completed.push(describe(cmd))
    onStep?.({ phase: 'done', command: cmd, index: i })
  }
  return completed
}

// One small end-to-end check per chosen harness: a headless Claude request
// that asks for a hitch:<key> subagent. 120 s limit; pass when the output
// contains "pong".
export async function runHarnessTest(run, key) {
  const prompt = `Use a hitch:${key} subagent to reply with the single word pong, wait for it to finish, then reply with exactly what it said and nothing else.`
  const r = await run(['claude', '-p', prompt, '--model', 'haiku'], { timeoutMs: 120000 })
  const out = `${r.stdout || ''}\n${r.stderr || ''}`
  return {
    result: out.toLowerCase().includes('pong') ? 'pass' : 'fail',
    firstLine: firstLine(out),
    code: r.code,
  }
}

// Amp under `follow` needs a per-run approval a headless session cannot give.
export function testSkipped(key, access) {
  return key === 'amp' && (!access || access === 'follow')
}
