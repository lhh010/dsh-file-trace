/**
 * File-trace plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"] and does all the tracing and rendering.
 */
/** Stable Cordis plugin name (matches the manifest id). */
export const name = '@dsh-external/dsh-file-trace'

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
