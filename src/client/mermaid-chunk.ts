/**
 * Mermaid renderer chunk (lazy-loaded): a self-contained ESM module the host
 * serves at /dsh-file-trace/mermaid-chunk. Imported only when a markdown
 * reading mode hits a ```mermaid fence; if the import or the render fails
 * (offline, missing chunk) the caller falls back to the plain code block.
 */
import mermaid from 'mermaid'
import { sanitizeSvg } from './mermaid-sanitize.ts'

let initialized = false

/**
 * Render one mermaid graph to an SVG string.
 * @param code - the diagram source inside the fence.
 * @returns the rendered SVG markup.
 */
export async function renderMermaid(code: string): Promise<string> {
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // Labels as real SVG <text>: htmlLabels would carry node text inside
      // <foreignObject>, which the sanitizer strips wholesale — forcing pure
      // SVG text keeps labels visible and the HTML label channel closed.
      htmlLabels: false,
      // Mermaid 11 renders a large error SVG into document.body before
      // rejecting invalid diagrams; the caller has its own fallback.
      suppressErrorRendering: true,
      theme: 'neutral',
      themeVariables: { fontFamily: 'system-ui, Segoe UI, PingFang SC, sans-serif' },
    })
    initialized = true
  }
  const id = 'ft-mmd-' + Math.random().toString(36).slice(2, 8)
  try {
    const { svg } = await mermaid.render(id, code)
    return sanitizeSvg(svg)
  } finally {
    // mermaid leaks a temporary element under a reserved id; best-effort clean.
    try { document.getElementById(id)?.remove() } catch { /* ignore */ }
  }
}