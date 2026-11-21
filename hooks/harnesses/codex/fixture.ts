// Real `codex exec --json` output (codex-cli 0.167.0, model gpt-6-astra),
// recorded with identifiers, timestamps and private values replaced; paths use /work. A .ts module, not a .jsonl file: a plugin's tests may
// only import code files.
//
// FIRST: "Change the word hello to goodbye in a.txt using your patch tool,
// then run `cat a.txt`, then reply done": an opening message, a command
// (cat a.txt -> hello), a file change, a command (cat a.txt -> goodbye),
// the closing message "done". FOLLOW_UP: a later turn ("run sleep 3, then
// reply done"): one command, then "done". ROLLOUT_FILE_CHANGE: the line
// Codex's rollout file holds for FIRST's file change (where the diff is).

import type { HarnessFixture } from '../fixtures'

export const FIRST: string[] = [
  "{\"type\":\"thread.started\",\"thread_id\":\"00000000-0000-4000-8000-000000000001\"}",
  "{\"type\":\"turn.started\"}",
  "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"I’ll patch `a.txt`, then run `cat a.txt`.\\n\"}}",
  "{\"type\":\"item.started\",\"item\":{\"id\":\"item_1\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'cat a.txt'\",\"aggregated_output\":\"\",\"exit_code\":null,\"status\":\"in_progress\"}}",
  "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'cat a.txt'\",\"aggregated_output\":\"hello\\n\",\"exit_code\":0,\"status\":\"completed\"}}",
  "{\"type\":\"item.started\",\"item\":{\"id\":\"item_2\",\"type\":\"file_change\",\"changes\":[{\"path\":\"/work/a.txt\",\"kind\":\"update\"}],\"status\":\"in_progress\"}}",
  "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_2\",\"type\":\"file_change\",\"changes\":[{\"path\":\"/work/a.txt\",\"kind\":\"update\"}],\"status\":\"completed\"}}",
  "{\"type\":\"item.started\",\"item\":{\"id\":\"item_3\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'cat a.txt'\",\"aggregated_output\":\"\",\"exit_code\":null,\"status\":\"in_progress\"}}",
  "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_3\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'cat a.txt'\",\"aggregated_output\":\"goodbye\\n\",\"exit_code\":0,\"status\":\"completed\"}}",
  "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_4\",\"type\":\"agent_message\",\"text\":\"done\"}}",
  "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":75797,\"cached_input_tokens\":69504,\"cache_write_input_tokens\":0,\"output_tokens\":179,\"reasoning_output_tokens\":0}}"
]

export const FOLLOW_UP: string[] = [
  "{\"type\":\"thread.started\",\"thread_id\":\"00000000-0000-4000-8000-000000000002\"}",
  "{\"type\":\"turn.started\"}",
  "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"I’ll run `sleep 3` now.\"}}",
  "{\"type\":\"item.started\",\"item\":{\"id\":\"item_1\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'sleep 3'\",\"aggregated_output\":\"\",\"exit_code\":null,\"status\":\"in_progress\"}}",
  "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'sleep 3'\",\"aggregated_output\":\"\",\"exit_code\":0,\"status\":\"completed\"}}",
  "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_2\",\"type\":\"agent_message\",\"text\":\"done\"}}",
  "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":36969,\"cached_input_tokens\":18304,\"cache_write_input_tokens\":0,\"output_tokens\":43,\"reasoning_output_tokens\":0}}"
]

export const ROLLOUT_FILE_CHANGE = "{\"timestamp\":\"2000-01-01T00:00:01.000Z\",\"ordinal\":22,\"type\":\"event_msg\",\"payload\":{\"type\":\"item_completed\",\"thread_id\":\"00000000-0000-4000-8000-000000000001\",\"turn_id\":\"00000000-0000-4000-8000-000000000003\",\"item\":{\"type\":\"FileChange\",\"id\":\"exec-00000000-0000-4000-8000-000000000004\",\"changes\":{\"/work/a.txt\":{\"type\":\"update\",\"unified_diff\":\"@@ -1 +1 @@\\n-hello\\n+goodbye\\n\",\"move_path\":null}},\"status\":\"completed\",\"stdout\":\"Success. Updated the following files:\\nM /work/a.txt\\n\",\"stderr\":\"\"},\"started_at_ms\":946684800000,\"completed_at_ms\":946684801000}}"

export const THREAD = '00000000-0000-4000-8000-000000000001'
export const FILE = '/work/a.txt'

export const fixture: HarnessFixture = {
  version: 'codex-cli 0.167.0',
  first: FIRST,
  rows: 3,
  closing: 'done',
  followUp: FOLLOW_UP,
  followUpClosing: 'done',
  // The rollout grep the file-change row runs.
  shell: { FileChange: ROLLOUT_FILE_CHANGE },
}
