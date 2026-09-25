/**
 * Host-side local image asset route for the markdown reading mode: embeds of
 * local PNG/JPEG/GIF/WebP/BMP/AVIF/ICO/SVG files render in the browser through
 * GET /dsh-file-trace/asset?path=<absolute path>. Extension-whitelisted,
 * size-capped, read-only. SVG is served only for <img>-based consumption
 * (markdown embeds and the .svg op preview) — SVG scripts never execute in
 * image context, matching the better-sidebar image viewer. PDF is served for
 * the render preview of .pdf op targets (the client wraps the bytes in an
 * explicitly-typed Blob so the browser's native PDF viewer opens).
 */
import { stat } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer service's Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'

const ASSET_PATH = '/dsh-file-trace/asset'

/** The workspace directory of one session (present deliveries resolve against it). */
function sessionWorkspace(ctx: Context, sessionId: string): string | undefined {
  try {
    const scope = ctx.sessions.scope(sessionId as Parameters<typeof ctx.sessions.scope>[0])
    if (scope === undefined) return undefined
    const cwd = (scope as unknown as { header?: { cwd?: unknown } }).header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch {
    return undefined
  }
}
/** Served image types keyed by extension (SVG only for <img> consumers). */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  log: 'text/plain; charset=utf-8',
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
          let abs: string
          if (isAbsolute(raw)) {
            abs = resolve(raw)
          } else {
            // Relative paths resolve against the session workspace (present
            // deliveries carry workspace-relative paths).
            const sessionParam = url.searchParams.get('session') ?? ''
            if (sessionParam === '') { send(400, 'relative path requires session'); return }
            const cwd = sessionWorkspace(ctx, sessionParam)
            if (cwd === undefined) { send(404, 'session not found'); return }
            abs = resolve(cwd, raw)
          }
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
