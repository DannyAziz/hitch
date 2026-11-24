import { expect, test } from 'claude-code/testing'

import { printable, takeModel } from '../hooks/core/text'

test('printable strips escape sequences and control characters, keeps newlines', async () => {
  expect(printable('\x1b[32m✔\x1b[0m ok\x1b[2K')).toBe('✔ ok')
  expect(printable('a\x1b]0;title\x07b')).toBe('ab')
  expect(printable('one\ntwo\r')).toBe('one\ntwo')
  expect(printable('a\tb\x00c')).toBe('a  bc')
})

test('takeModel takes a first line "model: <name>" out of the prompt; anything else stays as text', async () => {
  expect(takeModel('model: gemini-4-neon-high\n\nDo the thing')).toEqual({ model: 'gemini-4-neon-high', prompt: 'Do the thing' })
  expect(takeModel('  Model:  openrouter/~deepseek/deepseek-flash-latest  \nGo')).toEqual({ model: 'openrouter/~deepseek/deepseek-flash-latest', prompt: 'Go' })
  expect(takeModel('model: swe-2-max')).toEqual({ model: 'swe-2-max', prompt: '' })
  // Not the first line, not one word, or shaped like a flag: left alone.
  for (const text of ['Do it\nmodel: x', 'model: two words\nGo', 'model: --force\nGo', 'model:\nGo', 'modelling: x\nGo']) {
    expect(takeModel(text)).toEqual({ prompt: text })
  }
})
