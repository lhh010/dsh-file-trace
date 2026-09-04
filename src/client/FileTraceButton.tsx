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
import { extractFileOps, groupByFile, knownContentBefore, parseReadContent, parseReadLines, type FileOp } from './file-ops.ts'
import { renderCompatBanner } from './compat.ts'
import { PLUGIN_VERSION, fetchLatestTag, compareSemver, runUpdate, updatePrompt } from './update-check.ts'
import { diffLines, formatBytes, buildDiffSegments, diffInline, coalesceInline, MIN_FOLD, type DiffRow, type InlineDiff } from './diff.ts'
import { scanLine, isColored, langOfPath, hasBlockComment, type TokenType, type CodeToken } from './highlight.ts'
import { MarkdownView, isMarkdownPath } from './markdown.tsx'
import { redactText } from './redact.ts'
import css from './FileTrace.module.css'

/** Renders the remediation banner once when the drawer subtree throws. */
class DrawerErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; message: string }> {
  override state = { failed: false, message: '' }
  static getDerivedStateFromError(error: unknown): { failed: boolean; message: string } { return { failed: true, message: String((error as Error)?.message ?? error) } }
  override componentDidCatch(error: unknown): void {
    renderCompatBanner(
      'dsh-file-trace',
      '@dsh-external/dsh-file-trace',
      `渲染出错：${String((error as Error)?.message ?? error)}`,
      ['请将插件更新到适配当前 DSH 的版本；', '或在插件目录执行 pnpm run build 后刷新页面。'],
    )
  }
  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className={css.drawerError} data-file-trace-error>
          渲染出错：{this.state.message}
        </div>
      )
    }
    return this.props.children
  }
}

/** Long diff lines fold to one ellipsized row; the threshold is the char count. */
const FOLD_THRESHOLD = 120

/** Token class -> CSS color class ('' inherits the row's diff color). */
const TOKEN_CLASS: Readonly<Record<TokenType, string>> = {
  plain: '',
  comment: css.tokComment ?? '',
  string: css.tokString ?? '',
  keyword: css.tokKeyword ?? '',
  number: css.tokNumber ?? '',
  type: css.tokType ?? '',
  function: css.tokFunction ?? '',
  macro: css.tokMacro ?? '',
}

/** One token span's class list: its color class, plus the change tint. */
function tokenSpanClass(type: TokenType, changed: boolean): string {
  const color = TOKEN_CLASS[type]
  return changed ? `${color} ${css.inlineChange}` : color
}

/** Render scanned tokens as colored nodes; uncolored runs stay text. */
function tokensToNodes(tokens: readonly CodeToken[], changed = false): ReactNode[] {
  const nodes: ReactNode[] = []
  for (const token of tokens) {
    if (!changed && !isColored(token)) nodes.push(token.text)
    else nodes.push(<span key={String(nodes.length)} className={tokenSpanClass(token.type, changed)}>{token.text}</span>)
  }
  return nodes
}

/** Per-row block-comment entry state for a diff: the old side threads along
 *  old-line order and the new side along new-line order (the LCS row order
 *  preserves both), so multi-line comments color correctly on each side. */
