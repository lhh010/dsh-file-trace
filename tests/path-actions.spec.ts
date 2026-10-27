import { describe, expect, it } from 'vitest'
import {
  setPathActionsRemote, runPathAction,
} from '../src/client/path-actions.ts'

/**
 * path-actions is a module-level singleton (page-lifetime caches). Tests run
 * in declaration order against the shared instance: the availability cache is
 * primed exactly once (by the 'reflects availability' test), so tests that
 * need an uncached remote must not call desktopCanOpenPaths first.
 */

describe('path-actions', () => {
  it('runPathAction fails safely when no remote was published', async () => {
    setPathActionsRemote(undefined)
    expect(await runPathAction('/w/a.txt', 'reveal')).toBe(false)
  })

  it('runPathAction fails safely with a non-conforming remote object', async () => {
    setPathActionsRemote({ session: {} })
    expect(await runPathAction('/w/a.txt', 'open')).toBe(false)
  })

  it('reveal sends { path, action: reveal }; open sends { path }', async () => {
    const calls: unknown[] = []
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async (request: { path: string; action?: 'reveal' }) => {
          calls.push(request)
          return { ok: true }
        },
      },
    })
    expect(await runPathAction('E:/w/报告.txt', 'reveal')).toBe(true)
    expect(await runPathAction('E:/w/报告.txt', 'open')).toBe(true)
    expect(calls).toEqual([
      { path: 'E:/w/报告.txt', action: 'reveal' },
      { path: 'E:/w/报告.txt' },
    ])
  })

  it('a host refusal (ok:false) reads as a failed gesture', async () => {
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async () => ({ ok: false }),
      },
    })
    expect(await runPathAction('/w/a.txt', 'open')).toBe(false)
  })

  it('a carrier rejection reads as a failed gesture, not a crash', async () => {
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async () => { throw new Error('down') },
      },
    })
    await expect(runPathAction('/w/a.txt', 'open')).resolves.toBe(false)
  })
})
