// Turn plugin state + settings values into the exact list of commands the
// installer would run. Pure: nothing here executes anything.
//
// plan = {
//   action: 'install' | 'update' | 'configure' | 'configure-inline',
//   targetId: 'hitch@hitch' | 'hitch@inline',
//   commands: [{ argv, input?, label, timeoutMs }],
//   settingsJson: '<one-line JSON for --values-stdin>',
// }

export function buildPlan({ state, values, update = false }) {
  const settingsJson = JSON.stringify(values)
  const commands = []
  let action
  let targetId

  if (!state.hitchInstalled && !state.inlineLoaded) {
    action = 'install'
    targetId = 'hitch@hitch'
    if (!state.marketplaceKnown) {
      commands.push({
        argv: ['claude', 'plugin', 'marketplace', 'add', 'DannyAziz/hitch'],
        label: 'claude plugin marketplace add DannyAziz/hitch',
        timeoutMs: 300000,
      })
    }
    commands.push({
      argv: ['claude', 'plugin', 'install', 'hitch@hitch'],
      label: 'claude plugin install hitch@hitch',
      timeoutMs: 300000,
    })
  } else if (state.hitchInstalled) {
    targetId = 'hitch@hitch'
    if (update) {
      action = 'update'
      if (state.marketplaceKnown) {
        commands.push({
          argv: ['claude', 'plugin', 'marketplace', 'update', 'hitch'],
          label: 'claude plugin marketplace update hitch',
          timeoutMs: 300000,
        })
      }
      commands.push({
        argv: ['claude', 'plugin', 'update', 'hitch@hitch'],
        label: 'claude plugin update hitch@hitch',
        timeoutMs: 300000,
      })
    } else {
      action = 'configure'
    }
  } else {
    // Loaded from a folder (CLAUDE_CODE_PLUGIN_DIRS): configure that copy,
    // never install a second one.
    action = 'configure-inline'
    targetId = 'hitch@inline'
  }

  commands.push({
    argv: ['claude', 'plugin', 'configure', targetId, '--values-stdin'],
    input: settingsJson,
    label: `claude plugin configure ${targetId} --values-stdin`,
    timeoutMs: 60000,
  })

  return { action, targetId, commands, settingsJson }
}
