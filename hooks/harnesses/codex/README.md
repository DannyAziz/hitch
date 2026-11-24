# Codex (`hitch:codex`)

OpenAI's Codex CLI, driven as `codex exec --json` (transport `cli-jsonl`).

**Tested with:** codex-cli 0.167.0 on macOS, model `gpt-6-astra`. The fixture is a real recording from that version.

Identifiers, timestamps and account-specific values in the fixture were replaced with synthetic placeholders.

## What works

- **New turns and follow-ups:** a new turn runs `codex exec -m <model> --json --sandbox <sandbox> -`, with the prompt on stdin. A follow-up (SendMessage) runs `codex exec resume <thread> -`, so Codex keeps its own conversation.
- **Rows:**
  - each command, with its output and exit code;
  - each file change, with its diff;
  - each MCP tool call, with its result;
  - each web search.
- **Report:** Codex's messages are the steps' text, and the closing message is the report.
- **Effort:** the Agent call's effort maps to `model_reasoning_effort` as is. `max` is offered by the GPT-6 and 5.6 models (`~/.codex/models_cache.json`); `gpt-5.5` stops at `xhigh` and errors on `max`.
- **Access:** see Permissions below.
- **Usage:** Codex's token usage for the turn is shown in the agent row, `/hitch` and the delegation log. It is never reported as Claude usage.

## Quirks

- `-m` is always passed. A default model set in `~/.codex/config.toml` can be one the login is refused for, so hitch never relies on it.
- Codex runs each command in a process group of its own and does not kill them when it is killed. hitch's supervisor walks the whole process tree on a stop, so `sleep 90` and the like go too.
- The `--json` `file_change` event names the files but carries no diff. hitch reads the diff from Codex's rollout file (`$CODEX_HOME` or `~/.codex`, `sessions/*/*/*/rollout-*-<thread>.jsonl`). That is Codex's internal format: if it changes, the row falls back to the file list.
- A reply that uses no tools still costs Codex about 18k tokens of context.
- One model call was seen to hang with no output; the idle timeout (`codexIdleTimeoutSec`, default 300 s, counted only while no command runs) ends such a turn.

## Unsupported

- Codex asking for approval: `codex exec` does not ask, so there are no approval rows.
- Images, and Codex's interactive (TUI) mode.

## Permissions

`codexAccess` defaults to `follow`: plan uses the real read-only sandbox; other modes use the real workspace-write sandbox. Explicit supported levels ask nobody; full is unsupported. Resume passes `-c sandbox_mode=...`.

Explicit supported Access values are standing consent, except plan always requires read-only. The old Sandbox setting is deprecated; only a non-default value overrides follow. See the [main Permissions table](../../../README.md#permissions) for API limits, prompt deadlines, and the distinction between mode restrictions and sandboxes.
