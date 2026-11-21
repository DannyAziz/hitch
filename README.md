# hitch

hitch runs other agent harnesses as native Claude Code subagents. Today those are OpenAI's Codex CLI, Cursor's agent CLI, Amp CLI, pi CLI, and Cognition's Devin CLI.

Claude starts them with the Agent tool like any other subagent type (`hitch:codex`, `hitch:cursor`, `hitch:amp`, `hitch:pi`, `hitch:devin`). They show in the agent list, can be stopped, send a notification when done, and take SendMessage follow-ups. Claude Code owns their loop, but no Claude request is made for their work: each step of the agent is answered by hitch from the harness's own output.

## Supported harnesses

| Agent type | Harness | How it is driven | Tested with |
| --- | --- | --- | --- |
| `hitch:codex` | OpenAI Codex CLI | `codex exec --json` | codex-cli 0.167.0 |
| `hitch:cursor` | Cursor agent CLI | `agent -p --output-format stream-json` | agent CLI 2026.11.19-f005e9d |
| `hitch:amp` | Amp CLI | `amp -x --stream-json` | recordings; version unknown |
| `hitch:pi` | pi CLI | `pi -p --mode json` | pi 1.2.0 |
| `hitch:devin` | Devin CLI | `devin acp` (Agent Client Protocol); `devin -p` as an option | devin 3000.14.30821 |

Each harness has a README in `hooks/harnesses/<name>/` with what works, its quirks, and what it does not support. The harness's CLI must be installed and signed in; hitch does not install or sign in to anything.

hitch needs Claude Code with function-hook plugins (mods), and `/usr/bin/perl`, which runs the small process supervisor. It has been used on macOS only.

## Install

### The easy way: the installer

```
npx github:DannyAziz/hitch
```

The installer finds the agent CLIs on your machine (Codex, Cursor's `agent`, Amp, pi, Devin), shows a compact report of what it found — version, sign-in status, and how each differs from the version hitch was tested with — then asks which harnesses to use and a few questions about models, access, and who reviews and builds. It installs the plugin and saves your answers as its settings. If hitch is already loaded from a clone it writes the settings to that copy instead of installing a second one. Re-run the installer any time to change the answers.

It needs Node.js 20+ (or Bun) and `claude` on your PATH. While detecting it only runs read-only probes; the only changes it makes are the `claude plugin` commands it shows you at the review step, and only after you confirm. Useful flags: `--yes` (no prompts), `--dry-run` (run the read-only steps and prompts, print the plan, change nothing), `--update` (update an installed copy first).

Then restart Claude Code. A plugin installed for your user is also loaded by the desktop app's local sessions.

### What you need first

- **Claude Code with mods.** hitch is a mod (a function-hook plugin). It was built and tested on Claude Code 2.1.329, in the terminal and in the desktop app.
- **macOS.** It has only been used there. It needs `/usr/bin/perl`, which macOS ships.
- **At least one harness CLI, installed and signed in.** hitch does not install or sign in to anything. Check each one you want by running it once yourself: `codex`, `agent` (Cursor), `amp`, `pi`, `devin`.

### Install by hand

In a Claude Code session:

```
/plugin install hitch --marketplace DannyAziz/hitch
```

Or from a shell:

```
claude plugin marketplace add DannyAziz/hitch
claude plugin install hitch@hitch
```

Then restart Claude Code. A plugin installed for your user is also loaded by the desktop app's local sessions.

### Or run it from a clone

```
git clone https://github.com/DannyAziz/hitch.git
claude --plugin-dir /path/to/hitch
```

That loads it for one terminal session. To load the clone in every session, including the desktop app, name the folder in `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/code/hitch" } }
```

Quit and reopen the desktop app after changing it. Use one way of loading hitch, not both.

### Check it works

Ask Claude:

```
Use a hitch:codex subagent to reply with the word pong.
```

You should see a `hitch:codex` agent in the agent list and `pong` come back as its report. Swap in `hitch:pi`, `hitch:cursor`, `hitch:devin` or `hitch:amp` for the harness you have. If a CLI cannot be found, the agent fails with a message naming the `<key>Path` option to set.

### The first time it wants to write

Outside bypass-permissions mode, pi, Cursor and Amp ask you once per run before they get full access, with an option to allow that harness for the rest of the session. Codex runs in its own sandbox and does not ask. See Permissions.

### Update and remove

```
claude plugin update hitch@hitch
claude plugin uninstall hitch@hitch
```

For a clone, `git pull` updates it and removing the folder from `CLAUDE_CODE_PLUGIN_DIRS` removes it.

### Working on the installer

The installer's source is plain ESM JavaScript in `installer/src/`, with unit tests in `installer/test/*.spec.mjs`. `bin/hitch.mjs` is the committed bundle that `npx` runs — it must be rebuilt after any source change:

```
cd installer
npm install
npm run build
```

`installer/node_modules` is gitignored and must not be committed. `claude plugin validate .` and `claude plugin test .` pass with it present.

## Use

Ask Claude to hand a task to Codex, Cursor, Amp, pi, or Devin, or ask for the agent type by name. The bundled skill `hitch:harness-delegation` gives Claude a rubric: when to hand work off, which harness to pick, how to write a self-contained brief, and how to check what comes back.

- **SendMessage** to a hitch agent continues the harness's own conversation (Codex's or Amp's thread, Cursor's, pi's or Devin's session).
- **Context fullness.** Devin reports how full its context window is, and Amp and pi report the tokens in their latest request. hitch shows it on the agent row (`ctx 60%`, or `ctx 157k` without a window size) and ends each answer with a line such as `[hitch] Devin context: 157k of 262k tokens (60% full).`, so Claude can choose between continuing an agent and starting a fresh one. Codex and Cursor report only per-turn totals and get no context line.
- **Stop:** stopping the agent (the agent list, Esc, or TaskStop) stops the harness and every process it started.
- **`/hitch`** lists hitch agents. For each it shows the harness session, turns and tokens, and the engine's own count of Claude usage for that agent, which should say "no requests".
- **`/hitch log`** summarizes the delegation log.
- **`/hitch rubric`** prints the harness choices: which are on, the reviewer and builder, and the eagerness.

