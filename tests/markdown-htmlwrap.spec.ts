
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

import { renderInline } from '../src/client/markdown.tsx'
import { isValidElement } from 'react'

describe('renderEmbed debug', () => {
  it('renders an <img> tag with relative src as an img element (not file chip)', () => {
    const nodes = renderInline('<img src="./resources/demo.jpg" height="300">', 'dbg', { baseDir: 'homework', sessionId: 's1' })
    const imgNode = nodes.find((n) => isValidElement(n))
    expect(imgNode).toBeDefined()
    if (isValidElement(imgNode)) {
      // htmlwrap → para → inline: the img element type is 'img'
      expect(imgNode.type).toBe('img')
      expect(String(imgNode.props.src)).toContain('session=s1')
      expect(String(imgNode.props.src)).toContain('homework%2Fresources%2Fdemo.jpg')
    }
  })
  it('falls back to file chip when baseDir is undefined', () => {
    const nodes = renderInline('<img src="./resources/demo.jpg">', 'dbg2', {})
    const el = nodes.find((n) => isValidElement(n))
    if (isValidElement(el)) {
      expect(el.type).not.toBe('img')
    }
  })
})

describe('html comments', () => {
  it('renders <!-- ... --> as nothing', () => {
    const nodes = renderInline('before <!-- ![image](x.png) --> after', 'cm')
    const text = nodes.map((n) => (typeof n === 'string' ? n : '')).join('')
    expect(text).toBe('before  after')
  })
  it('an unterminated comment stays literal', () => {
    const nodes = renderInline('a <!-- no close', 'cm2')
    const text = nodes.map((n) => (typeof n === 'string' ? n : '')).join('')
    expect(text).toBe('a <!-- no close')
  })
})
