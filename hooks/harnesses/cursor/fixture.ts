// Real `agent -p --output-format stream-json` output (Cursor agent CLI
// 2026.11.19-f005e9d, model Auto), with identifiers, timestamps and key source
// replaced by placeholders; paths use /work. A .ts module, not a .jsonl file: a plugin's tests
// may only import code files.
//
// FIRST: "Create a file notes.txt in the current directory containing the
// single line: alpha. Then run the shell command: cat notes.txt. Then reply
// with the single word: done" — init, the echoed prompt, thinking deltas, an
// edit tool call and a shell tool call (both started before either
// completed), the closing "done", and the result with usage. FOLLOW_UP: a
// later turn in the same session ("Which file did you create? ..."), run
// with --resume <session_id>: thinking, "notes.txt", result.

import type { HarnessFixture } from '../fixtures'

export const FIRST: string[] = [
  "{\"type\":\"system\",\"subtype\":\"init\",\"apiKeySource\":\"fixture\",\"cwd\":\"/work\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"model\":\"Auto\",\"permissionMode\":\"default\"}",
  "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Create a file notes.txt in the current directory containing the single line: alpha. Then run the shell command: cat notes.txt. Then reply with the single word: done\"}]},\"session_id\":\"00000000-0000-4000-8000-000000000005\"}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\"The\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684811000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" user\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684812000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" wants\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684813000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" me\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684814000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" to:\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684815000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\"\\n1. Create\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684816000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" a file\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684817000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" notes.tx\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684818000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\"t with the single line \\\"alpha\\\"\\n\\nThen run cat notes.txt and reply with \\\"done\\\".\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684819000}",
  "{\"type\":\"thinking\",\"subtype\":\"completed\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684820000}",
  "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Creating `notes.txt`, then running `cat notes.txt`.\"}]},\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"model_call_id\":\"00000000-0000-4000-8000-000000000006-0-fxtr\",\"timestamp_ms\":946684822000}",
  "{\"type\":\"tool_call\",\"subtype\":\"started\",\"call_id\":\"call-00000000-0000-4000-8000-000000000007-0\\nfc_00000000-0000-4000-8000-000000000008_0\",\"tool_call\":{\"editToolCall\":{\"args\":{\"path\":\"/work/notes.txt\",\"streamContent\":\"alpha\\n\"}},\"hookAdditionalContexts\":[],\"toolCallId\":\"call-00000000-0000-4000-8000-000000000007-0\\nfc_00000000-0000-4000-8000-000000000008_0\",\"startedAtMs\":\"946684821000\"},\"model_call_id\":\"00000000-0000-4000-8000-000000000006-0-fxtr\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684823000}",
  "{\"type\":\"tool_call\",\"subtype\":\"started\",\"call_id\":\"call-00000000-0000-4000-8000-000000000007-1\\nfc_00000000-0000-4000-8000-000000000008_1\",\"tool_call\":{\"shellToolCall\":{\"args\":{\"command\":\"cat notes.txt\",\"workingDirectory\":\"\",\"timeout\":30000,\"toolCallId\":\"call-00000000-0000-4000-8000-000000000007-1\\nfc_00000000-0000-4000-8000-000000000008_1\",\"simpleCommands\":[\"cat\"],\"hasInputRedirect\":false,\"hasOutputRedirect\":false,\"parsingResult\":{\"parsingFailed\":false,\"executableCommands\":[{\"name\":\"cat\",\"args\":[{\"type\":\"word\",\"value\":\"notes.txt\"}],\"fullText\":\"cat notes.txt\"}],\"hasRedirects\":false,\"hasCommandSubstitution\":false,\"redirects\":[]},\"fileOutputThresholdBytes\":\"40000\",\"isBackground\":false,\"skipApproval\":false,\"timeoutBehavior\":\"TIMEOUT_BEHAVIOR_BACKGROUND\",\"hardTimeout\":86400000,\"description\":\"Display notes.txt contents\",\"closeStdin\":true,\"conversationId\":\"00000000-0000-4000-8000-000000000005\",\"adminCommandDenylist\":[],\"requestId\":\"00000000-0000-4000-8000-000000000006\",\"smartModeClassifierAllowed\":false},\"description\":\"Display notes.txt contents\"},\"hookAdditionalContexts\":[],\"toolCallId\":\"call-00000000-0000-4000-8000-000000000007-1\\nfc_00000000-0000-4000-8000-000000000008_1\",\"startedAtMs\":\"946684824000\"},\"model_call_id\":\"00000000-0000-4000-8000-000000000006-0-fxtr\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684825000}",
  "{\"type\":\"tool_call\",\"subtype\":\"completed\",\"call_id\":\"call-00000000-0000-4000-8000-000000000007-0\\nfc_00000000-0000-4000-8000-000000000008_0\",\"tool_call\":{\"editToolCall\":{\"args\":{\"path\":\"/work/notes.txt\",\"streamContent\":\"alpha\\n\"},\"result\":{\"success\":{\"path\":\"/work/notes.txt\",\"linesAdded\":1,\"linesRemoved\":0,\"diffString\":\"--- /dev/null\\n+++ b//work/notes.txt\\n@@ -1,0 +1 @@\\n+alpha\",\"afterFullFileContent\":\"alpha\\n\",\"message\":\"Wrote contents to /work/notes.txt\"}}},\"hookAdditionalContexts\":[],\"toolCallId\":\"call-00000000-0000-4000-8000-000000000007-0\\nfc_00000000-0000-4000-8000-000000000008_0\",\"startedAtMs\":\"946684821000\",\"completedAtMs\":\"946684826000\"},\"model_call_id\":\"00000000-0000-4000-8000-000000000006-0-fxtr\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684827000}",
  "{\"type\":\"tool_call\",\"subtype\":\"completed\",\"call_id\":\"call-00000000-0000-4000-8000-000000000007-1\\nfc_00000000-0000-4000-8000-000000000008_1\",\"tool_call\":{\"shellToolCall\":{\"args\":{\"command\":\"cat notes.txt\",\"workingDirectory\":\"\",\"timeout\":30000,\"toolCallId\":\"call-00000000-0000-4000-8000-000000000007-1\\nfc_00000000-0000-4000-8000-000000000008_1\",\"simpleCommands\":[\"cat\"],\"hasInputRedirect\":false,\"hasOutputRedirect\":false,\"parsingResult\":{\"parsingFailed\":false,\"executableCommands\":[{\"name\":\"cat\",\"args\":[{\"type\":\"word\",\"value\":\"notes.txt\"}],\"fullText\":\"cat notes.txt\"}],\"hasRedirects\":false,\"hasCommandSubstitution\":false,\"redirects\":[]},\"fileOutputThresholdBytes\":\"40000\",\"isBackground\":false,\"skipApproval\":false,\"timeoutBehavior\":\"TIMEOUT_BEHAVIOR_BACKGROUND\",\"hardTimeout\":86400000,\"description\":\"Display notes.txt contents\",\"closeStdin\":true,\"conversationId\":\"00000000-0000-4000-8000-000000000005\",\"adminCommandDenylist\":[],\"requestId\":\"00000000-0000-4000-8000-000000000006\",\"smartModeClassifierAllowed\":false},\"result\":{\"success\":{\"command\":\"cat notes.txt\",\"workingDirectory\":\"\",\"exitCode\":0,\"signal\":\"\",\"stdout\":\"alpha\\n\",\"stderr\":\"\",\"executionTime\":1393,\"interleavedOutput\":\"alpha\\n\",\"localExecutionTimeMs\":211},\"isBackground\":false},\"description\":\"Display notes.txt contents\"},\"hookAdditionalContexts\":[],\"toolCallId\":\"call-00000000-0000-4000-8000-000000000007-1\\nfc_00000000-0000-4000-8000-000000000008_1\",\"startedAtMs\":\"946684824000\",\"completedAtMs\":\"946684828000\"},\"model_call_id\":\"00000000-0000-4000-8000-000000000006-0-fxtr\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684829000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\"The\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684830000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" user\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684831000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" asked\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684832000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" me\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684833000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" to\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684834000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" reply\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684835000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" with the single word \\\"done\\\".\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684836000}",
  "{\"type\":\"thinking\",\"subtype\":\"completed\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684836000}",
  "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"done\"}]},\"session_id\":\"00000000-0000-4000-8000-000000000005\"}",
  "{\"type\":\"result\",\"subtype\":\"success\",\"duration_ms\":6870,\"duration_api_ms\":6870,\"is_error\":false,\"result\":\"Creating `notes.txt`, then running `cat notes.txt`.done\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"request_id\":\"00000000-0000-4000-8000-000000000006\",\"usage\":{\"inputTokens\":9592,\"outputTokens\":166,\"cacheReadTokens\":17024,\"cacheWriteTokens\":0,\"reasoningTokens\":58}}"
]

