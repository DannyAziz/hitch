# pi (`hitch:pi`)

pi print mode using the `cli-jsonl` transport.

**Tested evidence:** supplied real pi 1.2.0 recordings: `recordings/pi-first.jsonl`, `pi-followup.jsonl`, and `pi-error.jsonl`. No live pi command was run while adding this harness.

Identifiers, timestamps and account-specific values in the fixture were replaced with synthetic placeholders. System sections, installed tool/extension schemas and repeated `agent_end` messages were shortened to neutral placeholders.

## What works

- Parser state belongs to one run and is persisted across steps and mod reloads; interleaved runs are isolated.

- Start: `pi -p --mode json --provider <PROVIDER> --model <MODEL> "<PROMPT>"`.
- Follow-up: the same command with `--session <SESSION_ID>` before the prompt. The opening `session.id` identifies the conversation; the recorded follow-up retains it.
- `piModel` defaults to `openrouter/~deepseek/deepseek-flash-latest`. Split only at the first slash: provider `openrouter`, model `~deepseek/deepseek-flash-latest`. A missing provider or model is rejected.
- Prompt on argv, no stdin input. The shared supervisor supplies an empty input file and immediate EOF. Leaving stdin open makes pi wait forever.
- Tool execution starts report the bash command or write/edit/read path and start the command timer. Execution ends yield one row with the actual result text and `isError`. Bash also retains the recorded structured exit code. Write/edit rows identify the operation and path; write may overwrite an existing file, so it is not labelled as a guaranteed creation. Other tools receive generic rows.
- Only assistant `message_end` emits text and usage. Deltas, toolResult messages, system messages, repeated `turn_end` messages and `agent_end` do not duplicate output. Usage accumulates input + cacheRead + cacheWrite as total input, cacheRead as cached, and output separately. Each session header resets the turn totals, including follow-ups. Cost and other usage fields have no counterpart in hitch's usage type.
- `message_end` and `turn_end` with `stopReason: "error"` surface `errorMessage`. The recorded unsupported-model failure exits zero, so process status alone cannot detect it.
- Idle timeout defaults to 300 seconds (`piIdleTimeoutSec`); per-command timeout to 3600 seconds (`piCommandTimeoutSec`).

## Permissions and unverified options

`full` is **not a sandbox**. pi has no permission system and runs every tool; no restriction flag is passed. `read-only` passes `--tools read,grep,find,ls`, a tool allowlist, not an OS filesystem sandbox. This mapping is covered by argv tests but **not verified by a real run**.

Agent effort low, medium, high, xhigh and max maps directly to `--thinking <level>`, except for a model a `model:` line named with pi's own `:<level>` suffix, which wins. A model with no `provider/` is refused before launch, saying so. pi also offers off and minimal, which hitch's Agent effort type does not expose. Explicit thinking flags are covered by argv tests but **not verified by a real run**.

The supplied recordings used `--no-context-files`. The harness deliberately omits it so project context files load normally; that context-loading behavior was not live-tested here.

## Fixture shortening

All three recordings retain every line in its original order. Private working-directory paths use `/work`. System message section strings use `[system section omitted]`, and `toolsAdded` uses one neutral tool-schema placeholder instead of the installed tools and extension descriptions. Each `agent_end.messages` array uses `["[repeated messages omitted]"]` instead of the repeated conversation and system context. Other recorded text, tool inputs and outputs, usage and durations are retained. The error stream is exported as `ERROR` and included in the fixture table's `additional` recordings for the privacy check.

## Limits

- Read/edit and generic tool handling are synthetic or unverified; only write and bash were recorded. Images, thinking content, interactive mode and nested agent streams are unsupported. Concurrent tools, retries and live cancellation of a pi process tree were not verified.
- Tests replay recordings and exercise the shared contract (rows, closing report, stopping, follow-up, no Claude request/usage). They do not launch pi or verify provider authentication, live permissions or model availability.

## Permissions

`piAccess` defaults to `follow`: plan uses `--tools read,grep,find,ls`; bypass uses full (no restriction flag). Other modes ask per run for full, offer read-only, or refuse. Without a person, use read-only. There is no workspace-write sandbox.

Explicit supported Access values are standing consent, except plan always requires read-only. The old Sandbox setting is deprecated; only a non-default value overrides follow. See the [main Permissions table](../../../README.md#permissions) for API limits, prompt deadlines, and the distinction between mode restrictions and sandboxes.
