// Real Amp recordings amp4/amp5; identifiers and private values use placeholders.
// Paths use /work; init tools are reduced to the two used, with no MCP servers.
// CLI version was not captured. See README.md for sanitization details.
import type { HarnessFixture } from '../fixtures'

export const FIRST: string[] = [
  "{\"type\":\"system\",\"subtype\":\"init\",\"cwd\":\"/work\",\"session_id\":\"T-00000000-0000-4000-8000-000000000010\",\"tools\":[\"create_file\",\"shell_command\"],\"mcp_servers\":[],\"agent_mode\":\"medium\"}",
  "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Create a file notes.txt in the current directory containing the single line: alpha. Then run the shell command: cat notes.txt. Then reply with the single word: done\"}]},\"parent_tool_use_id\":null,\"session_id\":\"T-00000000-0000-4000-8000-000000000010\"}",
  "{\"type\":\"assistant\",\"message\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"TU-fixture000000000000001\",\"name\":\"create_file\",\"input\":{\"path\":\"/work/notes.txt\",\"content\":\"alpha\\n\"}}],\"stop_reason\":\"tool_use\",\"usage\":{\"input_tokens\":4,\"cache_creation_input_tokens\":58254,\"cache_read_input_tokens\":0,\"output_tokens\":159,\"service_tier\":\"standard\"}},\"parent_tool_use_id\":null,\"session_id\":\"T-00000000-0000-4000-8000-000000000010\"}",
  "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"TU-fixture000000000000001\",\"content\":\"Successfully created file /work/notes.txt\",\"is_error\":false}]},\"parent_tool_use_id\":null,\"session_id\":\"T-00000000-0000-4000-8000-000000000010\"}",
  "{\"type\":\"assistant\",\"message\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"TU-fixture000000000000002\",\"name\":\"shell_command\",\"input\":{\"command\":\"cat notes.txt\",\"workdir\":\"/work\"}}],\"stop_reason\":\"tool_use\",\"usage\":{\"input_tokens\":2,\"cache_creation_input_tokens\":261,\"cache_read_input_tokens\":58254,\"output_tokens\":159,\"service_tier\":\"standard\"}},\"parent_tool_use_id\":null,\"session_id\":\"T-00000000-0000-4000-8000-000000000010\"}",
  "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"TU-fixture000000000000002\",\"content\":\"{\\\"output\\\":\\\"alpha\\\\n\\\",\\\"exitCode\\\":0}\",\"is_error\":false}]},\"parent_tool_use_id\":null,\"session_id\":\"T-00000000-0000-4000-8000-000000000010\"}",
  "{\"type\":\"assistant\",\"message\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"done\"}],\"stop_reason\":\"end_turn\",\"usage\":{\"input_tokens\":2,\"cache_creation_input_tokens\":188,\"cache_read_input_tokens\":58515,\"output_tokens\":3,\"service_tier\":\"standard\"}},\"parent_tool_use_id\":null,\"session_id\":\"T-00000000-0000-4000-8000-000000000010\"}",
  "{\"type\":\"result\",\"subtype\":\"success\",\"duration_ms\":8717,\"is_error\":false,\"num_turns\":3,\"result\":\"done\",\"session_id\":\"T-00000000-0000-4000-8000-000000000010\"}"
]

export const FOLLOW_UP: string[] = [
  "{\"type\":\"system\",\"subtype\":\"init\",\"cwd\":\"/work\",\"session_id\":\"T-00000000-0000-4000-8000-000000000010\",\"tools\":[\"create_file\",\"shell_command\"],\"mcp_servers\":[],\"agent_mode\":\"medium\"}",
  "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Which file did you create? Reply with just its name. Do not run any commands.\"}]},\"parent_tool_use_id\":null,\"session_id\":\"T-00000000-0000-4000-8000-000000000010\"}",
  "{\"type\":\"assistant\",\"message\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"notes.txt\"}],\"stop_reason\":\"end_turn\",\"usage\":{\"input_tokens\":4,\"cache_creation_input_tokens\":1435,\"cache_read_input_tokens\":57491,\"output_tokens\":7,\"service_tier\":\"standard\"}},\"parent_tool_use_id\":null,\"session_id\":\"T-00000000-0000-4000-8000-000000000010\"}",
  "{\"type\":\"result\",\"subtype\":\"success\",\"duration_ms\":2283,\"is_error\":false,\"num_turns\":1,\"result\":\"notes.txt\",\"session_id\":\"T-00000000-0000-4000-8000-000000000010\"}"
]

export const THREAD = 'T-00000000-0000-4000-8000-000000000010'
export const FILE = '/work/notes.txt'

export const fixture: HarnessFixture = {
  version: 'Amp (recording; version unknown)',
  first: FIRST, rows: 2, closing: 'done',
  followUp: FOLLOW_UP, followUpClosing: 'notes.txt',
}
