import { describe, expect, it } from 'vitest'
import {
  setPathActionsRemote, runPathAction, listPathApplications, preloadPathApplications,
} from '../src/client/path-actions.ts'

/**
 * path-actions is a module-level singleton (page-lifetime caches). Tests run
 * in declaration order against the shared instance.
 */

describe('path-actions applications', () => {
  it('listPathApplications sends { path } and returns id/name pairs', async () => {
    const calls: unknown[] = []
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async () => ({ ok: true }),
        workspacePathApplications: async (request: { path: string }) => {
          calls.push(request)
          return { ok: true, value: [
            { id: 'vscode', name: 'Visual Studio Code' },
            { id: 'notepad' },
            { name: 'no-id-should-drop' },
          ] }
        },
      },
    })
    // Use a FRESH extension so the page-lifetime cache does not answer first.
    const apps = await listPathApplications('/w/a.qz1')
    expect(calls).toEqual([{ path: '/w/a.qz1' }])
    expect(apps).toEqual([{ id: 'vscode', name: 'Visual Studio Code' }, { id: 'notepad', name: undefined }])
  })

  it('same-extension queries hit the cache once (one host round-trip)', async () => {
    const calls: unknown[] = []
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async () => ({ ok: true }),
        workspacePathApplications: async (request: { path: string }) => {
          calls.push(request)
          return { ok: true, value: [{ id: 'app' }] }
        },
      },
    })
    await listPathApplications('/w/one.qz2')
    await listPathApplications('/other/two.QZ2')
    await listPathApplications('/w/no-ext')
    await listPathApplications('/w/dir.d/file') // dot before the slash → no extension → shares the '' cache
    expect(calls.map(c => (c as { path: string }).path)).toEqual(['/w/one.qz2', '/w/no-ext'])
  })

  it('preloadPathApplications warms the cache fire-and-forget', async () => {
    const calls: unknown[] = []
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async () => ({ ok: true }),
        workspacePathApplications: async (request: { path: string }) => {
          calls.push(request)
          return { ok: true, value: [{ id: 'x' }] }
        },
      },
    })
    preloadPathApplications('/w/preload.qz3')
    await listPathApplications('/w/other.qz3')
    expect(calls).toHaveLength(1)
    expect((calls[0] as { path: string }).path).toBe('/w/preload.qz3')
  })

  it('a refused or malformed value reads as an empty list', async () => {
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async () => ({ ok: true }),
        workspacePathApplications: async () => ({ ok: false }),
      },
    })
    expect(await listPathApplications('/w/a.txt')).toEqual([])
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async () => ({ ok: true }),
        workspacePathApplications: async () => ({ ok: true, value: 'garbage' }),
      },
    })
    expect(await listPathApplications('/w/a.txt')).toEqual([])
  })

  it('a query rejection reads as an empty list, not a crash', async () => {
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async () => ({ ok: true }),
        workspacePathApplications: async () => { throw new Error('down') },
      },
    })
    await expect(listPathApplications('/w/a.txt')).resolves.toEqual([])
  })

  it('open with an explicit application sends { path, application }', async () => {
    const calls: unknown[] = []
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async (request: { path: string; action?: 'reveal'; application?: string }) => {
          calls.push(request)
          return { ok: true }
        },
        workspacePathApplications: async () => ({ ok: true, value: [] }),
      },
    })
    expect(await runPathAction('/w/a.txt', 'open', 'vscode')).toBe(true)
    expect(calls).toEqual([{ path: '/w/a.txt', application: 'vscode' }])
  })

  it('a remote without the applications endpoint lists empty', async () => {
    setPathActionsRemote({
      session: {
        canOpenWorkspacePath: async () => ({ ok: true }),
        openWorkspacePath: async () => ({ ok: true }),
        workspacePathApplications: 'not-a-function' as unknown as PathActionsRemote['session']['workspacePathApplications'],
      },
    })
    expect(await listPathApplications('/w/a.txt')).toEqual([])
  })
})
