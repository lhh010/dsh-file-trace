import { describe, expect, it } from 'vitest'
import { extractFileOps } from '../src/client/file-ops.ts'
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 最小 tool-result node 构造。 */
function codeNode(code: string, name = 'run_code'): ConversationNode {
  return {
    kind: 'tool-result', callId: 'c1', time: 100, isError: false, content: [{ text: 'ok' }],
    call: { name, argsRaw: JSON.stringify({ code }), time: 90 },
    subCalls: [],
  } as unknown as ConversationNode
}

describe('code-op extraction', () => {
  it('finds readFileSync/writeFileSync paths and marks viaCode', () => {
    const ops = extractFileOps([codeNode("const a = readFileSync('D:/x/a.md'); writeFileSync('E:/y/b.txt', 'hi')")], [])
    expect(ops).toHaveLength(2)
    const read = ops.find(o => o.kind === 'read')!
    const write = ops.find(o => o.kind === 'write')!
    expect(read.path).toBe('D:/x/a.md')
    expect(read.viaCode).toBe(true)
    expect(write.path).toBe('E:/y/b.txt')
    expect(write.viaCode).toBe(true)
  })
  it('deduplicates repeated calls to the same path', () => {
    const ops = extractFileOps([codeNode("readFileSync('a.txt'); readFileSync('a.txt')")], [])
    expect(ops).toHaveLength(1)
  })
  it('ignores node: protocol and URLs', () => {
    const ops = extractFileOps([codeNode("import('node:fs'); fetch('https://x.com/a.png')")], [])
    expect(ops).toHaveLength(0)
  })
  it('does not touch non-code tools', () => {
    const node = codeNode('readFileSync("a.txt")', 'grep')
    const ops = extractFileOps([node], [])
    expect(ops).toHaveLength(0)
  })
  it('powershell Get-Content/Set-Content detected', () => {
    const ops = extractFileOps([codeNode('Get-Content "C:/a.md" | Out-Null', 'pwsh')], [])
    expect(ops).toHaveLength(1)
    expect(ops[0]!.kind).toBe('read')
    expect(ops[0]!.viaCode).toBe(true)
  })
  it('dynamic paths (variables) produce no ops', () => {
    const ops = extractFileOps([codeNode('readFileSync(p); writeFileSync(q, d)')], [])
    expect(ops).toHaveLength(0)
  })
})
