// Bundles src/main.mjs into ../bin/hitch.mjs: one self-contained ESM file for
// Node >= 20 (and Bun), with the plugin version baked in.

import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pluginJson = JSON.parse(readFileSync(join(here, '..', '.claude-plugin', 'plugin.json'), 'utf8'))

await build({
  entryPoints: [join(here, 'src', 'main.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: join(here, '..', 'bin', 'hitch.mjs'),
  banner: { js: '#!/usr/bin/env node' },
  define: { __HITCH_VERSION__: JSON.stringify(pluginJson.version) },
  // Don't pick up the plugin's tsconfig.json (it extends generated types).
  tsconfigRaw: '{}',
  logLevel: 'info',
})

console.log(`built bin/hitch.mjs (hitch ${pluginJson.version})`)
