# Devin (`hitch:devin`)

Cognition's Devin CLI, driven through its Agent Client Protocol server, `devin acp` (transport `acp`, the default). The older print mode, `devin -p`, is still reachable with `devinTransport: cli-text`.

**Tested with:** devin 3000.14.30821 on macOS, model `swe-2-flash-medium` for recordings and the previous max model live (the new high default is not live-tested). The fixture is a real recording from that version.

Identifiers, timestamps and account-specific values in the fixture were replaced with synthetic placeholders. The previously trimmed server notifications and mode/config/command listings remain trimmed; protocol metadata keys and usage are retained.

## What works (ACP)

- **The server:** each turn starts `devin acp --process-model in-process --model <model>`. It runs in-process, so no shared background daemon outlives it.
- **Rows:** each tool call is a row with its real content (commands with output and exit code, edits with their diff), and so is each permission decision.
- **Report:** Devin's messages are the steps' text, and the closing message is the report.
- **Follow-ups:** a SendMessage follow-up continues the same Devin session with `session/load` in a new server process; Devin advertises `loadSession`. The history Devin replays on load is ignored.
- **Access:** see Permissions below.
- **Never "always":** hitch never chooses an "always" option, since that would change Devin's own settings.
- **Stop:** hitch sends `session/cancel`; Devin answers `stopReason: cancelled` and ends the command it was running. The supervisor is stopped 3 s later whatever happens.
- **Usage:** usage is summed over the turn's model requests (`usage_update`). The prompt response's own usage covers only the last request.
- **Effort:** for the free `swe-2(-flash)-(medium|high|max)` models, the Agent call's effort picks the suffix of `devinModel`, when `devin models` lists the result; else the name runs as set. A name a `model:` line gave runs as named. Other model names are passed as set.

## Quirks

- Each turn, Devin connects to the MCP servers in your Devin configuration, which takes about 2 s and may log connection failures.
- Devin ran Claude Code hooks it found in `~/.claude` (a Stop hook was seen). These show as progress lines, not rows.
- Devin sends many `_cognition.ai/*` notifications; hitch ignores them.
- It reports each request's usage twice, the second copy tagged as a subagent's; hitch counts one.

## cli-text (`devinTransport: cli-text`)

`devin --model <model> --permission-mode smart|auto --respect-workspace-trust false -p <prompt>`. Stdout is Devin's running commentary and final answer as plain text, with sentences sometimes run together. There are no rows, and a follow-up is answered "cannot be continued".

## Unsupported

- **Not a filesystem sandbox:** with `workspace-write`, a command Devin asks to run is allowed with your user's permissions. Devin's research-preview `--sandbox` / `DEVIN_SANDBOX` was not tried.
- Devin Cloud (`devin acp --cloud`), images, and the client-side fs or terminal capabilities: hitch advertises neither and answers such requests "method not found".

## Permissions

`devinAccess` defaults to `follow`; the default model is `swe-2-flash-high`. Given a `--model` it does not know, `devin acp` logs a warning on stderr and runs the configured or default model in its place (seen with devin 3000.14: a made-up name ran Fusion). hitch therefore lists `devin models` (about 0.5s) once per instance, again when a name is missing, and refuses a run whose model is not a listed id, alias or family id (case aside), naming the nearest ones. The name an effort swap produces is checked too. A listing that fails or parses empty does not block the run, and is not retried for five minutes. Plan uses Ask/read-only; bypass uses Code and allows requests once; acceptEdits uses Code with engine checks for requests. Default/auto/dontAsk safely use Ask/read-only because this fixture trimmed all mode advertisements and does not prove a mode that asks before edits and commands. Every received request under follow goes through the engine check/person/refuse path. Explicit read-only and workspace-write retain the old semantics; full uses Code. These modes are not filesystem sandboxes. cli-text instead needs per-run full-access consent or uses read-only; it cannot ask per action.

Explicit supported Access values are standing consent, except plan always requires read-only. The old Sandbox setting is deprecated; only a non-default value overrides follow. See the [main Permissions table](../../../README.md#permissions) for API limits, prompt deadlines, and the distinction between mode restrictions and sandboxes.
