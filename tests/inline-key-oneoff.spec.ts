import { describe, expect, it } from 'vitest'
import { diffLines } from '../src/client/diff.ts'

// One-off verification: replicate FileTraceButton.tsx's inline-map build
// (lines ~420-430) and lookup (line ~492) verbatim over real diff rows.
describe('inline map key consistency (one-off)', () => {
  it('every mod row hits its inline diff', () => {
    const oldText = ['const a = 1', 'const b = 2', 'const c = 3', 'stale line'].join('\n')
    const newText = ['const a = 1', 'const b = 20', 'const c = 30', 'const d = 4', 'extra'].join('\n')
    const rows = diffLines(oldText, newText)
    // build — verbatim from FileTraceButton.tsx
    const map = new Map<string, unknown>()
    let i = 0
    while (i < rows.length) {
      if (rows[i]!.kind !== 'mod') { i += 1; continue }
      let j = i
      while (j < rows.length && rows[j]!.kind === 'mod') j += 1
      const block = rows.slice(i, j)
      const k = Math.floor(block.length / 2)
      for (let p = 0; p < k; p += 1) {
        const delRow = block[p]!
        const addRow = block[p + k]!
        map.set(`${String(delRow.oldLine ?? '')}|${String(delRow.newLine ?? '')}`, true)
        map.set(`${String(addRow.oldLine ?? '')}|${String(addRow.newLine ?? '')}`, true)
      }
      i = j
    }
    // lookup — verbatim
    for (const row of rows) {
      if (row.kind !== 'mod') continue
      const key = `${String(row.oldLine ?? '')}|${String(row.newLine ?? '')}`
      expect(map.has(key), `miss for key ${JSON.stringify(key)} on row ${JSON.stringify(row)}`).toBe(true)
    }
    // and the keys really are half-keys, proving the scheme shape
    expect([...map.keys()]).toContain('2|')
    expect([...map.keys()]).toContain('|2')
  })
})
