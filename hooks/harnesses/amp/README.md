# Amp (`hitch:amp`)

Amp execute mode using the `cli-jsonl` transport.

**Tested evidence:** real first-run and follow-up recordings supplied for testing (`recordings/amp4.jsonl` and `amp5.jsonl`). The CLI version was not captured. The fixture retains every recorded line in order, with private working folders replaced with `/work`. No live Amp command was run while adding this harness.

Identifiers, timestamps and account-specific values in the fixture were replaced with synthetic placeholders. The init tool inventory was reduced to `create_file` and `shell_command`, and `mcp_servers` is empty.

## What works

- Parser state belongs to one run and is persisted across steps and mod reloads; interleaved runs are isolated.

- Start: `amp -x "<PROMPT>" --stream-json --no-archive-after-execute -m <mode>`.
- Follow-up: `amp threads continue <THREAD_ID> -x "<MESSAGE>" --stream-json --no-archive-after-execute -m <mode>`. The init event's `session_id` is the thread id.
- Prompts go on argv, as verified for this CLI. The invocation supplies no stdin input. The existing supervisor opens an empty input file, giving immediate EOF.
- Multiple tool uses or results on a line yield separate events and rows in order. Covered synthetically using recorded shapes; live concurrent tools and nested subagent streams remain unverified.
- A tool use starts the command timer; its matching tool result produces the row. `create_file` shows the path and actual result; `shell_command` shows the command, actual output and exit code. Other individual tools have a generic result row, but were not recorded or live-tested.
- Assistant text supplies the closing report. The success result repeats it and is ignored to avoid duplicate text.
- Assistant usage is summed for the turn. Input includes uncached, cache creation, and cache read tokens; cached is the cache read subtotal. Follow-ups reset the totals.
- `ampModel` (default `medium`) is what `-m` gets, always passed: an agent mode (`low`, `medium`, `high`, `ultra`, and others Amp offers) or a model as `provider/name` (`openai/gpt-6-astra`). Agent effort takes a configured mode's place: low/medium/high map directly, xhigh/max map to ultra. A `provider/name` model keeps its name and gets the effort as `--effort`. A mode a `model:` line named runs as named. Amp matches modes case-insensitively and exits 1 on one it does not know, listing every valid value. This mapping is covered by argv tests; the supplied recordings only show medium.
- `ampIdleTimeoutSec` defaults to 300 seconds; `ampCommandTimeoutSec` defaults to 3600 seconds.

## Permissions and quirks

Once authorized, Amp runs with its own default permissions; hitch cannot restrict its actions. See Permissions below.

`--no-archive-after-execute` is always passed: otherwise the first run archives the thread and a follow-up cannot continue it. Leaving an empty stdin pipe open causes Amp's "Timeout while reading from stdin"; the supervisor's empty file avoids that.

Parser tests cover the recorded two actions, closing messages, thread id, usage, interleaved threads, errors, and argv. The shared contract exercises rows, stopping, and follow-ups with recorded output; it does not launch Amp.

## Unsupported or unverified

- Live permissions, approval prompts, cancellation of an actual Amp process tree, and modes other than the recorded medium were not tested here.
- Thinking blocks, images, and interactive mode are unsupported. `--stream-json-thinking` is not passed.
- Error-result handling is tested synthetically; no error result appears in the supplied recordings.

## Permissions

`ampAccess` defaults to `follow`. Amp has full access only: plan refuses, bypass runs, and all other modes require per-run consent. Without a person it fails and names ampAccess as the explicit opt-in. No filesystem sandbox is provided.

Explicit supported Access values are standing consent, except plan always requires read-only. The old Sandbox setting is deprecated; only a non-default value overrides follow. See the [main Permissions table](../../../README.md#permissions) for API limits, prompt deadlines, and the distinction between mode restrictions and sandboxes.
