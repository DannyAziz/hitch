// Small text helpers shared by the core and the transports.

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

// Text safe to draw: terminal escape sequences (colours, cursor moves) and
// other control characters removed, tabs as spaces. A harness's command
// output often carries them, and Claude Code refuses a drawn text that does.
export const printable = (s: string) =>
  s
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')

// A prompt may open with a line `model: <name>`: the harness's own name for
// the model this agent runs from this turn on, in place of `<key>Model`. The
// line is taken out of what the harness is sent. Only a lowercase `model:`
// and one plain word count (the word becomes one argument to the CLI, and
// may carry Cursor's `[key=value,...]` overrides); any other first line,
// `Model: Invoice` included, is left in the prompt as text.
const MODEL_LINE = /^[ \t\n]*model:[ \t]*([A-Za-z0-9][\w.~/:@\[\],=-]*)[ \t]*(?:\n+|$)/
export const takeModel = (prompt: string): { model?: string; prompt: string } => {
  const text = prompt.replace(/\r\n?/g, '\n')
  const m = MODEL_LINE.exec(text)
  return m ? { model: m[1]!, prompt: text.slice(m[0].length) } : { prompt: text }
}

// Claude Code hands a SendMessage to a subagent wrapped in a note for a
// Claude agent mid-task ("The coordinator sent a message while you were
// working: ... Address this before completing your current task."). The
// harness gets the message itself, so a `model:` line in it is its first.
const WRAPPED = /^\s*The coordinator sent a message while you were working:[ \t]*\n([\s\S]*?)\s*Address this before completing your current task\.?\s*$/
export const unwrapMessage = (text: string): string => WRAPPED.exec(text)?.[1]?.trim() ?? text