function diffBlockEntries(rows: readonly DiffRow[], lang: string | undefined): Map<DiffRow, boolean> {
  const entries = new Map<DiffRow, boolean>()
  if (!hasBlockComment(lang)) return entries
  let oldIn = false
  let newIn = false
  for (const row of rows) {
    const isOld = row.oldLine !== undefined
    const isNew = row.newLine !== undefined
    entries.set(row, isOld ? oldIn : newIn)
    if (isOld) oldIn = scanLine(row.text, lang, oldIn).inBlock
    if (isNew) newIn = scanLine(row.text, lang, newIn).inBlock
  }
  return entries
}

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
  // Update check: newest tag from the public mirror, once per open.
  const [latestTag, setLatestTag] = useState<string | undefined>(undefined)
  // True when the version check could not reach the network (shown in the drawer head).
  const [checkFailed, setCheckFailed] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ path: string; op: FileOp } | null>(null)
  // Markdown reading mode for .md files: replaces the raw/diff pane with a
  // rendered document (read = file content; write/edit = resulting content).
  const [mdReading, setMdReading] = useState(false)
  // Long diff lines fold to one ellipsized row; the set holds expanded row keys.
  const [expandedLines, setExpandedLines] = useState<ReadonlySet<string>>(new Set())
  // Hunk-fold segments expanded by index; default collapsed.
  const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<number>>(new Set())
  // Bottom diff pane height in px; drag the handle to resize (min/max clamp).
  const [diffHeight, setDiffHeight] = useState(340)
  const diffPaneRef = useRef<HTMLDivElement>(null)
  // Per-selected-op scroll memory for the diff/read pane: switching ops restores
  // that op's own position instead of jumping to the top each time.
  const scrollPaneRef = useRef<HTMLDivElement>(null)
  const scrollMemoryRef = useRef(new Map<string, number>())
  const listScrollRef = useRef<HTMLDivElement>(null)
  const listScrollMemoryRef = useRef<number | undefined>(undefined)
  // Ctrl+wheel font sizing: one size for the op-list area, one for the
  // diff/read pane; both persist in localStorage and clamp to
  // [MIN_FONT, MAX_FONT] with a toast when the wheel keeps pushing past a bound.
  const MIN_FONT = 9
  const MAX_FONT = 28
  const LS_LIST_FONT = 'dsh-file-trace:listFont'
  const LS_PANE_FONT = 'dsh-file-trace:paneFont'
  const readFont = (key: string): number | undefined => {
    try {
      const saved = window.localStorage.getItem(key)
      if (saved !== null) {
        const n = Number(saved)
        if (Number.isFinite(n)) return Math.min(Math.max(n, MIN_FONT), MAX_FONT)
      }
    } catch { /* storage unavailable */ }
    return undefined
  }
  const [listFont, setListFont] = useState(() => readFont(LS_LIST_FONT) ?? 12)
  const [paneFont, setPaneFont] = useState(() => readFont(LS_PANE_FONT) ?? 12)
  const drawerRef = useRef<HTMLDivElement>(null)
  const paneFontRef = useRef(paneFont)
  paneFontRef.current = paneFont
  const listFontRef = useRef(listFont)
  listFontRef.current = listFont
  const fontToast = (message: string): void => {
    const existing = document.getElementById('dsh-file-trace-font-toast')
    if (existing !== null) existing.remove()
    const el = document.createElement('div')
    el.id = 'dsh-file-trace-font-toast'
    el.className = css.fontToast ?? ''
    el.textContent = message
    document.body.appendChild(el)
    window.setTimeout(() => { el.remove() }, 1600)
  }
  useEffect(() => {
    if (!open) return
    const onFontWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      // The mermaid zoom modal owns ALL wheel events while open (its own
      // capture-stage handler zooms); font sizing must not fight it.
      if (document.getElementById('dsh-file-trace-mermaid-modal') !== null) return
      const target = e.target instanceof Node ? e.target : null
      const drawer = drawerRef.current
      if (drawer === null || target === null || !drawer.contains(target)) return
      e.preventDefault()
      const inPane = target instanceof Element && target.closest('[data-file-trace-diff]') !== null
      const step = e.deltaY < 0 ? 1 : -1
      const current = inPane ? paneFontRef.current : listFontRef.current
      const next = Math.min(Math.max(current + step, MIN_FONT), MAX_FONT)
      if (next === current) {
        fontToast(t(step < 0 ? 'font.min' : 'font.max', { px: String(step < 0 ? MIN_FONT : MAX_FONT) }) as never)
        return
      }
      if (inPane) setPaneFont(next)
      else setListFont(next)
      try { window.localStorage.setItem(inPane ? LS_PANE_FONT : LS_LIST_FONT, String(next)) } catch { /* storage unavailable */ }
    }
    document.addEventListener('wheel', onFontWheel, { passive: false, capture: true })
    return () => { document.removeEventListener('wheel', onFontWheel, { capture: true } as EventListenerOptions) }
  }, [open, t])

  // Floating-window geometry (like dsh-minigames): position by header drag,
  // size by edge drags; persisted in localStorage.
  const LS_POS = 'dsh-file-trace:pos'
  const LS_SIZE = 'dsh-file-trace:size'
  const [winPos, setWinPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = window.localStorage.getItem(LS_POS)
      if (saved !== null) {
        const p = JSON.parse(saved) as { x?: unknown; y?: unknown }
        if (typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y)) {
          return { x: Math.min(Math.max(p.x, 8), Math.max(8, window.innerWidth - 300)), y: Math.min(Math.max(p.y, 8), Math.max(8, window.innerHeight - 120)) }
        }
      }
    } catch { /* fall through to the default */ }
    return { x: Math.max(16, window.innerWidth - 576), y: Math.max(16, Math.round(window.innerHeight * 0.12)) }
  })
  const [winSize, setWinSize] = useState<{ w: number; h: number }>(() => {
    try {
      const saved = window.localStorage.getItem(LS_SIZE)
      if (saved !== null) {
        const s = JSON.parse(saved) as { w?: unknown; h?: unknown }
        if (typeof s.w === 'number' && Number.isFinite(s.w) && typeof s.h === 'number' && Number.isFinite(s.h)) {
          return { w: Math.min(Math.max(s.w, 360), window.innerWidth - 16), h: Math.min(Math.max(s.h, 200), window.innerHeight - 16) }
        }
      }
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

  /** Resize the floating window from the top edge (bottom edge anchored). */
  const startWinResizeHT = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = sizeRef.current.h
    const bottom = posRef.current.y + startH
    const onMove = (ev: PointerEvent): void => {
      const h = Math.min(Math.max(startH + (startY - ev.clientY), 200), window.innerHeight - 8)
      setWinSize(prev => ({ ...prev, h }))
      setWinPos(prev => ({ ...prev, y: bottom - h }))
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

  /** Resize the floating window from the right edge (left edge anchored). */
  const startWinResizeWR = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sizeRef.current.w
    const onMove = (ev: PointerEvent): void => {
      const w = Math.min(Math.max(startW + (ev.clientX - startX), 360), window.innerWidth - posRef.current.x - 8)
      setWinSize(prev => ({ ...prev, w }))
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

  // While docked AND open, shrink the page (body) by the sidebar width so the
  // conversation column reflows left and never overlaps the docked panel;
  // fixed-position elements (the docked panel itself) ignore body margin.
  // The panel's left-edge resize handle is the splitter between the two.
  // Closing the panel removes the margin — reopening (still docked) re-applies.
  useEffect(() => {
    const id = 'dsh-file-trace-dock-style'
    const existing = document.getElementById(id)
    if (docked && open) {
      const el = existing ?? document.createElement('style')
      el.id = id
      el.textContent = `body { margin-right: ${String(winSize.w)}px !important; }`
      if (existing === null) document.head.appendChild(el)
      return () => { el.remove() }
    }
    if (existing !== null) existing.remove()
    return undefined
  }, [docked, open, winSize.w])
  // Restore the docked geometry on mount; keep the dock pinned when the
  // viewport resizes (the sidebar stays flush-right and full-height).
  useEffect(() => { if (dockedRef.current) applyDock() }, [])
  useEffect(() => {
    const onResize = (): void => { if (dockedRef.current) applyDock() }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  // Check for a newer tag once on mount (the trigger button shows a ⟳ dot
  // when one exists); the drawer head reuses the same state.
  useEffect(() => {
    void fetchLatestTag().then((tag) => {
      if (tag !== undefined) setLatestTag((prev) => (prev !== undefined ? prev : tag))
      else setCheckFailed(true)
    })
  }, [])
  const newerTag = latestTag !== undefined && compareSemver(latestTag, PLUGIN_VERSION) > 0 ? latestTag : undefined

  /** One-click update: host endpoint first; on failure, copy the prompt. */
  const onUpdateClick = (): void => {
    if (newerTag === undefined || updating) return
    setUpdating(true)
    setUpdateMsg(null)
    void runUpdate(newerTag).then((result) => {
      setUpdating(false)
      if (result.ok) {
        setUpdateMsg(result.hostChanged === true ? `已更新到 ${newerTag}（含宿主侧变更），请重启 dsh 生效` : `已更新到 ${newerTag}，客户端自动刷新生效（未见变化可硬刷新）`)
        return
      }
      if (result.link) {
        void navigator.clipboard?.writeText(updatePrompt(newerTag))
          .then(() => setUpdateMsg(`本地 link 安装：自动更新会断开本地开发链接，已跳过；已把更新提示词复制到剪贴板——若想切换为 git 依赖安装并自动更新，请先以 git 方式安装本插件`))
          .catch(() => setUpdateMsg(`本地 link 安装：自动更新已跳过。请手动执行：dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:lhh010/dsh-file-trace#${newerTag}'`))
        return
      }
      void navigator.clipboard?.writeText(updatePrompt(newerTag))
        .then(() => { setUpdateMsg(`自动更新失败（${result.detail.slice(0, 80)}）；已复制更新提示词到剪贴板，粘贴发送即可${result.recovery !== undefined ? `；恢复命令：${result.recovery}` : ''}`) })
        .catch(() => { setUpdateMsg(`自动更新失败；请手动执行：dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:lhh010/dsh-file-trace#${newerTag}'`) })
    })
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
  // Language hint for syntax coloring of the selected op's content.
  const selectedLang = useMemo(
    () => selected === null ? undefined : langOfPath(selected.path),
    [selected],
  )
  // Secret redaction: on by default, toggle persists per browser. Every
  // downstream consumer (diff rows, read view, markdown mode, error text)
  // renders from viewOp below, so masked payloads are the only shape that
  // can reach the DOM while the toggle is on.
  const [redactionOn, setRedactionOn] = useState((): boolean => {
    try { return localStorage.getItem('dsh-file-trace.redaction') !== '0' } catch { return true }
  })
  const toggleRedaction = (): void => {
    setRedactionOn((prev) => {
      const next = !prev
      try { localStorage.setItem('dsh-file-trace.redaction', next ? '1' : '0') } catch { /* storage unavailable */ }
      return next
    })
  }
  const viewOp = useMemo(() => {
    const priorRaw = selectedOp === undefined ? undefined : knownContentBefore(ops, selected?.path ?? '', selectedOp)
    if (selectedOp === undefined || !redactionOn) {
      return { op: selectedOp, prior: priorRaw, hit: false }
    }
    const path = selected?.path ?? ''
    const mask = (text: string): string => redactText(path, text).text
    const hit = [selectedOp.read, selectedOp.content, selectedOp.edit?.oldString, selectedOp.edit?.newString, selectedOp.errorText, priorRaw]
      .some((text) => text !== undefined && redactText(path, text).hit)
    const op: FileOp = {
      ...selectedOp,
      ...(selectedOp.read !== undefined ? { read: mask(selectedOp.read) } : {}),
      ...(selectedOp.content !== undefined ? { content: mask(selectedOp.content) } : {}),
      ...(selectedOp.edit !== undefined ? { edit: { oldString: mask(selectedOp.edit.oldString), newString: mask(selectedOp.edit.newString) } } : {}),
      ...(selectedOp.errorText !== undefined ? { errorText: mask(selectedOp.errorText) } : {}),
    }
    return { op, prior: priorRaw === undefined ? undefined : mask(priorRaw), hit }
  }, [selectedOp, selected?.path, ops, redactionOn])
  const diffRows = useMemo(
    () => viewOp.op === undefined ? [] : diffOf(viewOp.op, viewOp.prior),
    [viewOp],
  )
  const segments = useMemo(() => buildDiffSegments(diffRows), [diffRows])
  // Char-level highlight for mod-row pairs: keyed by (oldLine|newLine), so a
  // rewritten line shows exactly which substring changed (higher-contrast bg).
  const inlineMap = useMemo(() => {
    const map = new Map<string, InlineDiff>()
    let i = 0
    while (i < diffRows.length) {
      if (diffRows[i]!.kind !== 'mod') { i += 1; continue }
      let j = i
      while (j < diffRows.length && diffRows[j]!.kind === 'mod') j += 1
      const block = diffRows.slice(i, j)
      const k = Math.floor(block.length / 2)
      for (let p = 0; p < k; p += 1) {
        const delRow = block[p]!
        const addRow = block[p + k]!
        const r = diffInline(delRow.text, addRow.text)
        map.set(`${String(delRow.oldLine ?? '')}|${String(delRow.newLine ?? '')}`, r)
        map.set(`${String(addRow.oldLine ?? '')}|${String(addRow.newLine ?? '')}`, r)
      }
      i = j
    }
    return map
  }, [diffRows])
  // Block-comment entry state per row, threaded per side (multi-line comments).
  const blockEntries = useMemo(() => diffBlockEntries(diffRows, selectedLang), [diffRows, selectedLang])
  // Read view rows with block-comment state threaded down the file's lines.
  const readRows = useMemo(() => {
    if (viewOp.op?.kind !== 'read' || viewOp.op.read === undefined) return []
    let state = false
    return parseReadLines(viewOp.op.read).map((line) => {
      const scan = scanLine(line.text, selectedLang, state)
      state = scan.inBlock
      return { line: line.line, nodes: tokensToNodes(scan.tokens) }
    })
  }, [viewOp, selectedLang])
  // Reading-mode source for a .md selection: read -> the file's full content;
  // write -> the written content; edit -> the reconstructed resulting
  // content when the prior state is known, else the edit's new snippet.
  // All payloads come from viewOp (redacted when the toggle is on).
  const readingSrc = useMemo(() => {
    if (selected === null || !isMarkdownPath(selected.path)) return ''
    const op = viewOp.op
    if (op === undefined) return ''
    if (op.kind === 'read') return parseReadContent(op.read ?? '')
    if (op.kind === 'write') return op.content ?? ''
    if (op.kind === 'edit' && op.edit !== undefined) {
      const prior = viewOp.prior
      if (prior !== undefined && prior.includes(op.edit.oldString)) {
        return prior.replace(op.edit.oldString, op.edit.newString)
      }
      return op.edit.newString
    }
    return ''
  }, [selected, viewOp])
  // Reset folding when selecting a different operation (the row indexes change).
  useEffect(() => { setExpandedLines(new Set()); setExpandedFolds(new Set()); setMdReading(false) }, [selectedOp])

  // Restore this op's own diff/read scroll position (new ops start at top).
  useEffect(() => {
    const el = scrollPaneRef.current
    if (el === null) return
    const saved = scrollMemoryRef.current.get(selectedOp?.callId ?? '')
    el.scrollTop = saved ?? 0
  }, [selectedOp, open])

  // Keep the file-list scroll position when selecting an op (don't jump to top).
  useEffect(() => {
    const el = listScrollRef.current
    if (el === null) return
    const saved = listScrollMemoryRef.current
    if (saved !== undefined) el.scrollTop = saved
  }, [selectedOp])

  // One diff row: colored sign + text, with the long-line fold toggle.
  const renderDiffRow = (row: DiffRow, rowKey: string, lang: string | undefined): ReactElement => {
    const isLong = row.text.length > FOLD_THRESHOLD
    const blockEntry = blockEntries.get(row) ?? false
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
        <span className={css.text} data-folded={isFolded ? 'true' : undefined}>
          {row.kind === 'mod' && (() => {
            const inline = inlineMap.get(`${String(row.oldLine ?? '')}|${String(row.newLine ?? '')}`)
            if (inline === undefined) return tokensToNodes(scanLine(row.text, lang, blockEntry).tokens)
            // Coalesced change runs, each split into syntax tokens with
            // block-comment state threaded across the runs of this line.
            const side = coalesceInline(row.oldLine !== undefined ? inline.old : inline.next)
            const nodes: ReactNode[] = []
            let state = blockEntry
            for (const seg of side) {
              const scan = scanLine(seg.text, lang, state)
              state = scan.inBlock
              nodes.push(...tokensToNodes(scan.tokens, seg.changed))
            }
            return nodes
          })()}
          {row.kind !== 'mod' && tokensToNodes(scanLine(row.text, lang, blockEntry).tokens)}
        </span>
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
        {newerTag !== undefined && <span className={css.updateDot} title={`新版本 ${newerTag} 可用`}>⟳</span>}
      </button>
      {open && (
        <DrawerErrorBoundary key={String(selected?.op.callId ?? 'open')}>
        <div
          className={css.drawer}
          data-file-trace-drawer
          ref={drawerRef}
          data-dock={docked ? 'right' : undefined}
          role="dialog"
          aria-label={t('title')}
          style={{ '--ft-list-font': `${String(listFont)}px`, '--ft-pane-font': `${String(paneFont)}px`, ...(docked
            ? { left: window.innerWidth - winSize.w, top: 0, width: winSize.w, height: window.innerHeight }
            : {
              left: Number.isFinite(winPos.x) ? Math.min(Math.max(winPos.x, 8), Math.max(8, window.innerWidth - 360)) : Math.max(16, window.innerWidth - 576),
              top: Number.isFinite(winPos.y) ? Math.min(Math.max(winPos.y, 8), Math.max(8, window.innerHeight - 120)) : 16,
              width: Number.isFinite(winSize.w) ? Math.min(Math.max(winSize.w, 360), window.innerWidth - 16) : Math.min(560, window.innerWidth - 16),
              height: Number.isFinite(winSize.h) ? Math.min(Math.max(winSize.h, 200), window.innerHeight - 16) : Math.min(720, window.innerHeight - 16),
            }) } as CSSProperties }
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
          {docked ? null : (
            <div
              className={css.resizeT}
              data-ft-resize-t
              onPointerDown={startWinResizeHT}
              role="separator"
              aria-orientation="horizontal"
            />
          )}
          {docked ? null : (
            <div
              className={css.resizeR}
              data-ft-resize-r
              onPointerDown={startWinResizeWR}
              role="separator"
              aria-orientation="vertical"
            />
          )}
          <div className={css.drawerHead} onPointerDown={startWinDrag}>
            <span className={css.drawerTitle}>{t('title')}</span>
            <span className={css.drawerMeta}>
              {String(groups.size)} {t('files')} · {String(count)} ops
            </span>
            {newerTag !== undefined && (
              <button type="button" className={css.updateBadge} data-updating={updating ? 'true' : undefined} onClick={onUpdateClick} title={`一键更新到 ${newerTag}（点击触发；失败则复制提示词）`}>
                {updating ? '更新中…' : `⟳ 更新到 ${newerTag}`}
              </button>
            )}
            {updateMsg !== null && <span className={css.updateMsg} title={updateMsg}>{updateMsg}</span>}
          {checkFailed && newerTag === undefined && updateMsg === null && <span className={css.updateMsg} title="无法连接宿主端点 / GitHub，稍后重开抽屉重试">⚠ 版本检查失败</span>}
            <button type="button" className={css.close} onClick={() => { setOpen(false) }}>{t('close')}</button>
          </div>
          <div className={css.drawerBody} ref={listScrollRef} onScroll={(e) => { listScrollMemoryRef.current = e.currentTarget.scrollTop }}>
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
                {viewOp.hit && redactionOn && (
                  <span className={css.redactBanner} role="status">{t('redact.banner')}</span>
                )}
                <button
                  type="button"
                  className={css.readModeBtn}
                  data-on={redactionOn ? 'true' : undefined}
                  onClick={toggleRedaction}
                  title={redactionOn ? t('redact.off') : t('redact.on')}
                >
                  {redactionOn ? t('redact.onLabel') : t('redact.offLabel')}
                </button>
                {isMarkdownPath(selected.path) && !selected.op.isError && (
                  <button
                    type="button"
                    className={css.readModeBtn}
                    data-on={mdReading ? 'true' : undefined}
                    onClick={() => { setMdReading(prev => !prev) }}
                    title={mdReading ? t('md.raw') : t('md.read')}
                  >
                    {mdReading ? t('md.raw') : t('md.read')}
                  </button>
                )}
                <button type="button" className={css.close} onClick={() => { setSelected(null) }}>×</button>
              </div>
              {selected.op.isError
                ? (
                  <div className={css.readContent} data-file-trace-read data-error="true" ref={scrollPaneRef} onScroll={(e) => { scrollMemoryRef.current.set(selectedOp?.callId ?? '', e.currentTarget.scrollTop) }}>
                    <div className={css.readError} role="alert">
                      {viewOp.op?.errorText ?? t('error')}
                    </div>
                  </div>
                )
                : mdReading && isMarkdownPath(selected.path)
                  ? (
                    <div className={css.mdPane} data-file-trace-md-pane ref={scrollPaneRef} onScroll={(e) => { scrollMemoryRef.current.set(selectedOp?.callId ?? '', e.currentTarget.scrollTop) }}>
                      <MarkdownView src={readingSrc} baseDir={selected.path.replace(/[\\/][^\\/]*$/, '')} />
                    </div>
                  )
                  : selected.op.kind === 'read'
                  ? (
                    <div className={css.readContent} data-file-trace-read ref={scrollPaneRef} onScroll={(e) => { scrollMemoryRef.current.set(selectedOp?.callId ?? '', e.currentTarget.scrollTop) }}>
                      {readRows.map((row) => (
                        <div key={String(row.line)} className={css.readRow}>
                          <span className={css.lineNo}>{String(row.line)}</span>
                          <span className={css.text}>{row.nodes}</span>
                        </div>
                      ))}
                    </div>
                  )
                  : (
                  <div className={css.diffRows} ref={scrollPaneRef} onScroll={(e) => { scrollMemoryRef.current.set(selectedOp?.callId ?? '', e.currentTarget.scrollTop) }}>
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
                          return segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`, selectedLang))
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
                              ? segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`, selectedLang))
                              : (
                                <span className={css.foldMarker} title={`${t('diff.context')} ${segment.oldStart}–${segment.oldEnd} · ${segment.newStart}–${segment.newEnd}`}>
                                  {t('diff.fold', { count: String(segment.rows.length) })}
                                </span>
                              )}
                          </div>
                        )
                      }
                      return segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`, selectedLang))
                    })}
                  </div>
                  )}
            </div>
          )}
        </div>
        </DrawerErrorBoundary>
      )}
    </>
  )
}
