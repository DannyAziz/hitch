---
name: harness-delegation
description: Rubric for handing work to another agent harness through hitch (subagent types hitch:codex, hitch:cursor, hitch:amp, hitch:pi, hitch:devin). Use when a self-contained task would gain from a different model's second opinion or review, when a well-specified build can go to cheaper labour, or when the user names Codex, Cursor, Amp, pi, Devin, GPT or another harness.
---

# Harness delegation

Other harnesses are colleagues with a different model behind them. They know only what the brief says, and what comes back is a claim until you have checked it.

## 1. Keep or hand off

Hand off when a brief can carry the whole task: the goal, the files, and a check that proves it done. Keep the task when it leans on this conversation: a design still being decided, the user's unstated preferences, or findings that would take longer to write down than to act on.

Done when you can say in one line why the task is self-contained, or you have kept it.

## 2. Pick the harness

The list of agent types is the source of truth. Each hitch agent's description says what the harness is, how its access works, whether it is the user's chosen reviewer or builder, and when the user wants delegation to happen. Only listed types exist: a harness the user turned off is absent.

| The task | Send it to |
| --- | --- |
| Second opinion, review, or debugging of work Claude did | The agent whose description says it is the user's chosen harness for second opinions and reviews. With none marked, ask the user which harness. Ask it for findings, and say in the brief that it must change nothing. |
| Well-specified build with checks that prove it | The agent whose description says it is the user's chosen harness for well-specified builds. With none marked, ask the user which harness. |
| The user names a harness or a model | That harness. For a model other than the one its description says it runs, start the prompt (or a SendMessage follow-up) with a line `model: <name>`, lowercase, using the harness's own name for it. It runs as named, whatever the effort. |
| Work that depends on this conversation | Claude (yourself, or a fork): only a fork carries the context. |

### Continue or start fresh

Every hitch harness keeps its conversation: SendMessage continues it, and a new Agent call starts an empty one.

- **Continue** when the next round builds on what that agent just did: fixing its own diff, answering its question, another pass at the same change.
- **Start fresh** for a new chunk whose brief stands alone, and for every review: a reviewer that wrote or watched the work is no second opinion.
- **Start fresh when the context is full.** Answers can end with a `[hitch] … context:` line. Past 60% full, or past 150k tokens where no window size is given, give the next round to a new agent with a brief that stands alone. A harness that reports no context line: start fresh after about five rounds.

Cost is part of the choice. State the expected cost to the user before a run on a paid plan that looks large.

## 3. Write the brief

A brief has these parts, in this order:

1. **Goal** in one sentence, and what the result is for.
2. **Where to work**: one folder, by absolute path. Use a staging copy when the real target is a live mod, sits outside the harness's writable area, or should be reviewed before it changes.
3. **What to read first**: the files that hold the pattern to follow.
4. **Requirements**, numbered, each one checkable.
5. **Checks** to run, and that they must pass.
6. **Limits**: what it may run, call and touch.
7. **Final answer**: files changed and what changed in each, the last lines of each check's output, and what it verified versus what it did not.

Done when someone with no access to this conversation could do the task from the brief alone.

## 4. While it runs

Run it in the background and work on something that touches different files. Its report arrives as a task notification.

## 5. Verify before accepting

1. Read the whole diff against the original.
2. Run the checks yourself, in the folder it worked in.
3. Compare its claims with what you found; note any that were wrong.
4. If something is off: continue the same agent with SendMessage; or fix a small thing yourself.
5. Install from staging only after steps 1 to 3 pass.

Done when the checks pass in your own run and you have read every changed line.

## 6. Tell the user

Say which harness and model did the work, what you verified yourself, what you changed after review, and the time and tokens it took.
