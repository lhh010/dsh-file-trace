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
import { execFile, spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
// Type-only: pulls the webServer service's Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'

const UPDATE_PATH = '/dsh-file-trace/update'
const LATEST_PATH = '/dsh-file-trace/latest'
const PACKAGE_SPEC = '@dsh-external/dsh-file-trace'
const MIRROR = 'lhh010/dsh-file-trace'
const REPO_GIT = `https://github.com/${MIRROR}.git`

/** Compare two v-prefixed semvers; >0 when a is newer. */
function semverCompare(a: string, b: string): number {
  const parse = (v: string): number[] => { const p = v.replace(/^v/, '').split('.').map(x => Number(x) || 0); while (p.length < 3) p.push(0); return p }
  const pa = parse(a)
  const pb = parse(b)
  return (pa[0]! - pb[0]!) || (pa[1]! - pb[1]!) || (pa[2]! - pb[2]!)
}

/** Newest vX.Y.Z tag on the public mirror, via git ls-remote (no auth).
 * Async with a hard timeout and a TTL cache: a synchronous execFileSync here
 * would block the whole host event loop while the network is unreachable. */
const CACHE_TTL_MS = 60_000
const GIT_TIMEOUT_MS = 8_000
let latestCache: { at: number; latest: string | undefined } | undefined
let latestInflight: Promise<string | undefined> | undefined

function latestFromGit(): Promise<string | undefined> {
  if (latestCache !== undefined && Date.now() - latestCache.at < CACHE_TTL_MS) return Promise.resolve(latestCache.latest)
  if (latestInflight !== undefined) return latestInflight
  latestInflight = new Promise((resolve) => {
    execFile('git', ['ls-remote', '--tags', REPO_GIT], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' }, (error, stdout) => {
      latestInflight = undefined
      let latest: string | undefined
      if (error === null && typeof stdout === 'string') {
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim()
          if (trimmed.length === 0) continue
          const match = trimmed.match(/refs\/tags\/(v\d+\.\d+\.\d+)$/)
          if (match !== null && (latest === undefined || semverCompare(match[1]!, latest) > 0)) {
            latest = match[1]!
          }
        }
      }
      latestCache = { at: Date.now(), latest }
      resolve(latest)
    })
  })
  return latestInflight
}

/** True when the installed package is a local link (pnpm stores links as
 * symlinks/junctions whose real path differs from the node_modules path).
 * A link install must stay local: auto-update would sever it. */
function isLinkInstall(): boolean {
  try {
    const p = resolve(dshHomePath('profiles', 'web', 'node_modules', '@dsh-external'), 'dsh-file-trace')
    const real = realpathSync(p)
    return real !== resolve(p)
  } catch {
    return false
  }
}

/** Run one install command in the profile directory, resolving its exit. */
function runInstall(tag: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'pnpm',
      ['add', `${PACKAGE_SPEC}@github:${MIRROR}#${tag}`],
      { cwd: dshHomePath('profiles', 'web'), shell: true },
    )
    let output = ''
    let settled = false
    const settle = (value: { ok: boolean; output: string }): void => { if (settled) return; settled = true; resolve(value) }
    // Never let the install hang the response: kill it after two minutes.
    const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ }; settle({ ok: false, output: `${output}安装超时（120s）` }) }, 120_000)
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('error', (error) => { clearTimeout(timer); settle({ ok: false, output: `${output}${String(error)}` }) })
    child.on('close', (code) => { clearTimeout(timer); settle({ ok: code === 0, output }) })
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
  // A failure to register the endpoint must never fail the host fiber, or the
  // whole plugin (and its client half) would be marked failed. Swallow it.
  try {
    registerSafe(ctx)
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-file-trace] update endpoint skipped: ${String((error as Error)?.message ?? error)}`)
  }
}

/** Register the routes when ctx.webServer is present. */
function registerSafe(ctx: Context): void {
  ctx.effect(() => {
    // Read-only: the newest publicly released tag (git ls-remote, no auth).
    const latestDispose = ctx.webServer.register({
      kind: 'exact',
      path: LATEST_PATH,
      handler: (_req, res) => {
        void latestFromGit().then((latest) => {
          const body = `${JSON.stringify({ latest: latest ?? null })}\n`
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(body)
        })
      },
    })
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
          if (await isLinkInstall()) { send(200, { ok: false, link: true, tag }); return }
          const result = await runInstall(tag)
          send(result.ok ? 200 : 500, { ok: result.ok, output: result.output.slice(-4000), tag })
        } catch (error) {
          send(400, { ok: false, error: String((error as Error)?.message ?? error) })
        }
      },
    })
    return () => { dispose(); latestDispose() }
  }, 'file-trace: update endpoint')
}
