import { describe, expect, it } from 'vitest'
import {
  setPathActionsRemote, runPathAction, listPathApplications,
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
    const apps = await listPathApplications('/w/a.txt')
    expect(calls).toEqual([{ path: '/w/a.txt' }])
    expect(apps).toEqual([{ id: 'vscode', name: 'Visual Studio Code' }, { id: 'notepad', name: undefined }])
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
