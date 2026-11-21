// Plan + answers → the text shown at the review step and in --dry-run.
// Pure.

export function actionText(plan) {
  switch (plan.action) {
    case 'install':
      return 'Install the hitch plugin into Claude Code, then save these settings.'
    case 'update':
      return 'Update the installed hitch plugin, then save these settings.'
    case 'configure':
      return 'hitch is already installed. Only the settings change.'
    case 'configure-inline':
      return 'hitch is loaded from a folder on this machine. Only the settings change.'
    default:
      return ''
  }
}

// The stdin payload is the settings again as one long JSON line: the review
// lists the settings readably instead, so only the command is shown.
export function commandLine(cmd) {
  return `$ ${cmd.argv.join(' ')}`
}

const ACCESS_WORDS = { follow: "follows the session's permission mode" }
const EAGERNESS_WORDS = {
  'ask-only': 'only when you ask',
  rubric: 'when a task suits a harness',
  eager: 'whenever it can',
}
const KEYS = ['codex', 'cursor', 'amp', 'pi', 'devin']

// The review note, in plain lines no wider than a normal terminal: what
// happens to the plugin, each harness with its model and access, the rubric
// choices, then the commands that will run.
export function reviewLines(plan, values) {
  const lines = [actionText(plan), '']
  const on = KEYS.filter(k => values[`${k}Enabled`] === 'true')
  const off = KEYS.filter(k => values[`${k}Enabled`] === 'false')
  lines.push('Harnesses on:')
  for (const k of on) {
    const access = values[`${k}Access`]
    lines.push(`  ${k.padEnd(7)} ${values[`${k}Model`]}`)
    lines.push(`  ${''.padEnd(7)} access: ${ACCESS_WORDS[access] ?? access}`)
  }
  if (off.length) lines.push(`Harnesses off: ${off.join(', ')}`)
  lines.push('')
  lines.push(`Claude uses hitch: ${EAGERNESS_WORDS[values.eagerness] ?? values.eagerness}`)
  lines.push(`Reviews go to:     ${values.reviewer || 'nobody in particular'}`)
  lines.push(`Builds go to:      ${values.builder || 'nobody in particular'}`)
  if (values.hideRowTool !== undefined) lines.push(`hideRowTool:       ${values.hideRowTool}`)
  lines.push('', 'Commands that will run:', ...plan.commands.map(c => `  ${commandLine(c)}`))
  return lines
}

export function reviewText(plan, values) {
  return reviewLines(plan, values).join('\n')
}
