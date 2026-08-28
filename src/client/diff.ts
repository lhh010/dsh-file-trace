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


/** One rendered hunk: change rows plus the surrounding context window. */
export interface DiffHunk { readonly kind: 'hunk'; readonly rows: readonly DiffRow[] }

/** One collapsed run of unchanged context rows (the "… n 行" fold). */
export interface DiffFold {
  readonly kind: 'fold'
  /** The context rows this fold hides; re-render them when expanded. */
  readonly rows: readonly DiffRow[]
  readonly oldStart: number
  readonly oldEnd: number
  readonly newStart: number
  readonly newEnd: number
}

export type DiffSegment = DiffHunk | DiffFold

/** Context window (rows around a change) kept visible in a hunk. */
export const HUNK_CONTEXT = 3

/** Folded context runs shorter than this are shown directly, not collapsed. */
export const MIN_FOLD = 3

/**
 * Group a line diff into hunks and folded context runs. Consecutive changes
 * whose gap fits within the context window merge into one hunk; unchanged
 * regions between hunks (and any surrounding the whole diff) become fold
 * segments that default collapsed. This yields the file-hunk presentation
 * familiar from terminal diffs (Claude Code / git hunk headers).
 * @param rows - the flat diff rows.
 * @param context - how many unchanged rows around a change stay visible.
 * @returns ordered segments (hunks and folds).
 */
export function buildDiffSegments(rows: readonly DiffRow[], context = HUNK_CONTEXT): DiffSegment[] {
  if (rows.length === 0) return []
  const changeIndexes = rows.flatMap((row, index) => (row.kind === 'context' ? [] : [index]))
  if (changeIndexes.length === 0) {
    // Whole diff is unchanged (or a pure no-op): hide it all behind one fold.
    return [{ kind: 'fold', rows: [...rows], oldStart: 1, oldEnd: rows.length, newStart: 1, newEnd: rows.length }]
  }
  // Cluster changes into runs whose gaps fit within 2*context+1 rows.
  const hunks: { start: number; end: number }[] = []
  for (const ci of changeIndexes) {
    const start = Math.max(0, ci - context)
    const end = Math.min(rows.length - 1, ci + context)
    const last = hunks[hunks.length - 1]
    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end)
    } else {
      hunks.push({ start, end })
    }
  }
  const segments: DiffSegment[] = []
  let cursor = 0
  for (const hunk of hunks) {
    if (hunk.start > cursor) {
      const foldRows = rows.slice(cursor, hunk.start)
      segments.push({
        kind: 'fold',
        rows: foldRows,
        oldStart: firstOldLine(foldRows) ?? (foldRows.length === 0 ? cursor + 1 : cursor + 1),
        oldEnd: lastOldLine(foldRows) ?? 0,
        newStart: firstNewLine(foldRows) ?? (foldRows.length === 0 ? cursor + 1 : cursor + 1),
        newEnd: lastNewLine(foldRows) ?? 0,
      })
    }
    segments.push({ kind: 'hunk', rows: rows.slice(hunk.start, hunk.end + 1) })
    cursor = hunk.end + 1
  }
  if (cursor < rows.length) {
    const foldRows = rows.slice(cursor)
    segments.push({
      kind: 'fold',
      rows: foldRows,
      oldStart: firstOldLine(foldRows) ?? cursor + 1,
      oldEnd: lastOldLine(foldRows) ?? 0,
      newStart: firstNewLine(foldRows) ?? cursor + 1,
      newEnd: lastNewLine(foldRows) ?? 0,
    })
  }
  return segments
}

function firstOldLine(rows: readonly DiffRow[]): number | undefined {
  for (const row of rows) if (row.oldLine !== undefined) return row.oldLine
  return undefined
}
function lastOldLine(rows: readonly DiffRow[]): number | undefined {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i]!.oldLine !== undefined) return rows[i]!.oldLine
  return undefined
}
function firstNewLine(rows: readonly DiffRow[]): number | undefined {
  for (const row of rows) if (row.newLine !== undefined) return row.newLine
  return undefined
}
function lastNewLine(rows: readonly DiffRow[]): number | undefined {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i]!.newLine !== undefined) return rows[i]!.newLine
  return undefined
}

/** Human byte count for the panel meta row. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
