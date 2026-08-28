/**
 * Graceful-compatibility helper: instead of throwing when the running DSH
 * client API no longer matches what this plugin needs, render a fixed-position
 * remediation banner and degrade. Pure DOM (appended to document.body), so it
 * works regardless of which slots/services the host still provides.
 */

/** Escape one text value for interpolation into the banner's innerHTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Fixed-position banner styling; injected once the first banner mounts. */
const BANNER_CSS = [
  'position:fixed',
  'z-index:2147483000',
  'right:12px',
  'bottom:12px',
  'max-width:min(380px,calc(100vw - 24px))',
  'background:#1e2430',
  'color:#e6ebf2',
  'border:1px solid #f0a52a',
  'border-radius:10px',
  'padding:12px 14px',
  'font:13px/1.6 system-ui,Segoe UI,sans-serif',
  'box-shadow:0 8px 24px rgba(0,0,0,.35)',
].join(';')

/** One remediation banner; duplicates by id are dropped, click dismisses. */
export function renderCompatBanner(
  id: string,
  pluginName: string,
  cause: string,
  steps: readonly string[],
): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`[data-dsh-compat-banner="${id}"]`) !== null) return
  const el = document.createElement('div')
  el.setAttribute('data-dsh-compat-banner', id)
  el.setAttribute('role', 'alert')
  el.setAttribute('style', BANNER_CSS)
  const list = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')
  el.innerHTML = [
    `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(pluginName)} 与当前 DSH 不兼容</div>`,
    `<div style="margin-bottom:6px">原因：${escapeHtml(cause)}</div>`,
    `<div style="margin-bottom:4px">解决：</div>`,
    `<ol style="margin:0;padding-left:18px">${list}</ol>`,
    `<div style="margin-top:8px;color:#9aa4b2">点击关闭 · 更新后刷新页面即可</div>`,
  ].join('')
  el.addEventListener('click', () => { el.remove() })
  document.body.appendChild(el)
}

/** Fail-closed feature check: every required capability must be present. */
export function requireCapabilities(
  checks: readonly (readonly [string, unknown])[],
): string[] {
  const missing: string[] = []
  for (const [label, value] of checks) {
    if (value === undefined || value === null) missing.push(label)
  }
  return missing
}

/** Wrapper: run a plugin body, and on any missing capability or thrown error
 * render the remediation banner instead of crashing. */
export function applyWithCompat(
  pluginName: string,
  cause: string,
  steps: readonly string[],
  checks: readonly [string, unknown][],
  body: () => void,
): void {
  const missing = requireCapabilities(checks)
  if (missing.length > 0) {
    renderCompatBanner(pluginName, pluginName, `${cause}(缺失：${missing.join('、')})`, steps)
    return
  }
  try {
    body()
  } catch (error) {
    renderCompatBanner(
      pluginName,
      pluginName,
      `${cause}(错误：${String((error as Error)?.message ?? error)})`,
      steps,
    )
  }
}
