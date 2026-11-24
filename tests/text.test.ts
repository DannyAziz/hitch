import { expect, test } from 'claude-code/testing'

import { printable, takeModel, unwrapMessage } from '../hooks/core/text'

test('printable strips escape sequences and control characters, keeps newlines', async () => {
  expect(printable('\x1b[32m✔\x1b[0m ok\x1b[2K')).toBe('✔ ok')
  expect(printable('a\x1b]0;title\x07b')).toBe('ab')
  expect(printable('one\ntwo\r')).toBe('one\ntwo')
  expect(printable('a\tb\x00c')).toBe('a  bc')
})

test('takeModel takes a first line "model: <name>" out of the prompt; anything else stays as text', async () => {
  expect(takeModel('model: gemini-4-neon-high\n\nDo the thing')).toEqual({ model: 'gemini-4-neon-high', prompt: 'Do the thing' })
  expect(takeModel('\n  model:  openrouter/~deepseek/deepseek-flash-latest  \nGo')).toEqual({ model: 'openrouter/~deepseek/deepseek-flash-latest', prompt: 'Go' })
  expect(takeModel('model: swe-2-max')).toEqual({ model: 'swe-2-max', prompt: '' })
  // Windows line endings, and Cursor's bracketed overrides.
  expect(takeModel('model: gpt-6-luna\r\n\r\nhello\r\nthere')).toEqual({ model: 'gpt-6-luna', prompt: 'hello\nthere' })
  expect(takeModel('model: claude-opus-4-8[context=1m,effort=high]\nGo')).toEqual({ model: 'claude-opus-4-8[context=1m,effort=high]', prompt: 'Go' })
  // Not the first line, not lowercase `model:`, not one word, or shaped like a flag: left alone.
  for (const text of ['Do it\nmodel: x', 'Model: Invoice\nFields: id', 'MODEL: x\nGo', 'model: two words\nGo', 'model: --force\nGo', 'model:\nGo', 'modelling: x\nGo']) {
    expect(takeModel(text)).toEqual({ prompt: text })
  }
})

test('unwrapMessage takes the message out of the note Claude Code wraps a SendMessage in', async () => {
  const wrapped = 'The coordinator sent a message while you were working:\nmodel: gpt-5.6-terra\n\nReply TWO\n\nAddress this before completing your current task.'
  expect(unwrapMessage(wrapped)).toBe('model: gpt-5.6-terra\n\nReply TWO')
  expect(takeModel(unwrapMessage(wrapped))).toEqual({ model: 'gpt-5.6-terra', prompt: 'Reply TWO' })
  // Anything else is left as it is.
  expect(unwrapMessage('The coordinator sent a message: hi')).toBe('The coordinator sent a message: hi')
})
