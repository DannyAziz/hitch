# Adding a harness

A harness is one folder here plus one line in the table. hitch derives the rest from the entry: the agent type `hitch:<key>`, the options, the per-agent state, the row label, the delegation log lines.

## The two-place edit

1. **The folder**, `hooks/harnesses/<key>/`:
   - `index.ts`: the entry (below).
   - `parse.ts`: the event parser, if the harness writes JSON events (`cli-jsonl`).
   - `fixture.ts`: real recorded output, as a `HarnessFixture` (see `fixtures.ts`). It is a `.ts` module, not a `.jsonl` file, because a plugin's tests may only import code files. Record it from a real run of the CLI and replace private paths (the fixtures here use `/work`), identifiers, timestamps and account-specific metadata with placeholders before publication. Include any extra recordings in `additional` so the privacy test checks them too.
   - `<key>.test.ts`: tests for this harness against its fixture.
   - `README.md`: the CLI version tested, what works, quirks, and what is unsupported.

   Then add one import and one line to `index.ts` (the table) and to `fixtures.ts` (the fixture table the contract test reads).

2. **The options**, in `.claude-plugin/plugin.json` `userConfig`: declare the ones the entry uses, named after its key: `<key>Enabled`, `<key>Path`, `<key>Model`, `<key>Access`, `<key>IdleTimeoutSec`, `<key>CommandTimeoutSec`, and `<key>Transport` if it offers more than one transport. An option left undeclared falls back to the entry's default, or to 300 s idle and 3600 s command.

`claude plugin test .` then runs the contract test against the new entry too (`tests/contract.test.ts`): a first turn yields the fixture's rows and closing report with no Claude request and no usage, closing a step mid-run stops the harness, and a follow-up is continued or refused as the entry declares.

Before publication, run `python3 tests/readmes-clean.py` as well as `claude plugin validate .` and `claude plugin test .`. The plugin test checks every recorded stream through `fixtures.ts`, including `additional` streams and rollout lines; the companion check reads every actual README because the plugin test sandbox cannot import filesystem APIs. Placeholder UUIDs use `00000000-0000-4000-8000-` followed by twelve digits, optionally prefixed by `T-`; other recorded identifiers retain their original prefixes and separators with fixture/zero-filled payloads. Timestamps use an ordered sequence beginning at `2000-01-01T00:00:00Z`, preserving repeated values and each field's representation; durations are unchanged.

## The entry

```ts
export const myHarness: HarnessAdapter = {
  key: 'mine',                // agent type hitch:mine, options mineModel, ...
  label: 'Mine',              // shown on its rows and in its agent row
  description: '...',         // the line the model reads in its list of agent types
  defaultModel: '...',        // used when mineModel is unset; always passed to the CLI
  agentModel: m => `mine-${m}`, // optional: the name the agent is registered under; default is the model as is
  models: { argv: ['mine', 'models'], parse }, // optional: lists the model names the CLI accepts; hitch refuses a run of any other before launch
  accessLevels: ['read-only', 'workspace-write'], // least to most permissive
  workspaceSandbox: true,     // only for a real workspace-write sandbox
  defaultSandbox: 'workspace-write', // legacy fallback metadata only
  sandboxes: ['read-only', 'workspace-write'], // deprecated legacy values
  transports: { ... },        // one or more; the first is the default
}
```

`transports` holds one or more of these. The code for each lives in `hooks/transports/` and knows nothing about any particular CLI.

- **`cli-jsonl`** `{ start(spec), resume?(spec), parse(line, memo), detail?(action, ctx) }`: a CLI that takes the prompt on stdin or argv, writes one JSON event per stdout line, and exits.
  - `start` and `resume` return `{ argv, input? }`; `input` goes to stdin, so keep the prompt off argv where the CLI allows. `resume` gets `spec.sessionId`; leave it out if the CLI can't continue a conversation, and follow-ups are answered "cannot be continued".
  - `parse(line: string, memo: ParserMemo): HarnessEvent | HarnessEvent[]` maps one trimmed line to one event or an ordered array of events (`core/types.ts`). Each action becomes its own row, in order. `ParserMemo` (`transports/cli-jsonl.ts`) is a mutable plain JSON-serialisable object belonging to one run (one harness turn of one agent). It starts empty and is passed to every parse call for that run. Keep all parser state in it, never in module-level variables; use plain objects instead of Maps. The memo and unhandled events are saved on `ActiveRun`, alongside the consumed-line position, so later steps and mod reloads continue the same run. Event fields:
    - `sessionId` when the conversation id appears;
    - `message` for the agent's text;
    - `started` when a command or tool begins (the command timeout runs until it ends);
    - `action` when one finishes (each action becomes a row, with its real output);
    - `usage`, `error`, and `line` for a short live progress line.
  - `detail` optionally returns better text for an action's row; Codex uses it to read a file change's diff.
- **`cli-text`** `{ start(spec) }`: a CLI whose whole stdout is the report. Every line is shown live; there are no rows and no follow-ups.
- **`acp`** `{ argv(spec), mode?(sandbox), permit?(call, sandbox) }`: an Agent Client Protocol server over stdio.
  - `argv` starts the server.
  - `mode` names the session mode for a sandbox value (`session/set_mode`).
  - `permit` decides explicit access requests only. Under `follow`, the transport defers the request to core/access.ts for the engine check and one-time person prompt. Never answer “always”. Protective mode failures stop before the prompt.

`spec` is `{ prompt, model, effort?, sandbox? }`. `model` is the `<key>Model` option, or the name from a `model: <name>` first line of the prompt (core takes that line out before `prompt` reaches you). `effort` is the Agent call's level (`low` … `max`): map it to the CLI's own levels yourself.

## What every harness gets without code

- **Native agent:** it shows in the agent list, can be stopped, sends its notification, and takes SendMessage (a `cli-text` harness cannot be continued: each run is a fresh session).
- **Rows:** each action is a row of the shared `HitchLog` tool, labelled with your harness's name (`cli-jsonl` and `acp` only: a `cli-text` harness has no actions to show).
- **Timeouts:** an idle timeout that counts only while the harness waits on its model, and a command timeout for one running command.
- **Stop:** the process tree is killed when the agent is stopped, the session ends, or Claude Code goes away. For ACP, `session/cancel` is sent first.
- **Delegation log:** one line in it per turn.

## Access contract

Every entry declares `accessLevels` in ascending order of permission and describes its real access behavior in the model-facing description. An unsupported explicit value fails, not silently upgrades. `workspaceSandbox: true` is reserved for a real workspace-write sandbox (currently Codex alone). `LaunchSpec.sandbox` carries the resolved access level to existing argv builders; it is an internal compatibility field, not proof of a sandbox. ACP `follow` is the deferred engine-check policy. CLI runs receive only supported concrete levels. Plan always forces read-only or fails; bypass selects the final declared level. Core decides once per run, never once per agent.

Document each level's exact flags, whether it is an OS sandbox, and unverified enforcement. Keep `defaultSandbox`/`sandboxes` only to recognize a non-default deprecated setting. See the top-level Permissions table and API limitations, particularly Devin's trimmed mode-list evidence and session-scoped queries.

Permission questions call `$.ui.ask` directly; hitch has no `tool.check` hook or approver detection. ACP checks mapped actions with `$.tool.check` and asks on an `ask` verdict; unmapped actions ask directly. A rejected or timed-out question is “no answer”: refuse the ACP action, or use CLI read-only where supported and otherwise fail.
