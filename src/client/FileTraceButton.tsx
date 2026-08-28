/**
 * FileTraceButton: the session-header utilities trigger. Derives the file
 * operation list live from the Chat view snapshot (pure derivation each
 * render — no store, no listener), shows a count badge, and on click opens
 * a self-contained fixed-position drawer listing every touched file with a
 * line-diff view (del red / add green / mod blue via --dsw state tokens).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { extractFileOps, groupByFile, knownContentBefore, parseReadLines, type FileOp } from './file-ops.ts'
import { diffLines, formatBytes, buildDiffSegments, type DiffRow } from './diff.ts'
import css from './FileTrace.module.css'

/** Long diff lines fold to one ellipsized row; the threshold is the char count. */
const FOLD_THRESHOLD = 120

/** Trigger props: session standard kit + locale seat. */
export type FileTraceButtonProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'fileTrace'>

/** Diff material for one operation, computed at open time.
 * For an edit the model's payload is only the changed snippet, so a hunched
 * diff needs the file's prior full content: when known (from an earlier
 * write/read in the window) apply the replacement to reconstruct the new full
 * content and diff whole files; otherwise fall back to the snippet itself. */
function diffOf(op: FileOp, prior: string | undefined): readonly DiffRow[] {
  if (op.kind === 'read') return []
  if (op.kind === 'edit' && op.edit !== undefined) {
    const { oldString, newString } = op.edit
    if (prior !== undefined && prior.includes(oldString)) {
      const newFile = prior.replace(oldString, newString)
      return diffLines(prior, newFile)
    }
    return diffLines(oldString, newString)
  }
  if (op.kind === 'write') {
    const content = op.content ?? ''
    // A write is an authoritative full-content op: when the prior state is
    // unknown or identical to the written content, render it as all-added
    // (every line a green +) rather than a no-op context list.
    const old = prior !== undefined && prior !== content ? prior : undefined
    return diffLines(old ?? '', content)
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
  // Long diff lines fold to one ellipsized row; the set holds expanded row keys.
  const [expandedLines, setExpandedLines] = useState<ReadonlySet<string>>(new Set())
  // Hunk-fold segments expanded by index; default collapsed.
  const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<number>>(new Set())
  // Bottom diff pane height in px; drag the handle to resize (min/max clamp).
  const [diffHeight, setDiffHeight] = useState(340)
  const diffPaneRef = useRef<HTMLDivElement>(null)

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = diffHeight
    const onMove = (ev: PointerEvent): void => {
      setDiffHeight(Math.min(Math.max(startH + (startY - ev.clientY), 140), Math.round(window.innerHeight * 0.85)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

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
  const segments = useMemo(() => buildDiffSegments(diffRows), [diffRows])
  // Reset folding when selecting a different operation (the row indexes change).
  useEffect(() => { setExpandedLines(new Set()); setExpandedFolds(new Set()) }, [selectedOp])

  // One diff row: colored sign + text, with the long-line fold toggle.
  const renderDiffRow = (row: DiffRow, rowKey: string): ReactElement => {
    const isLong = row.text.length > FOLD_THRESHOLD
    const isFolded = isLong && !expandedLines.has(rowKey)
    return (
      <div
        key={rowKey}
        className={css.diffRow}
        data-kind={row.kind}
        data-folded={isFolded ? 'true' : undefined}
        onClick={isLong ? () => {
          setExpandedLines(prev => {
            const next = new Set(prev)
            if (next.has(rowKey)) next.delete(rowKey)
            else next.add(rowKey)
            return next
          })
        } : undefined}
        title={isFolded ? row.text : undefined}
      >
        <span className={css.lineNo}>{row.oldLine !== undefined ? String(row.oldLine) : ''}</span>
        <span className={css.lineNo}>{row.newLine !== undefined ? String(row.newLine) : ''}</span>
        <span className={css.sign} aria-label={t(`diff.${row.kind}` as never)}>
          {row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : row.kind === 'mod' ? '~' : ' '}
        </span>
        <span className={css.text} data-folded={isFolded ? 'true' : undefined}>{row.text}</span>
      </div>
    )
  }

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
            <div className={css.diffPane} data-file-trace-diff style={{ height: diffHeight }}>
              <div className={css.dragHandle} onPointerDown={onHandleDown} role="separator" aria-orientation="horizontal" aria-label="drag to resize" />
              <div className={css.diffHead}>
                <span className={css.diffPath}>{selected.path}</span>
                <span className={css.diffKind} data-kind={selected.op.kind}>
                  {t(`ops.${selected.op.kind}` as never)}
                </span>
                <button type="button" className={css.close} onClick={() => { setSelected(null) }}>×</button>
              </div>
              {selected.op.kind === 'read'
                ? (
                  <div className={css.readContent} data-file-trace-read>
                    {(selected.op.read === undefined ? [] : parseReadLines(selected.op.read)).map((line) => (
                      <div key={String(line.line)} className={css.readRow}>
                        <span className={css.lineNo}>{String(line.line)}</span>
                        <span className={css.text}>{line.text}</span>
                      </div>
                    ))}
                  </div>
                )
                : (
                  <div className={css.diffRows}>
                    {selected.op.kind === 'write'
                      && knownContentBefore(ops, selected.path, selected.op) === undefined
                      && <div className={css.priorUnknown}>{t('diff.priorUnknown')}</div>}
                    {segments.map((segment, segIndex) => {
                      if (segment.kind === 'fold') {
                        const isExpanded = expandedFolds.has(segIndex)
                        return (
                          <div
                            key={`fold-${String(segIndex)}`}
                            className={css.foldRow}
                            data-expanded={isExpanded ? 'true' : undefined}
                            onClick={() => {
                              setExpandedFolds(prev => {
                                const next = new Set(prev)
                                if (next.has(segIndex)) next.delete(segIndex)
                                else next.add(segIndex)
                                return next
                              })
                            }}
                          >
                            {isExpanded
                              ? segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`))
                              : (
                                <span className={css.foldMarker} title={`${t('diff.context')} ${segment.oldStart}–${segment.oldEnd} · ${segment.newStart}–${segment.newEnd}`}>
                                  {t('diff.fold', { count: String(segment.rows.length) })}
                                </span>
                              )}
                          </div>
                        )
                      }
                      return segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`))
                    })}
                  </div>
                )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
