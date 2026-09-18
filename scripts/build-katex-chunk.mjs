/**
 * Build the lazy katex chunk as a SINGLE self-contained ESM file with esbuild:
 * katex is inlined and katex.min.css is embedded as a <style> injection with
 * every font rewritten to a base64 data: URI, so the browser needs exactly one
 * import and there are no sibling font/CSS requests through the host route
 * (the chunk route serves .js only). Run after tsdown.
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const katexDir = dirname(require.resolve('katex/package.json'))

/** esbuild plugin: fold katex.min.css (fonts -> base64 data URIs) into a
 *  side-effect module that injects one <style> tag on import. */
const katexCssPlugin = {
  name: 'katex-css-inline',
  setup(build) {
    build.onResolve({ filter: /katex\.min\.css$/ }, () => ({ path: 'katex-css-virtual', namespace: 'katex-css' }))
    build.onLoad({ filter: /.*/, namespace: 'katex-css' }, () => {
      let css = readFileSync(join(katexDir, 'dist', 'katex.min.css'), 'utf8')
      css = css.replace(/url\((fonts\/[^)]+)\)/g, (match, rel) => {
        const font = readFileSync(join(katexDir, 'dist', rel))
        return 'url(data:font/woff2;base64,' + font.toString('base64') + ')'
      })
      const js = [
        'const css = ' + JSON.stringify(css) + ';',
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=\"katex\"]') === null) {",
        "  const tag = document.createElement('style');",
        "  tag.dataset.plugin = '@dsh-external/dsh-file-trace';",
        "  tag.dataset.pluginCss = 'katex';",
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
      ].join('\n')
      return { contents: js, loader: 'js' }
    })
  },
}

await build({
  entryPoints: ['src/client/katex-chunk.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'lib/katex-chunk.js',
  splitting: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  plugins: [katexCssPlugin],
  logLevel: 'info',
})
console.log('katex-chunk.js built (single file, fonts inlined)')
