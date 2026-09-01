/**
 * Host-side resource route for the lazily-loaded browser chunks: serves the
 * plugin's own lib/ files (mermaid and its per-diagram dynamic imports) over
 * GET /dsh-file-trace/resources/<name>. Any .js/.mjs under the package lib
 * dir is served; anything else (or a path escaping lib) is refused. The
 * markdown reading mode imports /dsh-file-trace/resources/mermaid-chunk.js,
 * whose relative imports resolve against the same prefix.
 */
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isAbsolute as pathIsAbsolute, join, normalize, relative as pathRelative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer service's Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'

const RESOURCE_PREFIX = '/dsh-file-trace/resources'
/** The lib directory this host bundle was loaded from. */
const LIB_DIR = normalize(fileURLToPath(new URL('.', import.meta.url)))

/**
 * Register the chunk-resource route (an effect of the host plugin's apply, so
 * disposal rides the host fiber).
 * @param ctx - host context carrying the webServer service.
 */
export function registerChunkRoute(ctx: Context): void {
  try {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: RESOURCE_PREFIX,
      handler: async (req, res) => {
        const deny = (status: number, message: string): void => {
          res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(message)
        }
        if (req.method !== 'GET') { deny(405, 'method not allowed'); return }
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const rel = decodeURIComponent(url.pathname.slice(RESOURCE_PREFIX.length)).replace(/^\/+/, '')
        if (rel === '' || !/.m?js$/.test(rel)) { deny(404, 'not a js resource'); return }
        const abs = normalize(join(LIB_DIR, rel))
        // Containment via path.relative is robust against Windows drive-letter
        // case (realpathSync may normalize E:\ to e:\\), which a raw
        // startsWith comparison misjudges and turns into a spurious 403.
        const inside = (p: string): boolean => {
          const r = pathRelative(LIB_DIR, p)
          return r !== '' && !r.startsWith('..') && !pathIsAbsolute(r)
        }
        if (!inside(abs)) { deny(403, 'path escapes the plugin lib'); return }
        let file: string
        try {
          file = normalize(realpathSync(abs))
          if (!inside(file)) { deny(403, 'path escapes the plugin lib'); return }
        } catch { deny(404, 'not found'); return }
        try {
          const data = await readFile(file)
          res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(data)
        } catch { deny(404, 'not found') }
      },
    })
    ctx.effect(() => dispose, 'file-trace: chunk resource route')
  } catch {
    /* chunk route unavailable: mermaid falls back to the code block */
  }
}
