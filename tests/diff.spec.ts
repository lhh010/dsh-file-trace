/** diff engine behavior: LCS correctness, rewrite pairing, empty sides. */
import { describe, expect, it } from 'vitest'
import { diffLines, formatBytes } from '../src/client/diff.ts'

describe('diffLines', () => {
  it('marks identical texts as all context', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc')
    expect(rows.every(r => r.kind === 'context')).toBe(true)
    expect(rows).toHaveLength(3)
  })

  it('marks a pure insertion as add', () => {
    const rows = diffLines('a\nc', 'a\nb\nc')
    expect(rows.map(r => r.kind)).toEqual(['context', 'add', 'context'])
    expect(rows[1]!.newLine).toBe(2)
    expect(rows[1]!.oldLine).toBeUndefined()
  })

  it('marks a pure deletion as del', () => {
    const rows = diffLines('a\nb\nc', 'a\nc')
    expect(rows.map(r => r.kind)).toEqual(['context', 'del', 'context'])
    expect(rows[1]!.oldLine).toBe(2)
    expect(rows[1]!.newLine).toBeUndefined()
  })

  it('pairs a rewritten line as mod on both sides', () => {
    const rows = diffLines('hello world', 'hello dsh')
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.kind)).toEqual(['mod', 'mod'])
    expect(rows[0]!.text).toBe('hello world')
    expect(rows[1]!.text).toBe('hello dsh')
  })

  it('diffs against nothing as all-added', () => {
    const rows = diffLines('', 'x\ny')
    expect(rows.map(r => r.kind)).toEqual(['add', 'add'])
  })

  it('diffs to nothing as all-deleted', () => {
    const rows = diffLines('x\ny', '')
    expect(rows.map(r => r.kind)).toEqual(['del', 'del'])
  })
})

describe('formatBytes', () => {
  it('formats B, KB, MB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
