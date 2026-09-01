/**
 * Build the lazy mermaid chunk as a SINGLE self-contained ESM file with
 * esbuild (no code-splitting): mermaid and every per-diagram module are
 * inlined, so the browser needs exactly one import and there are no relative
 * sibling chunks to resolve through the host route. Run after tsdown.
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['src/client/mermaid-chunk.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'lib/mermaid-chunk.js',
  splitting: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  logLevel: 'info',
})
console.log('mermaid-chunk.js built (single file)')
