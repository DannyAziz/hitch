// hitch installer — detects agent CLIs, asks a few questions, installs the
// hitch plugin into Claude Code and writes the answers as plugin settings.
// Entry point for `npx github:DannyAziz/hitch`. Everything testable lives in
// the sibling modules; this file only wires them together.

import { intro, isCancel, note, confirm, log, outro, spinner } from '@clack/prompts'
import pc from 'picocolors'
import { run as realRun, isNotFound, RunError } from './run.mjs'
import { detectHarnesses, formatDetection } from './detect.mjs'
import { readPluginSettings, readPluginState } from './state.mjs'
import {
  answersFromYes,
  buildSettingsValues,
  promptDefaults,
  validateAnswers,
} from './settings.mjs'
import { buildPlan } from './plan.mjs'
import { reviewText } from './review.mjs'
import { ApplyError, executePlan, runHarnessTest, testSkipped } from './apply.mjs'
import { promptInstaller } from './prompts.mjs'
import { HARNESSES } from './harnesses.mjs'

const VERSION = typeof __HITCH_VERSION__ === 'undefined' ? '0.10.0' : __HITCH_VERSION__

const USAGE = `hitch installer — sets up the hitch Claude Code plugin

Usage: hitch [--yes] [--dry-run] [--update] [--help] [--version]

Options:
  --yes       No prompts: detect, choose every eligible harness found, use
              defaults everywhere, run no test
  --dry-run   Run every read-only step and all prompts, print the commands
              and settings JSON that would be applied, change nothing
  --update    Also update an installed hitch@hitch before configuring it
  --help      Show this help
  --version   Print the version
`

function parseArgs(argv) {
  const flags = { yes: false, dryRun: false, update: false, help: false, version: false }
  for (const arg of argv) {
    if (arg === '--yes') flags.yes = true
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--update') flags.update = true
    else if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg === '--version' || arg === '-v') flags.version = true
    else throw new Error(`unknown flag: ${arg}`)
  }
  return flags
}

function fail(message) {
  note(message, 'Cannot continue')
  return 1
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  if (flags.help) {
    console.log(USAGE)
    return 0
  }
  if (flags.version) {
    console.log(`hitch ${VERSION}`)
    return 0
  }

  const run = realRun

  intro(pc.bold(`hitch installer ${VERSION}`))

  // 0. Claude Code must be installed.
  try {
    const v = await run(['claude', '--version'], { timeoutMs: 15000 })
    if (v.code !== 0) return fail(`\`claude --version\` exited ${v.code}.\n\nInstall Claude Code and make sure \`claude\` is on your PATH, then run this again.`)
  } catch (err) {
    if (isNotFound(err)) {
      return fail('`claude` was not found on PATH.\n\nInstall Claude Code and make sure `claude` is on your PATH, then run this again.')
    }
    return fail(`could not run \`claude --version\`: ${err.message}`)
  }

  // hitch has only been used on macOS.
  if (process.platform !== 'darwin' && !flags.yes) {
    await note('hitch has only been used on macOS. It needs /usr/bin/perl, which macOS ships.', 'Platform')
    const go = await confirm({ message: 'Continue anyway?', initialValue: false })
    if (isCancel(go) || !go) {
      outro('Stopped — nothing was changed.')
      return 0
    }
  }

  // Plugin state + stored settings (read-only).
  let state
  try {
    state = await readPluginState(run)
  } catch (err) {
    return fail(`could not read Claude Code plugin state: ${err.message}`)
  }
  const targetId = state.hitchInstalled ? 'hitch@hitch' : state.inlineLoaded ? 'hitch@inline' : null
  const inputs = targetId ? await readPluginSettings(run, targetId) : {}

  // 1. Detect harnesses (read-only probes only).
  const piHarness = HARNESSES.find(h => h.key === 'pi')
  const piModel = (typeof inputs.piModel === 'string' && inputs.piModel.trim()) || piHarness.defaultModel
  const detection = await detectHarnesses({ run, piModel })
  await note(formatDetection(detection), 'Harnesses found')

  const defaults = promptDefaults({ detection, inputs })
  const preview = answers => {
    const values = buildSettingsValues(answers, { secDefault: state.secDefault })
    const plan = buildPlan({ state, values, update: flags.update })
    return { values, plan, text: reviewText(plan, values) }
  }

  // 2–5. Choose, per-harness settings, rubric, review.
  let answers
  if (flags.yes) {
    answers = answersFromYes(detection, defaults)
  } else {
    const res = await promptInstaller({ detection, defaults, preview, dryRun: flags.dryRun })
    if (res.cancelled) {
      outro('Cancelled — nothing was changed.')
      return 0
    }
    answers = res.answers
  }

  const problems = validateAnswers(answers, detection)
  if (problems.length) return fail(problems.map(p => `• ${p}`).join('\n'))

  const { plan, text, values } = preview(answers)

  // --dry-run stops here: print the plan and change nothing. Under --yes the
  // review step never ran, so the plan is printed now; with prompts it was
  // already shown at the review confirm and is repeated for the record.
  if (flags.dryRun) {
    await note(`${text}\n\nSettings as they would be saved:\n${Object.entries(values).map(([k, v]) => `  ${k} = ${v}`).join('\n')}\n\nDry run: nothing was changed.`, 'Plan')
    outro('Re-run without --dry-run to apply.')
    return 0
  }

  // 6. Apply.
  const s = spinner()
  try {
    await executePlan(run, plan, {
      onStep: step => {
        if (step.phase === 'start') s.start(`$ ${step.command.argv.join(' ')}`)
        else if (step.phase === 'done') s.stop(`✔ ${step.command.label}`)
        else if (step.phase === 'dry') s.stop(`would run: ${step.command.label}`)
      },
    })
  } catch (err) {
    s.stop('stopped')
    const done = err instanceof ApplyError && err.completed.length ? err.completed.join('\n  ') : '(nothing)'
    const left = err instanceof ApplyError && err.remaining.length
      ? err.remaining.map(c => c.label || c.argv.join(' ')).join('\n  ')
      : '(nothing)'
    return fail(`Stopped at: ${err.message}\n\nDone:\n  ${done}\n\nNot done:\n  ${left}`)
  }

  // 7. Optional one-word test per harness.
  let runTest = false
  if (!flags.yes) {
    const t = await confirm({
      message: "Run a one-word test on each harness? It makes one small Claude request and one small request on each harness's plan.",
      initialValue: false,
    })
    runTest = !isCancel(t) && t === true
  }
  const testResults = []
  if (runTest) {
    for (const key of answers.chosen) {
      const access = answers.accesses[key] || 'follow'
      if (testSkipped(key, access)) {
        log.info(`hitch:${key} — skipped: needs your approval inside Claude Code`)
        testResults.push({ key, result: 'skipped' })
        continue
      }
      const sp = spinner()
      sp.start(`testing hitch:${key}`)
      try {
        const r = await runHarnessTest(run, key)
        if (r.result === 'pass') sp.stop(`hitch:${key} — pass`)
        else sp.stop(`hitch:${key} — fail: ${r.firstLine || `exit ${r.code}`}`)
        testResults.push({ key, ...r })
      } catch (err) {
        sp.stop(`hitch:${key} — error: ${err.message}`)
        testResults.push({ key, result: 'fail', firstLine: err.message })
      }
    }
  }

  // 8. Next steps.
  outro(buildOutro({ answers, plan, testResults, secDefault: state.secDefault }))
  return 0
}

