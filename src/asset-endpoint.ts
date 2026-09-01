/**
 * Host-side local image asset route for the markdown reading mode: embeds of
 * local PNG/JPEG/GIF/WebP/BMP/AVIF/ICO files render in the browser through
 * GET /dsh-file-trace/asset?path=<absolute path>. Extension-whitelisted,
 * size-capped, read-only; SVG is deliberately excluded (same-origin script
 * execution) and falls back to a file chip on the client.
 */
import { stat } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer service's Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'

const ASSET_PATH = '/dsh-file-trace/asset'
/** Served image types keyed by extension (no SVG: same-origin scripts). */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
}
/** Refuse to stream absurdly large files (frame GIFs stay far below this). */
const MAX_BYTES = 64 * 1024 * 1024

/**
 * Register the asset route on the web server (an effect of the host plugin's
 * apply, so disposal rides the host fiber).
 * @param ctx - host context carrying the webServer service.
 */
export function registerAssetEndpoint(ctx: Context): void {
  // A failure here must never fail the host fiber; the reading mode simply
  // keeps its file-chip fallback for local images.
  try {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: ASSET_PATH,
      handler: async (req, res) => {
        const send = (status: number, text: string, headers?: Record<string, string>): void => {
          res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers })
          res.end(text)
        }
        if (req.method !== 'GET') { send(405, 'method not allowed'); return }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const raw = url.searchParams.get('path') ?? ''
          if (raw === '') { send(400, 'missing path'); return }
          const abs = resolve(raw)
          const ext = abs.slice(abs.lastIndexOf('.') + 1).toLowerCase()
          const type = CONTENT_TYPES[ext]
          if (type === undefined) { send(404, 'unsupported image type'); return }
          const info = await stat(abs)
          if (!info.isFile()) { send(404, 'not a file'); return }
          if (info.size > MAX_BYTES) { send(413, 'file too large'); return }
          const data = await readFile(abs)
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'content-length': String(data.byteLength) })
          res.end(data)
        } catch {
          send(404, 'not found')
        }
      },
    })
    ctx.effect(() => dispose, 'file-trace: asset endpoint')
  } catch {
    /* endpoint unavailable: reading mode falls back to file chips */
  }
}
