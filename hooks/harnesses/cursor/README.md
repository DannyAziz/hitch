# Cursor (`hitch:cursor`)

Cursor's agent CLI (the `agent` binary), driven headless as
`agent -p --output-format stream-json` (transport `cli-jsonl`).

**Tested with:** agent CLI 2026.11.19-f005e9d on macOS, model `Auto` (the
`auto` default). The fixture is a real recording from that version: a first
turn that wrote `notes.txt` and ran `cat notes.txt`, and a `--resume`
follow-up in the same session.

Identifiers, timestamps and account-specific values in the fixture were replaced with synthetic placeholders.

## What works

- **New turns and follow-ups:** a new turn runs
  `agent -p --output-format stream-json --model <model> --force --trust <prompt>`
  in the working directory; the prompt is the positional argument (the CLI's
  verified form, so it is visible in `ps` — Codex's goes through a file).
  A follow-up (SendMessage) runs the same command with `--resume <session_id>`
  added, so Cursor keeps its own conversation.
- **Rows:** each completed tool call is a row —
  - `shellToolCall` as a command, with its real interleaved output (stdout,
    plus stderr when it isn't already in it) and exit code;
  - `editToolCall` as a file change, with the `diffString` the result carries
    (or the file content / message when there is no diff);
  - any other `*ToolCall` Cursor emits as a generic tool row with its JSON
    result (only the two above were recorded; the rest is unverified).
- **Report:** Cursor's assistant messages are the steps' text, and the last
  one is the report. The `result` event's `result` string is every assistant
  message joined together, so it is never used as the report.
- **Access:** see Permissions below. `--trust` is always passed.
- **Model:** `cursorModel` is passed to `--model` (default `auto`).
- **Effort:** Cursor encodes effort in model names, as the last word or the
  one before `-fast` (`gemini-4-neon-high`, `gpt-5.6-sol-xhigh-fast`). When
  `cursorModel` ends in such a tier (`low`, `medium`, `high`, `xhigh`,
  `max`), the Agent call's effort swaps it. Any other name (`auto`,
  `composer-2.5`, `gpt-5.5-extra-high`) is passed as set. Not every model
  has every tier: Cursor rejects a name it does not offer, and the run ends
  with its error (`agent models` lists the names). The swap is covered by
  tests on the argv only, not by a live run.
- **Usage:** the `result` event's token usage (`inputTokens`,
  `cacheReadTokens`, `outputTokens`) is shown in the agent row, `/hitch` and
  the delegation log. It is never reported as Claude usage.

## Quirks

- Cursor can start several tool calls before any completes (the recording
  shows both `started` events, then both `completed`). Each completed call
  is still its own row, in completion order; the live "running" line names
  the latest started call.
- `thinking` arrives as many small `delta` fragments and a bare `completed`.
  hitch joins the fragments per session and shows them as one live line when
  the block completes — never one line per fragment.
- `call_id`/`toolCallId` carry an embedded newline; they are kept as the
  actions' ids only. hitch does not match a `started` to its `completed` —
  the first finished action ends the step.

## Unverified / unsupported

- **`--mode ask` was not verified by a real run.** The mapping
  `read-only → --mode ask` (without `--force`) comes from the CLI's flags,
  not a recording; `--trust` is kept in that mode on the assumption that
  workspace trust is orthogonal to permission mode.
- **`--resume` flag placement** is assumed (before the prompt, after the
  other flags). The recorded follow-up proves `--resume <session_id>`
  continues the conversation, not where in argv it sat.
- **Other tool types** (`readToolCall`, `writeToolCall`, search, MCP, ...):
  handled generically — a row with the JSON result — because only
  `shellToolCall` and `editToolCall` were recorded.
- **Error shapes**: a `result` event with `is_error` or `subtype: "error"`
  (and a top-level `error` event) is handled; other failure shapes may only
  surface as the process exit.
- Cursor asking for approval: `-p --force` does not ask, so there are no
  approval rows. `--force` is Cursor's own policy, not a filesystem sandbox
  hitch controls.
- Images, and Cursor's interactive (TUI) mode.

## Permissions

`cursorAccess` defaults to `follow`: plan uses `--mode ask` without `--force`; bypass uses full (`--force`). Other modes require per-run consent for full access, offer read-only, or refuse. Without a person, use read-only. No workspace-write level is enforceable; neither level is an OS sandbox.

Explicit supported Access values are standing consent, except plan always requires read-only. The old Sandbox setting is deprecated; only a non-default value overrides follow. See the [main Permissions table](../../../README.md#permissions) for API limits, prompt deadlines, and the distinction between mode restrictions and sandboxes.
