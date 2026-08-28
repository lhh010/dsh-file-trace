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

/** One settled edit tool-result node fixture. */
function editNode(callId: string, path: string, oldString: string, newString: string, time: number) {
  return {
    kind: 'tool-result' as const,
    seq: time,
    time,
    callId,
    call: { name: 'edit', argsRaw: JSON.stringify({ file_path: path, old_string: oldString, new_string: newString }) },
    callTime: time,
    content: [],
    isError: false,
    subCalls: [],
  }
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
  const t = (key: string): string => (zh as Record<string, string>)[key] ?? key
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
})
