/**
 * File-trace plugin, node half. Registers the self-update endpoint (the
 * user-initiated one-click update from the browser panel); everything else
 * lives in the browser half shipped via exports["./client"].
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerUpdateEndpoint } from './update-endpoint.ts'
import { registerAssetEndpoint } from './asset-endpoint.ts'
import { registerChunkRoute } from './chunk-route.ts'

/** Stable Cordis plugin name (matches the manifest id). */
export const name = '@dsh-external/dsh-file-trace'

/** The web server is required before the update endpoint can register. */
export const inject = ['webServer']

/**
 * Host plugin body: register the update endpoint.
 * @param ctx - host context carrying the webServer service.
 */
export function apply(ctx: Context): void {
  registerUpdateEndpoint(ctx)
  registerAssetEndpoint(ctx)
  registerChunkRoute(ctx)
}
