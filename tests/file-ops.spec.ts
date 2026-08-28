/** file-op extraction: tool classification, arg parsing, grouping. */
import { describe, expect, it } from 'vitest'
import { extractFileOps, groupByFile, knownContentBefore } from '../src/client/file-ops.ts'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Minimal settled tool-result node fixture. */
function result(callId: string, name: string, args: Record<string, unknown>, time: number, isError = false): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: time,
    time,
    callId,
    call: { name, argsRaw: JSON.stringify(args) },
    callTime: time,
    content: [],
    isError,
    subCalls: [],
  } as unknown as ToolResultNode
}

describe('extractFileOps', () => {
  it('extracts read/write/edit with paths and payloads', () => {
    const ops = extractFileOps([
      result('r1', 'read', { file_path: 'a.ts' }, 1),
      result('w1', 'write', { file_path: 'b.ts', content: 'new body' }, 2),
      result('e1', 'edit', { file_path: 'c.ts', old_string: 'x', new_string: 'y' }, 3),
    ], [])
    expect(ops.map(op => op.kind)).toEqual(['edit', 'write', 'read'])
    expect(ops[2]!.path).toBe('a.ts')
    expect(ops[1]!.content).toBe('new body')
    expect(ops[0]!.edit).toEqual({ oldString: 'x', newString: 'y' })
  })

  it('ignores non-file tools and malformed args', () => {
    const bad = { kind: 'tool-result', seq: 9, time: 9, callId: 'x', call: { name: 'pwsh', argsRaw: '{oops' }, content: [], isError: false, subCalls: [] } as unknown as ToolResultNode
    const ops = extractFileOps([bad, result('g', 'glob', { pattern: '*' }, 8)], [])
    expect(ops).toHaveLength(0)
  })

  it('carries error and running flags', () => {
    const ops = extractFileOps([result('e', 'write', { file_path: 'a', content: 'z' }, 5, true)], [])
    expect(ops[0]!.isError).toBe(true)
    const running = extractFileOps([], [{ callId: 'r', name: 'edit', argsRaw: JSON.stringify({ file_path: 'q' }), turn: 1, step: 1, time: 6, subCalls: [] }])
    expect(running[0]!.running).toBe(true)
  })
})

describe('groupByFile / knownContentBefore', () => {
  it('groups by path with newest file first', () => {
    const ops = extractFileOps([
      result('1', 'read', { file_path: 'old.ts' }, 1),
      result('2', 'write', { file_path: 'new.ts', content: 'n' }, 2),
    ], [])
    const groups = groupByFile(ops)
    expect([...groups.keys()]).toEqual(['new.ts', 'old.ts'])
  })

  it('recovers prior content from an earlier write', () => {
    const ops = extractFileOps([
      result('1', 'write', { file_path: 'a.ts', content: 'first' }, 1),
      result('2', 'write', { file_path: 'a.ts', content: 'second' }, 2),
    ], [])
    const before = knownContentBefore(ops, 'a.ts', ops[0]!)
    expect(before).toBe('first')
  })
})
