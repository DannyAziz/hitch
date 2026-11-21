// Test-only: each harness's recorded fixture, for the contract test in
// tests/contract.test.ts, which runs the same checks against every entry of
// the table. One import and one line per harness, as in index.ts; an entry
// with no fixture here fails the contract test.

import { fixture as pi } from './pi/fixture'
import { fixture as amp } from './amp/fixture'
import { fixture as codex } from './codex/fixture'
import { fixture as cursor } from './cursor/fixture'
import { fixture as devin } from './devin/fixture'

export type HarnessFixture = {
  // The CLI version the output was recorded from.
  version: string
  // Stdout of a first turn, line by line, as the harness wrote it.
  first: string[]
  // How many rows that turn yields, and its closing report.
  // Other recorded streams, including failures, checked by the privacy test.
  additional?: Record<string, string[]>
  rows: number
  closing: string
  // Stdout of a follow-up turn, for a harness that can be continued.
  followUp?: string[]
  followUpClosing?: string
  // Canned stdout for shell commands a row's detail runs, keyed by a piece
  // of the script (Codex's rollout grep).
  shell?: Record<string, string>
}

export const FIXTURES: Record<string, HarnessFixture> = {
  codex,
  cursor,
  amp,
  pi,
  devin,
}