## Options

Set them in the plugin's config menu, or in settings under `pluginConfigs.hitch`.

Desktop app sessions may lack your shell PATH: hitch checks PATH, then a non-interactive login shell (including its PATH for the child); `<key>Path` overrides that search with an absolute path (`~` allowed).

| Option | Default | What it does |
| --- | --- | --- |
| `codexEnabled` | on | Off: `hitch:codex` is not registered as an agent type at all. |
| `codexPath` | empty | Explicit path to the codex CLI; skips lookup. |
| `codexModel` | `gpt-6-astra` | The model Codex runs (always passed as `-m`). The Agent tool's `model` parameter takes only Claude aliases, so it does not apply. |
| `codexIdleTimeoutSec` | 300 | Stop Codex if it is silent this long while waiting on its model. |
| `codexCommandTimeoutSec` | 3600 | Stop Codex if one command runs this long. |
| `cursorEnabled` | on | Off: `hitch:cursor` is not registered as an agent type at all. |
| `cursorPath` | empty | Explicit path to the Cursor `agent` CLI; skips lookup. |
| `cursorModel` | `auto` | The model Cursor runs (always passed as `--model`). Cursor encodes effort in model names, so the call's effort is not mapped. |
| `cursorIdleTimeoutSec` | 300 | As for Codex. |
| `cursorCommandTimeoutSec` | 3600 | As for Codex. |
| `ampEnabled` | on | Off: `hitch:amp` is not registered as an agent type at all. |
| `ampPath` | empty | Explicit path to the amp CLI; skips lookup. |
| `ampModel` | `medium` | Amp agent mode (`-m`): low, medium, high, ultra; effort overrides it. Amp runs with its own default permissions; hitch does not restrict it. |
| `ampIdleTimeoutSec` | 300 | Stop Amp if it is silent this long while waiting on its model. |
| `ampCommandTimeoutSec` | 3600 | Stop Amp if one command or tool runs this long. |
| `piEnabled` | on | Off: `hitch:pi` is not registered as an agent type at all. |
| `piPath` | empty | Explicit path to the pi CLI; skips lookup. |
| `piModel` | `openrouter/~deepseek/deepseek-flash-latest` | The provider and model pi runs, as `provider/model`, split at the first slash into `--provider` and `--model`. Effort maps to `--thinking`. |
| `piIdleTimeoutSec` | 300 | As for Codex. |
| `piCommandTimeoutSec` | 3600 | As for Codex. |
| `devinEnabled` | on | Off: `hitch:devin` is not registered as an agent type at all. |
| `devinPath` | empty | Explicit path to the devin CLI; skips lookup. |
| `devinModel` | `swe-2-flash-high` | The model Devin runs. For the free `swe-2` models, the Agent call's effort picks the suffix. |
| `devinIdleTimeoutSec` | 600 | As for Codex. |
| `devinCommandTimeoutSec` | 3600 | As for Codex. |
| `devinTransport` | `acp` | `acp`, or `cli-text` for the older `devin -p` mode: plain text, no rows, no follow-ups. |
| `delegationLog` | `~/.claude/hitch/delegations.jsonl` | Where the delegation log is written. |
| `hideRowTool` | on | Registers the two hooks that keep the display-only `HitchLog` tool out of other agents' tool lists. Where Claude Code's managed security mod (`sec-default`) runs first, those hooks never run and Claude Code prints two "hook was skipped" lines per session: turn this off there to drop the lines. |
| `stampHarnessModel` | off | Experimental: steps report zero usage naming the harness's model, instead of no usage. |
| `reviewer` | empty | A harness key whose agent description then says it is the user's chosen harness for second opinions and reviews; off or unknown counts as empty. |
| `builder` | empty | A harness key whose agent description then says it is the user's chosen harness for well-specified builds; off or unknown counts as empty. |
| `eagerness` | `ask-only` | How eagerly Claude hands work to a harness, stated in every agent description: `ask-only`, `rubric`, or `eager`. |

