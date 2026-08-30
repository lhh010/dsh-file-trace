/**
 * Host-side self-update endpoint for `@dsh-external/dsh-file-trace`.
 *
 * POST /dsh-file-trace/update  { "tag": "v0.1.4" }
 *   Runs the pinned-tag install inside the web profile directory
 *   (pnpm add '@dsh-external/dsh-file-trace@github:lhh010/dsh-file-trace#<tag>')
 *   and reports the outcome. Only this plugin's own fixed tag is ever
 *   installed; the endpoint exists solely for the user-initiated update
 *   click in the browser panel.
 */
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
// Type-only: pulls the webServer service's Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'

const UPDATE_PATH = '/dsh-file-trace/update'
const PACKAGE_SPEC = '@dsh-external/dsh-file-trace'
const MIRROR = 'lhh010/dsh-file-trace'

/** Run one install command in the profile directory, resolving its exit. */
function runInstall(tag: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'pnpm',
      ['add', `${PACKAGE_SPEC}@github:${MIRROR}#${tag}`],
      { cwd: dshHomePath('profiles', 'web'), shell: true },
    )
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('error', (error) => { resolve({ ok: false, output: `${output}${String(error)}` }) })
    child.on('close', (code) => { resolve({ ok: code === 0, output }) })
  })
}

/** Read one JSON request body (bounded). */
function readBody(req: { on: (event: string, listener: (chunk: Buffer) => void) => void }): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > 4096) reject(new Error('body too large'))
    })
    req.on('end', () => { resolve(body) })
  })
}

/**
 * Register the update endpoint on the web server (an effect of the host
 * plugin's apply, so disposal rides the host fiber).
 * @param ctx - host context carrying the webServer service.
 */
export function registerUpdateEndpoint(ctx: Context): void {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: UPDATE_PATH,
      handler: async (req, res) => {
        const send = (status: number, value: unknown): void => {
          const body = `${JSON.stringify(value)}\n`
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(body)
        }
        if (req.method !== 'POST') { send(405, { ok: false, error: 'method not allowed' }); return }
        try {
          const parsed: unknown = JSON.parse(await readBody(req))
          const tag = (parsed as { tag?: unknown }).tag
          if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag)) {
            send(400, { ok: false, error: 'invalid tag' }); return
          }
          const result = await runInstall(tag)
          send(result.ok ? 200 : 500, { ok: result.ok, output: result.output.slice(-4000), tag })
        } catch (error) {
          send(400, { ok: false, error: String((error as Error)?.message ?? error) })
        }
      },
    })
    return dispose
  }, 'file-trace: update endpoint')
}
