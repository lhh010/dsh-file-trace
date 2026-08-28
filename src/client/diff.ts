/**
 * Line-based diff engine for the file-trace panel: an LCS over lines with
 * per-row change classes. Pure functions only — no React, no DOM.
 */

/** One rendered diff row. */
export interface DiffRow {
  /** Change class: 'context' shared, 'del' removed, 'add' added, 'mod' rewritten. */
  readonly kind: 'context' | 'del' | 'add' | 'mod'
  /** Old-side 1-based line number; absent on pure additions. */
  readonly oldLine?: number
  /** New-side 1-based line number; absent on pure deletions. */
  readonly newLine?: number
  /** The line's text without its terminator. */
  readonly text: string
}

/**
 * Longest-common-subsequence table over line equality.
 * @param oldLines - old side lines.
 * @param newLines - new side lines.
 * @returns the LCS length matrix (rows index oldLines, columns newLines).
 */
function lcsTable(oldLines: readonly string[], newLines: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: oldLines.length + 1 }, () => new Array<number>(newLines.length + 1).fill(0))
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i]![j] = oldLines[i] === newLines[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  return table
}

/**
 * Line diff by LCS walk with rewrite pairing: the raw walk emits context/del/
 * add rows; a del-run immediately followed by an add-run marks the overlapping
 * min(len) rows on both sides as 'mod' so rewrites tint distinctly.
 * @param oldText - the previous content; empty string diffs against nothing.
 * @param newText - the next content.
 * @returns ordered diff rows, old-side deletions before new-side additions.
 */
export function diffLines(oldText: string, newText: string): DiffRow[] {
  const oldLines = oldText.length === 0 ? [] : oldText.split('\n')
  const newLines = newText.length === 0 ? [] : newText.split('\n')
  const table = lcsTable(oldLines, newLines)
  const raw: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      raw.push({ kind: 'context', oldLine: i + 1, newLine: j + 1, text: oldLines[i]! })
      i += 1
      j += 1
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      raw.push({ kind: 'del', oldLine: i + 1, text: oldLines[i]! })
      i += 1
    } else {
      raw.push({ kind: 'add', newLine: j + 1, text: newLines[j]! })
      j += 1
    }
  }
  while (i < oldLines.length) {
    raw.push({ kind: 'del', oldLine: i + 1, text: oldLines[i]! })
    i += 1
  }
  while (j < newLines.length) {
    raw.push({ kind: 'add', newLine: j + 1, text: newLines[j]! })
    j += 1
  }
  // Post-pass: pair each del-run with the add-run that follows it.
  const rows = raw.slice()
  let k = 0
  while (k < rows.length) {
    if (rows[k]!.kind !== 'del') { k += 1; continue }
    const delStart = k
    while (k < rows.length && rows[k]!.kind === 'del') k += 1
    const addStart = k
    while (k < rows.length && rows[k]!.kind === 'add') k += 1
    const pairs = Math.min(addStart - delStart, k - addStart)
    for (let p = 0; p < pairs; p += 1) {
      rows[delStart + p] = { ...rows[delStart + p]!, kind: 'mod' }
      rows[addStart + p] = { ...rows[addStart + p]!, kind: 'mod' }
    }
  }
  return rows
}

/** Human byte count for the panel meta row. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
