
import { describe, expect, it } from 'vitest'
import { parseBlocks } from '../src/client/markdown.tsx'

describe('markdown htmlwrap blocks', () => {
  it('parses a centered <div> wrapper with an inner <img> line', () => {
    const blocks = parseBlocks([
      '<div align="center">',
      '  <img src="./resources/demo.jpg" height="300">',
      '</div>',
    ].join('\n'))
    expect(blocks).toHaveLength(1)
    const b = blocks[0]!
    expect(b.kind).toBe('htmlwrap')
    if (b.kind !== 'htmlwrap') return
    expect(b.align).toBe('center')
    // inner parses to a paragraph whose inline render will find the <img>
    expect(b.blocks).toHaveLength(1)
    expect(b.blocks[0]!.kind).toBe('para')
  })
  it('parses a <p align="center"> caption wrapper', () => {
    const blocks = parseBlocks('<p align="center">\n  Figure 1. A caption.\n</p>')
    expect(blocks[0]!.kind).toBe('htmlwrap')
  })
  it('an unclosed <div> falls through to the paragraph path', () => {
    const blocks = parseBlocks('<div align="center">\nno close')
    expect(blocks[0]!.kind).toBe('para')
  })
  it('a self-contained <div>text</div> on one line stays a paragraph', () => {
    const blocks = parseBlocks('<div>inline text</div>')
    expect(blocks[0]!.kind).toBe('para')
  })
})
