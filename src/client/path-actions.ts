/**
 * Host desktop path actions over the optional Session Remote: reveal a traced
 * file in the OS file manager (selected), or open it with its default local
 * application. The remote is optional — hosts without a desktop (SSH remotes,
 * headless) or older DSH builds simply never publish these controls.
 *
 * Mirrors the official ui-open-in-app controller contract
 * (`session.canOpenWorkspacePath` / `session.openWorkspacePath`) so the host
 * side needs no plugin contribution.
 */

/** The slice of the Client Remote the path actions call. */
export interface PathActionsRemote {
  readonly session: {
    /** Whether the Host can hand a workspace path to a native desktop. */
    canOpenWorkspacePath(): Promise<{ ok: boolean } & Record<string, unknown>>
    /** Open one Host path in its default application, or reveal it in the file manager. */
    openWorkspacePath(request: { path: string; action?: 'reveal' }, signal?: AbortSignal): Promise<{ ok: boolean } & Record<string, unknown>>
  }
}

/** Module-level remote, set once by the plugin body when the service exists. */
let remote: PathActionsRemote | null = null

/** Publish the Session Remote slice; called from the plugin apply when present. */
export function setPathActionsRemote(value: unknown): void {
  const candidate = value as Partial<PathActionsRemote> | null | undefined
  remote = candidate !== null && candidate !== undefined && candidate.session !== undefined
    && typeof candidate.session.canOpenWorkspacePath === 'function'
    && typeof candidate.session.openWorkspacePath === 'function'
    ? candidate as PathActionsRemote
    : null
}

/** Cached desktop availability; null = not asked yet, false = asked and unavailable. */
let desktopReady: boolean | null = null
let desktopLoading: Promise<boolean> | undefined

/**
 * Whether the host desktop can take path gestures. Asked once per page; a
 * carrier rejection reads as unavailable so the buttons hide instead of break.
 */
export function desktopCanOpenPaths(): Promise<boolean> {
  if (desktopReady !== null) return Promise.resolve(desktopReady)
  desktopLoading ??= (async (): Promise<boolean> => {
    let available = false
    try {
      const result = remote?.session.canOpenWorkspacePath()
      available = remote !== null && result !== undefined && (await result).ok
    } catch {
      // Swallows carrier rejections: an unreachable host reads as no desktop.
    }
    desktopReady = available
    return available
  })()
  return desktopLoading
}

/**
 * Run one path gesture.
 * @param path - the traced file path, as the operation recorded it (relative
 * paths resolve on the host against the workspace).
 * @param action - 'reveal' shows the file selected in the file manager;
 * 'open' hands it to its default local application.
 * @returns true when the host acknowledged the gesture.
 */
export async function runPathAction(path: string, action: 'open' | 'reveal'): Promise<boolean> {
  if (remote === null) return false
  try {
    const request = action === 'reveal' ? { path, action } : { path }
    return (await remote.session.openWorkspacePath(request)).ok
  } catch {
    // Swallows carrier rejections: report the gesture as failed.
    return false
  }
}