The Agent call's `effort` maps to the harness's reasoning effort where it has one. `isolation: "worktree"` works: the harness runs in the worktree the engine made.

## Roles and eagerness

Three options say who does what and how eagerly Claude hands work over. `reviewer` and `builder` each name one harness key, or stay empty for none; the named harness's agent description then says it is the user's chosen harness for second opinions and reviews, or for well-specified builds. A key that is off or unknown counts as empty. `eagerness` sets when Claude may use a harness without being asked: `ask-only` (the default) only when the user names it or wants another model's view, `rubric` also when the delegation rubric fits, `eager` prefers handing self-contained work to a harness. The choices reach Claude only through the agent types' descriptions — the one text it always sees when choosing an agent — and `/hitch rubric` prints them.

## Permissions

Every `<key>Access` option defaults to `follow`: `codexAccess`, `cursorAccess`, `ampAccess`, `piAccess`, and `devinAccess`. It is resolved at the start of **each run**, including SendMessage follow-ups. The chosen access and decider appear in the first live line and the run log; `access` is also added to the delegation log.

| Session mode under `follow` | Codex | Cursor | pi | Amp | Devin ACP |
| --- | --- | --- | --- | --- | --- |
| `plan` | read-only sandbox | Ask / read-only | read tools only | refuse | Ask / read-only; refuse non-read requests |
| `bypassPermissions` | workspace-write sandbox | full / `--force` | full | full | Code; allow each request once |
| `default` | workspace-write sandbox | ask for this run | ask for this run | ask for this run | Ask / read-only fallback; engine checks any requests |
| `acceptEdits` | workspace-write sandbox | ask for this run | ask for this run | ask for this run | Code / `accept-edits`; engine checks requests |
| `auto` | workspace-write sandbox | ask for this run | ask for this run | ask for this run | Ask / read-only fallback; engine checks requests |
| `dontAsk` | workspace-write sandbox | ask per run | ask per run | ask per run | Ask / read-only fallback; engine checks requests |

A per-run prompt offers **Allow this run**, **Allow hitch:<key> for this session**, **Run read-only instead** (where supported), or **Refuse**. If the question rejects or times out, Cursor and pi use read-only and Amp fails with advice to set `ampAccess`. A rejected, dismissed, failed or timed-out prompt never grants full access. Prompt failure falls back to read-only where supported; an explicit Refuse ends the turn.

