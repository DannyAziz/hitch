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
