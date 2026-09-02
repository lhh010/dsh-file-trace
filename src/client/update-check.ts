/**
 * Client-side version check + click-to-update for the file-trace panel.
 * Queries the canonical public mirror's tags on GitHub (CORS-enabled,
 * unauthenticated), compares with the running version, and offers a
 * one-click update through the host endpoint — falling back to filling the
 * composer with the update prompt when the endpoint is unavailable.
 */
import pkg from '../../package.json'

/** The running plugin version (from package.json at build time). */
export const PLUGIN_VERSION: string = pkg.version

/** The canonical public mirror the check queries and the update installs from. */
export const MIRROR = 'lhh010/dsh-file-trace'

/** One GitHub tag entry (only the fields we read). */
interface GithubTag { readonly name: string }

/** Compare two semver strings (v-prefixed); >0 when a is newer. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] => { const parts = v.replace(/^v/, '').split('.').map(x => Number(x) || 0); while (parts.length < 3) parts.push(0); return parts }
  const pa = parse(a); const pb = parse(b)
  const [b0, b1, b2] = parse(b)
  if (pa[0] !== pb[0]) return pa[0]! - pb[0]!
  if (pa[1] !== pb[1]) return pa[1]! - pb[1]!
  return pa[2]! - pb[2]!
}

/**
 * Fetch the newest stable tag from the public mirror; undefined on failure.
 * @returns the latest vX.Y.Z tag name, or undefined when unreachable.
 */
async function latestFromTags(): Promise<string | undefined> {
  try {
    const res = await fetch(`https://api.github.com/repos/${MIRROR}/tags?per_page=10`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return undefined
    const tags: unknown = await res.json()
    if (!Array.isArray(tags)) return undefined
    const stable = tags
      .map((entry) => (entry as GithubTag).name)
      .filter((name): name is string => typeof name === 'string' && /^v\d+\.\d+\.\d+$/.test(name))
    if (stable.length === 0) return undefined
    return stable.reduce((newest, tag) => (compareSemver(tag, newest) > 0 ? tag : newest))
  } catch {
    return undefined
  }
}

/** Latest tag from the raw package.json version (CORS-friendly alternate). */
async function latestFromRaw(): Promise<string | undefined> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${MIRROR}/main/package.json`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return undefined
    const pkg: unknown = await res.json()
    const version = (pkg as { version?: unknown }).version
    return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? `v${version}` : undefined
  } catch {
    return undefined
  }
}

/** Write-only host endpoint: same-origin so the browser is never subject to
 * GitHub CORS; falls back to the GitHub sources when the host half is absent. */
async function latestFromHost(): Promise<string | undefined> {
  try {
    const res = await fetch('/dsh-file-trace/latest', { method: 'GET', signal: AbortSignal.timeout(9000) })
    if (!res.ok) return undefined
    const body: unknown = await res.json()
    const latest = (body as { latest?: string }).latest
    return typeof latest === 'string' && /^v\d+\.\d+\.\d+$/.test(latest) ? latest : undefined
  } catch {
    return undefined
  }
}

export async function fetchLatestTag(): Promise<string | undefined> {
  // All sources race in parallel: total latency is the slowest one instead of
  // their sum, so an offline machine shows the failure notice within seconds.
  const [host, tags, raw] = await Promise.all([latestFromHost(), latestFromTags(), latestFromRaw()])
  return host ?? tags ?? raw
}

/** The update prompt used by the composer fallback path. */
export function updatePrompt(tag: string): string {
  return [
    `帮我更新 dsh-file-trace 插件到 ${tag}，步骤：`,
    `0. 先执行 dsh --version 确认本地 DSH 版本，并对照 https://github.com/${MIRROR} 的 README「版本兼容」表——不同 DSH 版本需安装不同插件 tag，装错版本会启动崩溃；若本提示词给的 tag 与你的 DSH 版本不匹配，请改装表中对应 tag`,
    `1. 执行 dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:${MIRROR}#${tag}'（首次可能被 pnpm 11 拦截构建脚本，则先在 ~/.dsh/profiles/web 执行 pnpm approve-builds --all）`,
    '2. 完成后提醒我硬刷新浏览器（Ctrl/Cmd+Shift+R）',
    `3. 遇到安装失败 / 版本不匹配 / 启动报错：先查 https://github.com/${MIRROR} README 的「版本兼容」与「已知限制」章节再排查`,
  ].join('\n')
}

/** Result of the one-click update attempt against the host endpoint. */
export interface UpdateResult { readonly ok: boolean; readonly detail: string; readonly link?: boolean; readonly recovery?: string; readonly hostChanged?: boolean }

/**
 * Trigger the host-side install of the given tag (user-initiated click).
 * @param tag - the vX.Y.Z tag to install.
 * @returns whether the install succeeded, with tail detail text.
 */
export async function runUpdate(tag: string): Promise<UpdateResult> {
  try {
    const res = await fetch('/dsh-file-trace/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-plugin-update': 'click' },
      body: JSON.stringify({ tag }),
      signal: AbortSignal.timeout(130000),
    })
    const body: unknown = await res.json().catch(() => ({}))
    const parsed = body as { ok?: boolean; output?: string; error?: string; link?: boolean; recovery?: string; hostChanged?: boolean }
    return {
      ok: res.ok && parsed.ok === true,
      detail: typeof parsed.output === 'string' ? parsed.output : (parsed.error ?? String(res.status)),
      link: parsed.link === true,
      ...(typeof parsed.recovery === 'string' ? { recovery: parsed.recovery } : {}),
      ...(parsed.hostChanged === true ? { hostChanged: true } : {}),
    }
  } catch (error) {
    return { ok: false, detail: String((error as Error)?.message ?? error) }
  }
}