Choosing **Allow hitch:<key> for this session** grants that harness full access for later CLI runs and follow-ups in this session; ACP offers **Allow all hitch:<key> requests this session** to replace later questions, while engine denials and plan-mode restrictions still apply. Grants live only in engine session state, survive a mod reload, and appear in `/hitch` status; they do not authorize other harnesses. Use `/hitch revoke` to revoke all grants or `/hitch revoke <key>` to revoke one; revocation affects future runs and requests, not an already-running CLI process.

Explicit `read-only`, `workspace-write`, or `full` is a standing settings decision and asks nobody. Unsupported levels fail clearly. **Plan mode always overrides settings with read-only, or refuses if unavailable.** Supported levels:

| Harness | read-only | workspace-write | full |
| --- | --- | --- | --- |
| Codex | real `--sandbox read-only` | real `--sandbox workspace-write` | unsupported (no danger-full-access) |
| Cursor | `--mode ask`, no `--force` | unsupported | `--force`; no sandbox |
| pi | `--tools read,grep,find,ls` | unsupported | every tool, no restriction flag |
| Amp | unsupported | unsupported | own default permissions, no hitch restriction |
| Devin | Ask mode; read-type requests only | Code; allow requests once | Code; allow requests once |

Cursor's Ask mode, pi's allowlist and Devin's modes are **not OS sandboxes**. Their live enforcement has not been re-tested in this change. Codex resume passes `sandbox_mode` through `-c` because resume has no `--sandbox` flag.

Devin ACP `follow` maps commands to `Bash`, files to `Read`/`Edit`/`Write`, and fetches to `WebFetch`, then queries `$.tool.check({ tool, input })`. Allows and denials are answered once; denials include the engine reason in the permission row. An engine ask goes directly to `$.ui.ask` with **Allow once / Allow all hitch:<key> requests this session / Refuse**, and unknown actions go straight to that question. Per-run questions also call `$.ui.ask` directly; hitch does not try to detect who can answer. A rejected, dismissed or timed-out question is recorded as “no answer”: ACP refuses, while CLI runs fall back to read-only where supported or fail. The ACP server still receives only one-time decisions; a hitch session grant never changes server settings. Checks have a 60-second deadline and questions a five-minute deadline. Errors and timeouts refuse; a late answer cannot authorize the action. The API cannot cancel an already-open question.

**Evidence/API limitations:** the supplied Devin fixture explicitly trims mode listings and its `session/new` response advertises none. No available evidence proves a mode that asks before both edits and commands. Consequently default/auto/dontAsk use the safe Ask/read-only fallback, not `accept-edits` or an invented mode. `acceptEdits` deliberately permits Devin's own workspace edits. Failure to set the protective mode ends the turn before sending its prompt. The older `devinTransport: cli-text` cannot ask per action: it uses the same per-run consent/read-only fallback as Cursor and pi (`auto` for read-only, `smart` after consent).

`$.tool.check` is a session query with **no agentId**, no classic PreToolUse hook and no classifier. The agent's recorded mode selects run access (missing metadata uses plan/read-only, never a different agent's most recent spawn mode), but the API does not permit supplying that agent's context to the query. `$.tool.judge` requires a real tool-call ID; hitch has none for a stand-in request, so it does not fabricate one. Auto-mode asks follow the person/refuse path. `$.ui.ask` is an AskUserQuestion tool call; a rejection from background/host policy is handled as no answer.

`<key>Sandbox` is **deprecated for one release** (the existing Codex, Cursor, pi and Devin options remain declared). When Access is unset or `follow`, a non-default legacy Sandbox value is honored. The old default `workspace-write` does not override `follow`; the legacy non-default `read-only` does. Explicit Access wins. Cursor and pi's former “workspace-write” was unrestricted and is now honestly named `full`.

## Model names

