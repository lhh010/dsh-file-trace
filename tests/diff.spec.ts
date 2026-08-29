/** diff engine behavior: LCS correctness, rewrite pairing, empty sides. */
import { describe, expect, it } from 'vitest'
import { diffLines, formatBytes, buildDiffSegments, diffInline, type DiffSegment } from '../src/client/diff.ts'

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

describe('diffInline', () => {
  it('marks only the changed substring on identical-prefix/suffix lines', () => {
    const r = diffInline('hello world again', 'hello dsh world again')
    const changedOld = r.old.filter(s => s.changed).map(s => s.text).join('')
    const changedNext = r.next.filter(s => s.changed).map(s => s.text).join('')
    expect(changedNext).toBe('dsh ')
    expect(changedOld).toBe('')
  })

  it('marks an insertion as changed on the new side only', () => {
    const r = diffInline('abc', 'aXbc')
    expect(r.next.filter(s => s.changed).map(s => s.text).join('')).toBe('X')
    expect(r.old.every(s => !s.changed)).toBe(true)
  })

  it('degrades very long lines to a single changed segment', () => {
    const r = diffInline('x'.repeat(2500), 'y'.repeat(2500))
    expect(r.next).toHaveLength(1)
    expect(r.next[0]!.changed).toBe(true)
  })

  it('returns empty changed runs for identical text', () => {
    const r = diffInline('same', 'same')
    expect(r.old.every(s => !s.changed)).toBe(true)
    expect(r.next.every(s => !s.changed)).toBe(true)
  })
})

describe('buildDiffSegments', () => {
  it('folds unchanged context and keeps a window around the change', () => {
    // 12 context lines, a change at index 6, then 8 context lines.
    const context = (n: number) => [{ kind: 'context' as const, oldLine: n + 1, newLine: n + 1, text: 'c' + String(n) }]
    const before = Array.from({ length: 6 }, (_, i) => context(i)).flat()
    const change = [{ kind: 'mod' as const, oldLine: 7, newLine: 7, text: 'CHANGE' }]
    const after = Array.from({ length: 8 }, (_, i) => context(i + 7)).flat()
    const rows = [...before, ...change, ...after]
    const segments = buildDiffSegments(rows, 3)
    // Expect: leading fold, a hunk (3 context + change + 3 context), trailing fold.
    expect(segments.map(s => s.kind)).toEqual(['fold', 'hunk', 'fold'])
    const hunk = segments[1] as Extract<DiffSegment, { kind: 'hunk' }>
    expect(hunk.rows).toHaveLength(7) // 3 + change + 3
    expect(hunk.rows[3]!.text).toBe('CHANGE')
    const leading = segments[0] as Extract<DiffSegment, { kind: 'fold' }>
    expect(leading.rows).toHaveLength(3) // first 3 context rows (row 4,5,6 stay as hunk prefix)
    const trailing = segments[2] as Extract<DiffSegment, { kind: 'fold' }>
    expect(trailing.rows).toHaveLength(5) // remaining after hunk suffix
  })

  it('collapses an all-context diff into one fold', () => {
    const rows = [{ kind: 'context' as const, oldLine: 1, newLine: 1, text: 'a' }, { kind: 'context' as const, oldLine: 2, newLine: 2, text: 'b' }]
    const segs = buildDiffSegments(rows, 3)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.kind).toBe('fold')
    expect((segs[0] as Extract<DiffSegment, { kind: 'fold' }>).rows).toHaveLength(2)
  })

  it('leaves an all-change diff as a single hunk', () => {
    const rows = [{ kind: 'add' as const, newLine: 1, text: 'a' }, { kind: 'add' as const, newLine: 2, text: 'b' }]
    const segs = buildDiffSegments(rows, 3)
    expect(segs[0]!.kind).toBe('hunk')
    expect((segs[0] as Extract<DiffSegment, { kind: 'hunk' }>).rows).toHaveLength(2)
  })
})

describe('formatBytes', () => {
  it('formats B, KB, MB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