export const FOLLOW_UP: string[] = [
  "{\"type\":\"system\",\"subtype\":\"init\",\"apiKeySource\":\"fixture\",\"cwd\":\"/work\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"model\":\"Auto\",\"permissionMode\":\"default\"}",
  "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Which file did you create? Reply with just its name. Do not run any commands.\"}]},\"session_id\":\"00000000-0000-4000-8000-000000000005\"}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\"The\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684837000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" user\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684838000}",
  "{\"type\":\"thinking\",\"subtype\":\"delta\",\"text\":\" wants me to reply with just the name of the file I created, which was notes.txt.\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684839000}",
  "{\"type\":\"thinking\",\"subtype\":\"completed\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"timestamp_ms\":946684840000}",
  "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"notes.txt\"}]},\"session_id\":\"00000000-0000-4000-8000-000000000005\"}",
  "{\"type\":\"result\",\"subtype\":\"success\",\"duration_ms\":1991,\"duration_api_ms\":1991,\"is_error\":false,\"result\":\"notes.txt\",\"session_id\":\"00000000-0000-4000-8000-000000000005\",\"request_id\":\"00000000-0000-4000-8000-000000000009\",\"usage\":{\"inputTokens\":84,\"outputTokens\":26,\"cacheReadTokens\":13440,\"cacheWriteTokens\":0,\"reasoningTokens\":24}}"
]

export const SESSION = '00000000-0000-4000-8000-000000000005'
export const FILE = '/work/notes.txt'

export const fixture: HarnessFixture = {
  version: 'cursor-agent 2026.11.19-f005e9d',
  first: FIRST,
  rows: 2,
  closing: 'done',
  followUp: FOLLOW_UP,
  followUpClosing: 'notes.txt',
}
