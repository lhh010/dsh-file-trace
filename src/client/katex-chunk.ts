/**
 * KaTeX renderer chunk (lazy-loaded): a single self-contained ESM module the
 * host serves at /dsh-file-trace/resources/katex-chunk.js. Imported only when
 * the markdown reading mode encounters a math block or inline math; on any
 * failure the caller falls back to the raw-text span (pre-0.3.14 behavior).
 * katex and its CSS (fonts inlined as data: URIs at build time, one <style>
 * injected on import) are bundled inline, so the browser needs exactly one
 * import with no sibling font/CSS requests through the host route.
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * Render one LaTeX expression to HTML.
 * @param tex - the LaTeX source (without the $ delimiters).
 * @param displayMode - true for a $$ block, false for inline $...$.
 * @returns the KaTeX HTML markup (errors already folded into the output).
 */
export function renderMath(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    errorColor: '#cc0000',
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml',
    macros: {},
  })
}
