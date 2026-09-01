// @vitest-environment jsdom
/**
 * Component behavior: the trigger derives ops from the conversation hook,
 * the drawer lists files, and selecting an edit op renders a colored diff.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { FileTraceButton, type FileTraceButtonProps } from '../src/client/FileTraceButton.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** One settled tool-result node fixture (edit by default). */
function toolNode(callId: string, name: string, args: Record<string, unknown>, time: number, isError: boolean, content: unknown[]) {
  return {
    kind: 'tool-result' as const,
    seq: time,
    time,
    callId,
    call: { name, argsRaw: JSON.stringify(args) },
    callTime: time,
    content,
    isError,
    subCalls: [],
  }
}

function editNode(callId: string, path: string, oldString: string, newString: string, time: number) {
  return toolNode(callId, 'edit', { file_path: path, old_string: oldString, new_string: newString }, time, false, [])
}

/** Conversation snapshot whose chat view serves the legacy node slice. */
function conversationOf(nodes: readonly unknown[]): ConversationSnapshot {
  return {
    views: { get: () => ({ legacy: { nodes, runningCalls: [] } }) },
    activeTargets: new Set(['chat']),
  } as unknown as ConversationSnapshot
}

/** Stub props: scripted useConversation over the fixture + zh translate. */
function propsWith(conversation: ConversationSnapshot): FileTraceButtonProps {
  const t = (key: string, params?: Record<string, string>): string => ((zh as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => params?.[name] ?? '')
  return {
    sessionId: 's-1',
    useConversation: ((selector: (s: ConversationSnapshot) => unknown) => selector(conversation)) as never,
    useSession: (() => undefined) as never,
    useSessions: (() => undefined) as never,
    useWorkspaces: (() => []) as never,
    useProjection: (() => undefined) as never,
    useInput: (() => undefined) as never,
    useChat: (() => undefined) as never,
    useSessionPendingInteraction: (() => undefined) as never,
    t: t as unknown as FileTraceButtonProps['t'],
  } as unknown as FileTraceButtonProps
}

describe('FileTraceButton', () => {
  it('shows the op count badge on the trigger', () => {
    const conversation = conversationOf([editNode('e1', 'a.ts', 'x', 'y', 1)])
    render(<FileTraceButton {...propsWith(conversation)} />)
    expect(screen.getByText('1').textContent).toBe('1')
  })

  it('opens the drawer, lists the file, and renders a mod-tinted diff', () => {
    const conversation = conversationOf([editNode('e1', 'src/a.ts', 'old line', 'new line', 1)])
    const { container } = render(<FileTraceButton {...propsWith(conversation)} />)
    fireEvent.click(screen.getByRole('button', { name: /文件追踪/ }))
    expect(screen.getByText('src/a.ts')).toBeTruthy()
    // Select the edit op row.
    fireEvent.click(screen.getByText('编辑').closest('button') as HTMLElement)
    // The diff pane shows both sides, classed mod (rewrite pair).
    const rows = container.querySelectorAll('[data-file-trace-diff] [data-kind]')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(container.querySelectorAll('[data-kind="mod"]').length).toBe(2)
  })

  it('shows the captured error text instead of a fabricated diff for an errored write', () => {
    const conversation = conversationOf([
      toolNode('w1', 'write', { file_path: 'a.cpp', content: 'x' }, 1, true, [{ type: 'text', text: '写入失败：目标只读' }]),
    ])
    const { container } = render(<FileTraceButton {...propsWith(conversation)} />)
    fireEvent.click(screen.getByRole('button', { name: /文件追踪/ }))
    fireEvent.click(container.querySelector('[data-op-kind="write"]') as HTMLElement)
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('写入失败：目标只读')
    expect(container.querySelectorAll('[data-file-trace-diff] [data-kind="add"]').length).toBe(0)
  })

  it('renders syntax-colored tokens for known-language lines', () => {
    const conversation = conversationOf([
      toolNode('w1', 'write', { file_path: 'a.cpp', content: 'int main() { return 0; } // go' }, 1, false, []),
    ])
    const { container } = render(<FileTraceButton {...propsWith(conversation)} />)
    fireEvent.click(screen.getByRole('button', { name: /文件追踪/ }))
    fireEvent.click(container.querySelector('[data-op-kind="write"]') as HTMLElement)
    const pane = container.querySelector('[data-file-trace-diff]')
    expect(pane).not.toBeNull()
    expect((pane as HTMLElement).innerHTML).toContain('tokKeyword')
    expect((pane as HTMLElement).innerHTML).toContain('tokComment')
    expect((pane as HTMLElement).innerHTML).toContain('tokNumber')
  })

  it('colors interior lines of a multi-line comment in a diff (state threading)', () => {
    const v1 = ['/* header', ' * interior note', ' */', 'const x = 1', 'const y = 2'].join('\n')
    const v2 = ['/* header', ' * interior note', ' */', 'const x = 1', 'const y = 3'].join('\n')
    const conversation = conversationOf([
      toolNode('w1', 'write', { file_path: 'a.ts', content: v1 }, 1, false, []),
      toolNode('w2', 'write', { file_path: 'a.ts', content: v2 }, 2, false, []),
    ])
    const { container } = render(<FileTraceButton {...propsWith(conversation)} />)
    fireEvent.click(screen.getByRole('button', { name: /文件追踪/ }))
    fireEvent.click(container.querySelector('[data-op-kind="write"]') as HTMLElement)
    const pane = container.querySelector('[data-file-trace-diff]') as HTMLElement
    // open+interior+close comment lines (3) plus the const keyword rows.
    expect(pane.innerHTML.split('tokComment').length - 1).toBe(3)
    expect(pane.innerHTML).toContain('tokKeyword')
  })

  it('renders the empty hint for a clean window', () => {
    render(<FileTraceButton {...propsWith(conversationOf([]))} />)
    fireEvent.click(screen.getByRole('button', { name: /文件追踪/ }))
    expect(screen.getByText('本会话窗口内还没有文件操作')).toBeTruthy()
  })

  it('closes on Escape', () => {
    const conversation = conversationOf([editNode('e1', 'a.ts', 'x', 'y', 1)])
    render(<FileTraceButton {...propsWith(conversation)} />)
    fireEvent.click(screen.getByRole('button', { name: /文件追踪/ }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('[data-file-trace-drawer]')).toBeNull()
  })

  it('ctrl+wheel resizes the list and pane fonts independently with bound toasts', () => {
    const conversation = conversationOf([editNode('e1', 'src/a.ts', 'old line', 'new line', 1)])
    const { container } = render(<FileTraceButton {...propsWith(conversation)} />)
    fireEvent.click(screen.getByRole('button', { name: /文件追踪/ }))
    const drawer = container.querySelector('[data-file-trace-drawer]') as HTMLElement
    // fireEvent.wheel runs inside act, so the state update re-renders.
    const wheel = (target: Element, deltaY: number): void => {
      fireEvent.wheel(target, { ctrlKey: true, deltaY })
    }
    const listArea = container.querySelector('[data-file-trace-drawer] .drawerBody') ?? drawer
    // Enlarge the list area: 12 → 15.
    for (let i = 0; i < 3; i++) wheel(listArea, -100)
    expect(drawer.style.getPropertyValue('--ft-list-font')).toBe('15px')
    // The pane font is untouched.
    expect(drawer.style.getPropertyValue('--ft-pane-font')).toBe('12px')
    // Open the diff pane and shrink it: 12 → 10. The selection remounts the
    // drawer (error-boundary key), so re-query the live element.
    fireEvent.click(screen.getByText('编辑').closest('button') as HTMLElement)
    const liveDrawer = container.querySelector('[data-file-trace-drawer]') as HTMLElement
    const pane = container.querySelector('[data-file-trace-diff]') as HTMLElement
    for (let i = 0; i < 2; i++) wheel(pane, 100)
    expect(liveDrawer.style.getPropertyValue('--ft-pane-font')).toBe('10px')
    expect(liveDrawer.style.getPropertyValue('--ft-list-font')).toBe('15px')
    // Push far past the minimum: clamps at 9px and toasts.
    for (let i = 0; i < 30; i++) wheel(pane, 100)
    expect(liveDrawer.style.getPropertyValue('--ft-pane-font')).toBe('9px')
    const toast = document.getElementById('dsh-file-trace-font-toast')
    expect(toast?.textContent).toContain('9')
  })
})

