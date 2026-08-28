/**
 * File-trace plugin, browser half: registers the session-header utilities
 * trigger (with its drawer) that records and reviews every file the model
 * read, wrote, or edited in the loaded window. Export discipline:
 * packages/client/AGENTS.md — only the cordis apply surface and contract
 * types leave this package.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the Chat view snapshot types (legacy slice).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the header.utilities slot and the useConversation seat.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the renderer-owned slots service (ctx.slots merge).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the useSession seat over the Session snapshot.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { FileTraceButton } from './FileTraceButton.tsx'
import { en, zh, type FileTraceKey } from './locales.ts'
import { applyWithCompat } from './compat.ts'

export type { FileTraceButtonProps } from './FileTraceButton.tsx'
export type { FileTraceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The file-trace surfaces' copy. */
    fileTrace: FileTraceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'fileTrace'

/**
 * Required services (cordis fiber inject): the slot registry for the header
 * utilities contribution and the locale service for the dictionaries.
 */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the `fileTrace` dictionaries and the header
 * trigger behind the graceful-compatibility guard.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  applyWithCompat(
    '@dsh-external/dsh-file-trace',
    '当前 DSH 客户端 API 与插件不匹配',
    [
      '将 DSH 升级到已适配的版本（dsh-v0.1.2-alpha.1，源码构建安装）。',
      '或将插件更新到适配当前 DSH 的版本（仓库最新 tag）。',
      '如仍显示，请在插件目录执行 pnpm run build 后刷新页面。',
    ],
    [
      ['slots.inject', ctx?.slots?.inject],
      ['slots.register', ctx?.slots?.register],
      ['locale.register', ctx?.locale?.register],
    ],
    () => {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'file-trace: dictionaries')

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'file-trace', order: 10, locale: NS },
        FileTraceButton,
      ))
    },
  )
}
