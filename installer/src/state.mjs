// Read-only Claude Code plugin state: which hitch copies are loaded, whether
// the managed security mod is visible, and whether the hitch marketplace is
// already configured.

import { parseConfigureInputs, parseMarketplaceList, parsePluginList } from './parse.mjs'
import { RunError } from './run.mjs'

async function mustJson(run, argv, what) {
  let r
  try {
    r = await run(argv, { timeoutMs: 20000 })
  } catch (err) {
    throw new RunError(`could not check ${what}: ${err.message}`, { code: err.code, spawnError: false })
  }
  if (r.code !== 0) throw new RunError(`could not read ${what}: ${argv.join(' ')} exited ${r.code}: ${(r.stderr || r.stdout || '').trim()}`, { spawnError: false })
  try {
    return JSON.parse(r.stdout)
  } catch {
    throw new RunError(`could not read ${what}: ${argv.join(' ')} returned invalid JSON`, { spawnError: false })
  }
}

// → { hitchInstalled, inlineLoaded, secDefault, marketplaceKnown }
export async function readPluginState(run) {
  const plugins = await mustJson(run, ['claude', 'plugin', 'list', '--json'], 'installed plugins')
  const state = parsePluginList(plugins)
  try {
    const marketplaces = await mustJson(run, ['claude', 'plugin', 'marketplace', 'list', '--json'], 'marketplaces')
    state.marketplaceKnown = parseMarketplaceList(marketplaces).marketplaceKnown
  } catch {
    state.marketplaceKnown = false
  }
  return state
}

// → inputs object from `claude plugin configure <id> --json`, or {} when the
// plugin has no stored values / the read fails (first run, or not installed).
export async function readPluginSettings(run, pluginId) {
  try {
    const data = await mustJson(run, ['claude', 'plugin', 'configure', pluginId, '--json'], `settings for ${pluginId}`)
    return parseConfigureInputs(data)
  } catch {
    return {}
  }
}