function buildOutro({ answers, plan, testResults, secDefault }) {
  const lines = [
    'Start a new Claude Code session to use hitch — plugins load at session start.',
    '',
    'Try asking Claude:',
  ]
  if (answers.reviewer) {
    lines.push(`  Use a hitch:${answers.reviewer} subagent to review my changes and report issues.`)
  }
  if (answers.builder) {
    lines.push(`  Use a hitch:${answers.builder} subagent to implement this well-specified task: <describe it>.`)
  }
  const first = answers.chosen[0]
  const extra = answers.chosen.length > 1 ? ` (also: ${answers.chosen.slice(1).map(k => `hitch:${k}`).join(', ')})` : ''
  lines.push(`  Use a hitch:${first} subagent to <describe a self-contained task>.${extra}`)
  lines.push('  These are explicit asks — the default eagerness is ask-only.')
  lines.push('')
  lines.push('Commands: /hitch (agent status), /hitch rubric (the rubric in force), /hitch log (delegation summary).')
  lines.push('Run this installer again to change the answers.')
  if (testResults.length) {
    const summary = testResults.map(t => `${t.key}:${t.result}`).join('  ')
    lines.push(`Test: ${summary}`)
  }
  if (plan.targetId === 'hitch@hitch') {
    lines.push(`Remove it with: claude plugin uninstall ${plan.targetId}`)
  } else {
    lines.push(`${plan.targetId} is loaded from a folder in CLAUDE_CODE_PLUGIN_DIRS — remove that entry to unload it.`)
  }
  if (!secDefault) {
    lines.push("Note: Claude Code's managed security mod (sec-default) was not detected in the plugin list, so hideRowTool was left unchanged.")
  }
  return lines.join('\n')
}

main()
  .then(code => { process.exitCode = code })
  .catch(err => {
    if (err instanceof RunError) {
      note(`error: ${err.message}`, 'hitch installer')
    } else {
      note(`error: ${err?.stack || err}`, 'hitch installer')
    }
    process.exitCode = 1
  })
