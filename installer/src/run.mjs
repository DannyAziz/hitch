// The single place every external command goes through. Injectable so the
// rest of the installer (and the unit tests) never touch child_process.
//
// run(argv, { input, timeoutMs }) → Promise<{ code, stdout, stderr, timedOut }>
//   argv[0] is the binary; the rest are arguments (never a shell string).
//   input, when given, is written to stdin which is then closed.
//   Non-zero exit codes resolve normally; only spawn failures and timeouts
//   are exceptional. A timeout kills the process and resolves with
//   timedOut: true and code: null.
//   Spawn failures (e.g. ENOENT — binary not on PATH) reject with a
//   RunError carrying .code.

import { spawn } from 'node:child_process'

export class RunError extends Error {
  constructor(message, { code, spawnError = true } = {}) {
    super(message)
    this.name = 'RunError'
    this.code = code
    this.spawnError = spawnError
  }
}

export function isNotFound(err) {
  return !!err && err.code === 'ENOENT'
}

export function run(argv, { input, timeoutMs = 30000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv
    let child
    try {
      child = spawn(cmd, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      reject(new RunError(`could not start ${cmd}: ${err.message}`, { code: err.code }))
      return
    }

    let settled = false
    let timedOut = false
    let stdout = ''
    let stderr = ''

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, timeoutMs)
      : null

    const finish = fn => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn()
    }

    child.on('error', err => {
      finish(() => reject(new RunError(`could not run ${cmd}: ${err.message}`, { code: err.code })))
    })

    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })

    child.on('close', code => {
      finish(() => resolve({ code, stdout, stderr, timedOut }))
    })

    child.stdin.on('error', () => {}) // EPIPE if the child exits early
    if (input !== undefined && input !== null) child.stdin.write(String(input))
    child.stdin.end()
  })
}
