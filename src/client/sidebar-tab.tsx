/**
 * Better-sidebar tab mount: renders the file-trace drawer (embedded variant)
 * inside a native sidebar tab when the better-sidebar service is present.
 * Data comes from the session-scoped conversation source (uiSession current
 * binding), the same Chat-view snapshot the header utilities trigger uses.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { FileTraceButton, type FileTraceButtonProps } from './FileTraceButton.tsx'

/** Minimal observable shape of the session-scoped conversation source. */
type ConversationSource = {
  getSnapshot(): ConversationSnapshot
  subscribe(listener: () => void): () => void
}

/** The uiSession adapter's current binding (stable snapshot per change). */
type CurrentBinding = {
  getSnapshot(): { key?: unknown; hooks?: Readonly<Record<string, unknown>> }
  subscribe(listener: () => void): () => void
}

/** Props the better-sidebar service hands the tab component (structural). */
export interface FileTraceTabProps {
  ctx: ClientContext
  scope: { sessionId: string }
}

/**
 * The file-trace sidebar tab: derives the embedded panel's conversation hook
 * from the uiSession current binding (whose key names the active session)
 * and reuses the drawer component unchanged.
 * @param props - better-sidebar tab props (ctx + session scope).
 */
export function FileTraceTab({ ctx, scope }: FileTraceTabProps) {
  // Service-name reads: props.ctx is the registrar's context — property
  // access would throw "cannot get property without inject" on it.
  const locale = ctx.get('locale') as
    | { bind(ns: string): (key: never, params?: Record<string, unknown>) => string; subscribe(listener: () => void): () => void }
    | undefined
  const current = (ctx.get('uiSession') as { adapter?: { current?: CurrentBinding } } | undefined)?.adapter?.current
  const [binding, setBinding] = useState(() => current?.getSnapshot())
  const [, setRevision] = useState(0)
  useEffect(() => {
    if (current === undefined) return undefined
    setBinding(current.getSnapshot())
    return current.subscribe(() => { setBinding(current.getSnapshot()) })
  }, [current])
  // Re-render on locale revision changes so a language switch refreshes the
  // tab without waiting for the next conversation data event.
  useEffect(() => (locale === undefined ? undefined : locale.subscribe(() => { setRevision(rev => rev + 1) })), [locale])

  const t = locale?.bind('fileTrace') as unknown as FileTraceButtonProps['t'] | undefined
  const conversation = binding?.key === scope.sessionId
    ? binding.hooks?.conversation as ConversationSource | undefined
    : undefined

  if (t === undefined || conversation === undefined) {
    // A required service is absent, or the sidebar is not following this
    // tab's session: the floating trigger in the session header still covers
    // the session either way.
    return null
  }

  // Selector hook over the conversation source — the same contract the slot
  // machinery injects as the useConversation standard prop. The optional eq
  // lets the consumer skip re-renders when the selected value is unchanged.
  const useConversation = <S,>(selector: (snapshot: ConversationSnapshot) => S, eq?: (a: S, b: S) => boolean): S => {
    const [value, setValue] = useState(() => selector(conversation.getSnapshot()))
    useEffect(() => {
      const apply = (): void => {
        setValue(prev => {
          const next = selector(conversation.getSnapshot())
          return prev === next || eq?.(prev, next) === true ? prev : next
        })
      }
      apply()
      return conversation.subscribe(apply)
      // The selector/eq read only their own inputs; conversation is stable
      // for the binding's lifetime, so the effect runs once per source.
    }, [conversation])
    return value
  }

  return <FileTraceButton useConversation={useConversation} t={t} sessionId={scope.sessionId} embedded />
}

/** The tab descriptor's registration surface (structural subset of
 * BetterSidebarService.registerTab — the optional peer keeps the full type
 * out of this module's import graph). */
interface TabRegistrar {
  registerTab(descriptor: {
    id: string
    title: string | (() => string)
    order?: number
    single?: boolean
    component: (props: FileTraceTabProps) => ReactNode
  }): () => void
}

/**
 * Register the file-trace sidebar tab when the better-sidebar service is
 * present; the inject scope disposes (unregisters) when the service leaves.
 * @param ctx - client root context.
 */
export function registerSidebarTab(ctx: ClientContext): void {
  // Our fiber injects 'locale', so the property read is safe here.
  const t = ctx.locale.bind('fileTrace') as unknown as FileTraceButtonProps['t']
  ctx.inject(['betterSidebar'], (sidebarCtx) => {
    const betterSidebar = sidebarCtx.get('betterSidebar') as unknown as TabRegistrar
    sidebarCtx.effect(() => betterSidebar.registerTab({
      id: 'dsh-file-trace:trace',
      title: () => t('title'),
      order: 40,
      single: true,
      component: props => <FileTraceTab ctx={props.ctx} scope={props.scope} />,
    }), 'file-trace: sidebar tab')
  })
}
