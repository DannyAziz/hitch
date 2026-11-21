// The harness table: one import and one line per harness. Each harness lives
// in its own folder (see README.md here for what an entry must provide).

import { pi } from './pi'
import { amp } from './amp'
import type { HarnessAdapter } from '../core/types'
import { codex } from './codex'
import { cursor } from './cursor'
import { devin } from './devin'

export const HARNESSES: readonly HarnessAdapter[] = [
  codex,
  cursor,
  amp,
  pi,
  devin,
]
