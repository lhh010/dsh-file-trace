/**
 * SVG sanitization for mermaid-rendered diagrams (reading mode). Diagrams
 * come from untrusted markdown sources, so the emitted SVG is re-sanitized
 * before it reaches dangerouslySetInnerHTML — defense in depth on top of
 * mermaid's securityLevel 'strict' (labels escaped, click directives inert)
 * and htmlLabels:false (labels as real SVG text, foreignObject channel
 * closed). Strips foreignObject/script/foreign-HTML elements, event-handler
 * attributes (on-prefixed and @-prefixed), and every href/xlink:href (the
 * diagrams are static); a parse
 * failure returns '' so a malformed SVG never passes through raw. Only a
 * document whose root is an <svg> element is accepted.
 */

/** Element local names stripped case-insensitively (all lowercase). */
const STRIP_ELEMENTS: ReadonlySet<string> = new Set([
  'foreignobject',
  'script',
  'img',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'input',
  'button',
  'form',
  'link',
  'meta',
  'base',
])

/**
 * Sanitize one mermaid SVG string for safe innerHTML injection.
 * @param svg - the raw SVG markup emitted by mermaid.render.
 * @returns the cleaned SVG markup, or '' when the input fails the XML parse.
 */
export function sanitizeSvg(svg: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return ''
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  } catch {
    return ''
  }
  if (doc.querySelector('parsererror') !== null) return ''
  if (doc.documentElement === null || doc.documentElement.localName !== 'svg') return ''
  doc.querySelectorAll('*').forEach((node) => {
    // Case-insensitive element match: the string is re-parsed as HTML whose
    // parser normalizes tag casing, so <sCrIpT>/<foreignobject> must not slip.
    if (STRIP_ELEMENTS.has(node.localName.toLowerCase())) {
      node.remove()
      return
    }
    for (const attribute of [...node.attributes]) {
      const normalized = attribute.name.toLowerCase()
      if (normalized.startsWith('@') || normalized.startsWith('on')) {
        node.removeAttribute(attribute.name)
        continue
      }
      if (normalized === 'href' || normalized === 'xlink:href') {
        node.removeAttribute(attribute.name)
      }
    }
  })
  return new XMLSerializer().serializeToString(doc.documentElement)
}
