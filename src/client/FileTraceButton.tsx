/**
 * FileTraceButton: the session-header utilities trigger. Derives the file
 * operation list live from the Chat view snapshot (pure derivation each
 * render — no store, no listener), shows a count badge, and on click opens
 * a self-contained fixed-position drawer listing every touched file with a
 * line-diff view (del red / add green / mod blue via --dsw state tokens).
 */
import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { extractFileOps, groupByFile, knownContentBefore, parseReadLines, type FileOp } from './file-ops.ts'
import { renderCompatBanner } from './compat.ts'
import { diffLines, formatBytes, buildDiffSegments, MIN_FOLD, type DiffRow } from './diff.ts'
import css from './FileTrace.module.css'

/** Renders the remediation banner once when the drawer subtree throws. */
class DrawerErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  override componentDidCatch(error: unknown): void {
    renderCompatBanner(
      'dsh-file-trace',
      '@dsh-external/dsh-file-trace',
      `渲染出错：${String((error as Error)?.message ?? error)}`,
      ['请将插件更新到适配当前 DSH 的版本；', '或在插件目录执行 pnpm run build 后刷新页面。'],
    )
  }
  override render(): ReactNode {
    if (this.state.failed) return null
    return this.props.children
  }
}

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

  // Floating-window geometry (like dsh-minigames): position by header drag,
  // size by edge drags; persisted in localStorage.
  const LS_POS = 'dsh-file-trace:pos'
  const LS_SIZE = 'dsh-file-trace:size'
  const [winPos, setWinPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = window.localStorage.getItem(LS_POS)
      if (saved !== null) return JSON.parse(saved) as { x: number; y: number }
    } catch { /* fall through to the default */ }
    return { x: Math.max(16, window.innerWidth - 576), y: Math.max(16, Math.round(window.innerHeight * 0.12)) }
  })
  const [winSize, setWinSize] = useState<{ w: number; h: number }>(() => {
    try {
      const saved = window.localStorage.getItem(LS_SIZE)
      if (saved !== null) return JSON.parse(saved) as { w: number; h: number }
    } catch { /* fall through to the default */ }
    return { w: Math.min(560, window.innerWidth - 32), h: Math.min(720, window.innerHeight - 64) }
  })
  const posRef = useRef(winPos)
  posRef.current = winPos
  const sizeRef = useRef(winSize)
  sizeRef.current = winSize
  const saveWin = (key: string, value: unknown): void => {
    try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
  }

  /** Right-edge docking: released near the right edge, the window snaps into
 * a full-height right sidebar; dragging the header undocks it again. */
  const LS_DOCK = 'dsh-file-trace:dock'
  const SNAP_PX = 24
  const [docked, setDocked] = useState<boolean>(() => {
    try { return window.localStorage.getItem(LS_DOCK) === 'right' } catch { return false }
  })
  const dockedRef = useRef(docked)
  dockedRef.current = docked

  /** Apply the docked-right geometry: flush to the right edge, full height. */
  const applyDock = (): void => {
    const w = sizeRef.current.w
    setWinPos({ x: window.innerWidth - w, y: 0 })
    setWinSize(prev => ({ ...prev, h: window.innerHeight }))
  }

  /** Drag the floating window by its header; clamped to the viewport.
 * Dragging undocks a docked window; releasing near the right edge docks it
 * into a full-height right sidebar. */
  const startWinDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (target.closest('button') !== null) return
    e.preventDefault()
    if (dockedRef.current) {
      setDocked(false)
      saveWin(LS_DOCK, 'free')
    }
    const startX = e.clientX
    const startY = e.clientY
    const start = posRef.current
    const size = sizeRef.current
    const onMove = (ev: PointerEvent): void => {
      const x = Math.min(Math.max(start.x + ev.clientX - startX, 8), Math.max(8, window.innerWidth - size.w - 8))
      const y = Math.min(Math.max(start.y + ev.clientY - startY, 8), Math.max(8, window.innerHeight - 64))
      setWinPos({ x, y })
    }
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (up.clientX >= window.innerWidth - SNAP_PX) {
        setDocked(true)
        saveWin(LS_DOCK, 'right')
        applyDock()
      }
      saveWin(LS_POS, posRef.current)
      saveWin(LS_SIZE, sizeRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** Resize the floating window from the left edge (right edge anchored). */
  const startWinResizeW = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const start = sizeRef.current
    const anchorRight = posRef.current.x + start.w
    const onMove = (ev: PointerEvent): void => {
      const w = Math.min(Math.max(anchorRight - ev.clientX, 360), Math.min(window.innerWidth - 16, anchorRight - 8))
      setWinSize(prev => ({ ...prev, w }))
      setWinPos(prev => ({ ...prev, x: anchorRight - w }))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      saveWin(LS_SIZE, sizeRef.current)
      saveWin(LS_POS, posRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** Resize the floating window from the bottom edge (top edge anchored). */
  const startWinResizeH = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = sizeRef.current.h
    const onMove = (ev: PointerEvent): void => {
      const h = Math.min(Math.max(startH + ev.clientY - startY, 200), window.innerHeight - posRef.current.y - 8)
      setWinSize(prev => ({ ...prev, h }))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      saveWin(LS_SIZE, sizeRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

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

  // While docked, shrink the app shell (#root) by the sidebar width so the
  // conversation never overlaps the docked panel; undock restores it.
  useEffect(() => {
    const id = 'dsh-file-trace-dock-style'
    const existing = document.getElementById(id)
    if (docked) {
      const el = existing ?? document.createElement('style')
      el.id = id
      el.textContent = `#root { margin-right: ${String(winSize.w)}px; }`
      if (existing === null) document.head.appendChild(el)
      return () => { el.remove() }
    }
    if (existing !== null) existing.remove()
    return undefined
  }, [docked, winSize.w])

  // Restore the docked geometry on mount; keep the dock pinned when the
  // viewport resizes (the sidebar stays flush-right and full-height).
  useEffect(() => { if (dockedRef.current) applyDock() }, [])
  useEffect(() => {
    const onResize = (): void => { if (dockedRef.current) applyDock() }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

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
    <DrawerErrorBoundary>
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
        <div
          className={css.drawer}
          data-file-trace-drawer
          data-dock={docked ? 'right' : undefined}
          role="dialog"
          aria-label={t('title')}
          style={{ left: winPos.x, top: winPos.y, width: winSize.w, height: winSize.h } as CSSProperties}
        >
          <div
            className={css.resizeW}
            data-ft-resize-w
            onPointerDown={startWinResizeW}
            role="separator"
            aria-orientation="vertical"
          />
          {docked ? null : (
            <div
              className={css.resizeH}
              data-ft-resize-h
              onPointerDown={startWinResizeH}
              role="separator"
              aria-orientation="horizontal"
            />
          )}
          <div className={css.drawerHead} onPointerDown={startWinDrag}>
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
                  <div className={css.readContent} data-file-trace-read data-error={selected.op.isError ? 'true' : undefined}>
                    {selected.op.isError
                      ? (
                        <div className={css.readError} role="alert">
                          {selected.op.read ?? t('error')}
                        </div>
                      )
                      : (selected.op.read === undefined ? [] : parseReadLines(selected.op.read)).map((line) => (
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
                        // Runs shorter than MIN_FOLD are shown directly (no
                        // collapse) — only >= MIN_FOLD context runs fold.
                        const shouldFold = segment.rows.length >= MIN_FOLD
                        const isExpanded = expandedFolds.has(segIndex)
                        if (!shouldFold) {
                          return segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`))
                        }
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
    </DrawerErrorBoundary>
  )
}