Each agent type is registered under its harness's own configured model name (`gpt-6-astra`, `swe-2-flash-high`, `openrouter/~deepseek/deepseek-flash-latest`, `cursor-auto`, `amp-medium`), so Claude Code's agent views and transcripts name what really ran. No Claude model runs these agents: if a step ever reached the Anthropic API it would fail on the unknown model name. If Claude Code refuses a name, that type falls back to registering under Haiku. The name is fixed when the session starts, so a call whose effort changes the model (Devin, Amp) still shows the configured one.

## Rows

Each action a harness takes is a row in its agent's transcript: a command with its output and exit code, a file change with its diff, a tool call, and for Devin a permission decision. Rows are calls of one display-only tool, `HitchLog`, which hitch answers itself with the action's real result; nothing is run again. Rows render as `Codex $ cat a.txt` with the output under them.

The harness's messages are the agent's text. The last step holds only the closing message, so the report the parent gets is clean. Live progress shows in the agent view while the harness works but is not kept in the transcript: reasoning, a command starting, `waiting on <model>… 12s`, `running: <command> · 95s`. A log of each agent's activity is written to the session's scratchpad.

## Delegation log

hitch appends one JSON line per finished harness turn to the delegation log. It holds no prompt or report text. The fields:

- `ts`, `session`, `agentId`;
- `harness`, `transport`, `model`, `effort`, `sandbox`, `access` (`{ level, decider }`, distinguishing `person` from `session grant`; older records used a level string);
- the Agent call's `description`;
- `promptChars` (the prompt's length only);
- `turn` (`first` or `follow-up`), `durationMs`, `rows`, `tokens` (the harness's own count);
- `outcome` (`done`, `failed`, `stopped`, `timeout`), `exitCode`, `exit`.

`/hitch log` prints, per harness and model: runs, median duration, total tokens, and failures.

## Limits

- **One display-only tool is visible elsewhere.** Rows need a tool the agent can call, and a mod can only add tools to the session's shared pool. hitch hides `HitchLog` from other agents with two hooks (`tool.offer`, `tool.describe`), but where Claude Code's managed security mod (`sec-default`) runs first, both are passed over. Every agent then lists `HitchLog` with the one-line description "Display-only log of a hitch agent. Never call." A call from any other agent is refused. It is one tool however many harnesses there are. On such a machine, set `hideRowTool` to off to stop Claude Code printing two "hook was skipped" lines per session.
- **Only Codex provides a filesystem sandbox.** See Permissions below for the other harnesses' tool restrictions and consent gates.
- **Auto mode shows a classifier warning on each report.** In Claude Code's auto permission mode a subagent's report is expected to come with a safety review. hitch answers the agent's steps itself, so where the report goes through the hand-back tool (as it does with `sec-default` seated) no review comes back, and Claude Code attaches the note "The server-side auto mode classifier was unavailable when reviewing this subagent's work." The note is accurate: nothing on Anthropic's side reviewed what the other harness did. hitch does not fake a review. Other modes show no note.
- **Early-access API.** hitch is built on Claude Code's function-hook plugin API, which is early access and changes between releases. Tested with Claude Code 2.1.329.
- **Model names.** Each agent type is registered under its harness's configured model name (see Model names). No Claude model runs these agents and no request is sent for their steps.
- **Reload.** A harness keeps running through a reload of hitch, and the next step reads on from where the last stopped. A row's result can be lost if the reload falls exactly between a step and its row.

## Adding a harness

See `hooks/harnesses/README.md`. In short: add a folder under `hooks/harnesses/` with the entry, its parser if it has one, a real recorded fixture, a test and a README. Add one line each to `hooks/harnesses/index.ts` and `hooks/harnesses/fixtures.ts`, and declare its options in `.claude-plugin/plugin.json`. The transports (`cli-jsonl`, `cli-text`, `acp`) are generic, so a harness that speaks one of them needs no new transport code. The contract test (`tests/contract.test.ts`) runs the same checks against every harness.

## Layout

```
hooks/
  register.tsx        wires the hooks up
  core/               the agent step loop, state, process supervisor, delegation log, helpers
  transports/         cli-jsonl, cli-text, acp (generic)
  harnesses/          one folder per harness, the table, the fixture table
skills/harness-delegation/SKILL.md
tests/                core and transport tests, the contract test, the test world
```

Run the checks with `claude plugin validate .` and `claude plugin test .`.
