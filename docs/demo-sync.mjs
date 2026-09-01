// demo-sync.mjs — ES module highlight sample (mjs)
const TIMEOUT_MS = 5000

/** Load one JSON config with a timeout guard. */
export async function loadConfig(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/* multi-line block comment
   still colored on the second line */
export default { loadConfig, TIMEOUT_MS }
