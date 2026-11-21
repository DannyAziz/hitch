import type { EngineInterface } from 'claude-code'

type Executable = { path: string; env?: Record<string, string> }

// Lookup cache only, not run state: it lives in memory for this mod instance.
const executables = new Map<string, { command: string; option: string; executable: Executable }>()

export function forgetExecutable(key: string) {
  executables.delete(key)
}

const lastPath = (stdout: string) => stdout.split('\n').filter(line => line.startsWith('/')).at(-1)
const quote = (s: string) => "'" + s.replace(/'/g, "'\"'\"'") + "'"
const PATH_TAG = '__hitch_path__'

export async function resolveExecutable($: EngineInterface, key: string, command: string, option: string): Promise<Executable | undefined> {
  if (command.includes('/')) return { path: command }
  const cached = executables.get(key)
  if (cached?.command === command && cached.option === option) return cached.executable
  let executable: Executable | undefined
  if (option) {
    const home = option === '~' || option.startsWith('~/') ? await $.env.get('HOME') : undefined
    const path = home ? home + option.slice(1) : option
    executable = { path }
  } else {
    const found = await $.process.run(['/bin/sh', '-c', 'command -v "$1"', 'sh', command], { timeoutMs: 3000 }).catch(() => undefined)
    const path = found?.exitCode === 0 ? lastPath(found.stdout) : undefined
    if (path) executable = { path }
    else {
      const shell = await $.env.get('SHELL').catch(() => undefined)
      const shells = [...new Set([shell, '/bin/zsh', '/bin/sh'].filter((s): s is string => Boolean(s)))]
      // A login shell first, then an interactive login shell: tools such as nvm
      // and ~/.local/bin are often added to PATH in ~/.zshrc or ~/.bashrc, which
      // only an interactive shell reads (seen on the machine this was built on).
      const attempts = shells.flatMap(shell => [[shell, '-l', '-c'], [shell, '-l', '-i', '-c']])
      for (const flags of attempts) {
        const found = await $.process.run([
          ...flags, `printf '%s\\n' "${PATH_TAG}$PATH"; command -v ${quote(command)}`,
        ], { timeoutMs: 5000 }).catch(() => undefined)
        const path = found?.exitCode === 0 ? lastPath(found.stdout) : undefined
        const shellPath = found?.stdout.split('\n').filter(line => line.startsWith(PATH_TAG)).at(-1)?.slice(PATH_TAG.length)
        if (path && shellPath !== undefined) {
          executable = { path, env: { PATH: shellPath } }
          break
        }
      }
    }
  }
  if (executable) executables.set(key, { command, option, executable })
  return executable
}
