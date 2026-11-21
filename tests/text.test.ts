import { expect, test } from 'claude-code/testing'

import { printable } from '../hooks/core/text'

test('printable strips escape sequences and control characters, keeps newlines', async () => {
  expect(printable('\x1b[32m✔\x1b[0m ok\x1b[2K')).toBe('✔ ok')
  expect(printable('a\x1b]0;title\x07b')).toBe('ab')
  expect(printable('one\ntwo\r')).toBe('one\ntwo')
  expect(printable('a\tb\x00c')).toBe('a  bc')
})
