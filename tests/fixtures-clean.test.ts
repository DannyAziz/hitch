import { expect, test } from 'claude-code/testing'
import { FIXTURES } from '../hooks/harnesses/fixtures'

// Scan the decoded strings too: JSON escaping must not hide private paths.
function violations(text: string): string[] {
  const decoded = text.replaceAll('\\/', '/').replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  const hits = decoded.match(/\/(?:Users|home|private)\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  const ids = decoded.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|\bT-[A-Za-z0-9_-]+/gi) ?? []
  return [...hits, ...ids.filter(id => !/^(?:T-)?00000000-0000-4000-8000-\d{12}$/.test(id))]
}

test('all recorded fixture lines contain only publication-safe paths and identifiers', () => {
  // Prove both rejection and allowance, including an otherwise non-UUID Amp id.
  for (const value of ['/Users/person/a', '/home/person/a', '/private/a', 'person@example.com',
    '11111111-2222-4333-8444-555555555555', 'T-real-thread']) {
    expect(violations(value).length).toBeGreaterThan(0)
  }
  expect(violations('00000000-0000-4000-8000-000000000001 T-00000000-0000-4000-8000-000000000002 /work/a')).toEqual([])
  for (const [key, fixture] of Object.entries(FIXTURES)) {
    const streams = [fixture.first, fixture.followUp ?? [], ...Object.values(fixture.additional ?? {}), Object.values(fixture.shell ?? {})]
    for (const stream of streams) {
      for (const [index, line] of stream.entries()) {
        expect({ fixture: key, line: index, violations: violations(line) }).toEqual({ fixture: key, line: index, violations: [] })
      }
    }
  }
})
