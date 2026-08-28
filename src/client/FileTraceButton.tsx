/**
 * FileTraceButton: the session-header utilities trigger. Derives the file
 * operation list live from the Chat view snapshot (pure derivation each
 * render — no store, no listener), shows a count badge, and on click opens
 * a self-contained fixed-position drawer listing every touched file with a
 * line-diff view (del red / add green / mod blue via --dsw state tokens).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { extractFileOps, groupByFile, knownContentBefore, type FileOp } from './file-ops.ts'
import { diffLines, formatBytes, type DiffRow } from './diff.ts'
import css from './FileTrace.module.css'

/** Trigger props: session standard kit + locale seat. */
export type FileTraceButtonProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'fileTrace'>

/** Diff material for one operation, computed at open time. */
function diffOf(op: FileOp, prior: string | undefined): readonly DiffRow[] {
  if (op.kind === 'read') return []
  if (op.kind === 'edit' && op.edit !== undefined) {
    return diffLines(op.edit.oldString, op.edit.newString)
  }
  if (op.kind === 'write' && op.content !== undefined) {
    return diffLines(prior ?? '', op.content)
  }
  return []
}

/** The header trigger button plus its drawer. */
export function FileTraceButton({ useConversation, t }: FileTraceButtonProps) {
  const ops = useConversation((conversation: ConversationSnapshot) => {
    const chat = conversation.views.get('chat')
    return extractFileOps(chat?.legacy.nodes ?? [], chat?.legacy.runningCalls ?? [])
  })
  const groups = useMemo(() => groupByFile(ops), [ops])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<{ path: string; op: FileOp } | null>(null)

  // Escape closes the drawer, mirroring platform dialog behavior.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open])

  const count = ops.length
  const selectedOp = selected?.op
  const diffRows = useMemo(
    () => selectedOp === undefined ? [] : diffOf(selectedOp, knownContentBefore(ops, selected?.path ?? '', selectedOp)),
    [selectedOp, selected?.path, ops],
  )

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        data-file-trace-trigger
        title={t('open')}
        aria-label={`${t('title')} (${String(count)})`}
        onClick={() => { setOpen(prev => !prev); setSelected(null) }}
      >
        <span className={css.triggerLabel}>{t('title')}</span>
        {count > 0 && <span className={css.badge}>{String(count)}</span>}
      </button>
      {open && (
        <div className={css.drawer} data-file-trace-drawer role="dialog" aria-label={t('title')}>
          <div className={css.drawerHead}>
            <span className={css.drawerTitle}>{t('title')}</span>
            <span className={css.drawerMeta}>
              {String(groups.size)} {t('files')} · {String(count)} ops
            </span>
            <button type="button" className={css.close} onClick={() => { setOpen(false) }}>{t('close')}</button>
          </div>
          <div className={css.drawerBody}>
            {count === 0 && <div className={css.empty}>{t('empty')}</div>}
            {[...groups.entries()].map(([path, fileOps]) => (
              <div key={path} className={css.fileGroup}>
                <div className={css.filePath} title={path}>{path}</div>
                {fileOps.map(op => (
                  <button
                    type="button"
                    key={op.callId}
                    className={css.opRow}
                    data-op-kind={op.kind}
                    data-op-error={op.isError ? 'true' : undefined}
                    onClick={() => { setSelected({ path, op }) }}
                  >
                    <span className={css.opKind} data-kind={op.kind}>{t(`ops.${op.kind}` as never)}</span>
                    <span className={css.opTime}>{new Date(op.time).toLocaleTimeString()}</span>
                    {op.running && <span className={css.opFlag}>{t('running')}</span>}
                    {op.isError && <span className={css.opFlagError}>{t('error')}</span>}
                    {op.kind !== 'read' && (
                      <span className={css.opSize}>
                        {formatBytes(new Blob([op.edit?.newString ?? op.content ?? '']).size)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {selected !== null && (
            <div className={css.diffPane} data-file-trace-diff>
              <div className={css.diffHead}>
                <span className={css.diffPath}>{selected.path}</span>
                <span className={css.diffKind} data-kind={selected.op.kind}>
                  {t(`ops.${selected.op.kind}` as never)}
                </span>
                <button type="button" className={css.close} onClick={() => { setSelected(null) }}>×</button>
              </div>
              <div className={css.diffRows}>
                {selected.op.kind === 'write'
                  && knownContentBefore(ops, selected.path, selected.op) === undefined
                  && <div className={css.priorUnknown}>{t('diff.priorUnknown')}</div>}
                {diffRows.map((row, index) => (
                  <div key={String(index)} className={css.diffRow} data-kind={row.kind}>
                    <span className={css.lineNo}>{row.oldLine !== undefined ? String(row.oldLine) : ''}</span>
                    <span className={css.lineNo}>{row.newLine !== undefined ? String(row.newLine) : ''}</span>
                    <span className={css.marker} aria-label={t(`diff.${row.kind}` as never)}>
                      {row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : row.kind === 'mod' ? '~' : ' '}
                    </span>
                    <span className={css.text}>{row.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
