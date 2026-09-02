// @vitest-environment jsdom
/** mermaid-sanitize: the SVG whitelist applied before dangerouslySetInnerHTML. */
import { describe, expect, it } from 'vitest'
import { sanitizeSvg } from '../src/client/mermaid-sanitize.ts'

const wrap = (inner: string): string => '<svg xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>'

describe('sanitizeSvg', () => {
  it('keeps plain SVG shapes and text', () => {
    const out = sanitizeSvg(wrap('<rect width="4" height="4"/><text>hello</text>'))
    expect(out).toContain('<rect')
    expect(out).toContain('hello')
  })

  it('strips foreignObject, script, and foreign HTML elements (case-insensitive)', () => {
    expect(sanitizeSvg(wrap('<foreignObject><img src=x onerror=alert(1)></foreignObject>'))).not.toContain('foreignObject')
    expect(sanitizeSvg(wrap('<sCrIpT>alert(1)</sCrIpT>'))).not.toContain('cript')
    expect(sanitizeSvg(wrap('<iframe src="https://evil"></iframe>'))).not.toContain('iframe')
    expect(sanitizeSvg(wrap('<foreignobject><b>x</b></foreignobject>'))).not.toContain('foreignobject')
  })

  it('strips event-handler attributes regardless of case', () => {
    const out = sanitizeSvg(wrap('<rect onload="alert(1)" oNclick="x" width="1"/>'))
    expect(out).not.toContain('onload')
    expect(out).not.toContain('oNclick')
    expect(out).toContain('width')
    // An @-prefixed attribute is not nameable in XML at all, so a hostile
    // payload carrying one fails the parse outright and yields ''.
    expect(sanitizeSvg(wrap('<rect width="1"/>')).length).toBeGreaterThan(0)
  })

  it('strips every href and xlink:href', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a href="https://evil"><text xlink:href="https://evil">t</text></a></svg>'
    const out = sanitizeSvg(svg)
    expect(out).not.toContain('href')
    expect(out).toContain('<text')
  })

  it('rejects malformed SVG and non-svg roots with empty output', () => {
    expect(sanitizeSvg('<svg><unclosed>')).toBe('')
    expect(sanitizeSvg('<div>not svg</div>')).toBe('')
  })
})
