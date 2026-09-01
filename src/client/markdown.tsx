/**
 * Markdown reading-mode renderer: an Obsidian-flavored subset rendered from
 * the trace views of .md files. Self-contained block + inline parser (no
 * runtime dependency): headings, paragraphs, YAML frontmatter, fenced code,
 * thematic breaks, nested blockquotes, nested ordered/unordered/task lists,
 * GFM tables with alignment, math blocks ($$) and inline math ($), footnotes
 * ([^id] refs + definitions); inline emphasis (bold-italic, bold ** / __,
 * italic * / _, strikethrough ~~, highlight ==), code spans, escapes, links,
 * angle autolinks, raw <img> tags, Obsidian wiki links, image embeds (URL or
 * local file via the host asset route) and generic file embeds.
 */
import { useMemo, type ReactElement, type ReactNode } from 'react'
import css from './FileTrace.module.css'

/** Rendering context threaded through the inline/block renderers. */
interface Rctx {
  /** Directory of the traced .md file, for resolving relative image paths. */
  readonly baseDir?: string
  /** Footnote id -> display number (assigned in definition order). */
  readonly footnotes?: ReadonlyMap<string, number>
}

/** True when a traced path is a markdown source this renderer handles. */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path)
}

/** True for URLs a browser <img> can load directly (remote/data/blob). */
function isLoadableImage(url: string): boolean {
  return /^(https?:|data:image\/|blob:)/i.test(url)
}

/** Local image extensions the host asset route serves (no SVG: scripts). */
const LOCAL_IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i

/** Host route that streams a whitelisted local image by absolute path. */
function assetUrl(abs: string): string {
  return '/dsh-file-trace/asset?path=' + encodeURIComponent(abs.replace(/\\/g, '/'))
}

/** Resolve one embed target against the traced file's directory. */
function resolveLocal(target: string, baseDir: string | undefined): string | undefined {
  if (/^([a-z]:[\\/]|\\\\|\/)/i.test(target)) return target
  if (baseDir === undefined) return undefined
  return baseDir.replace(/[\\/]+$/, '') + '/' + target.replace(/^[.][/]/, '')
}

/** One parsed block of the document tree. */
type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'para'; readonly text: string }
  | { readonly kind: 'code'; readonly lang: string; readonly text: string }
  | { readonly kind: 'frontmatter'; readonly text: string }
  | { readonly kind: 'math'; readonly text: string }
  | { readonly kind: 'hr' }
  | { readonly kind: 'quote'; readonly blocks: readonly Block[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly ListItem[] }
  | { readonly kind: 'table'; readonly align: readonly string[]; readonly rows: readonly string[][] }

/** One list item: nested blocks plus the task checkbox state, if any. */
interface ListItem { readonly blocks: readonly Block[]; readonly task: boolean; readonly checked: boolean }

/** Match an ATX heading line; capture level and text. */
const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/
/** Match a thematic break line (---, ***, ___ with three or more). */
const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:[ _][ \t]*){3,})$/
/** Match a fenced-code opening line; capture the marker run and info text. */
const FENCE_RE = /^ {0,3}(\x60{3,}|~{3,})\s*(.*)$/
/** Match a blockquote marker line; capture the content after '>'. */
const QUOTE_RE = /^ {0,3}>\s?(.*)$/
/** Match a bullet list item line. */
const BULLET_RE = /^(\s*)([-*+])(\s+)(.*)$/
/** Match an ordered list item line. */
const ORDERED_RE = /^(\s*)(\d{1,9})([.)])(\s+)(.*)$/
/** Match a GFM table delimiter row (e.g. | :--- | ---: |). */
const TABLE_DELIM_RE = /^\s*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?\s*$/
/** Match a task-item checkbox prefix. */
const TASK_RE = /^\[([ xX])\]\s+/
/** Match a footnote definition line; capture id and first text line. */
const FOOTDEF_RE = /^\[\^([^\]\s]+)\]:\s?(.*)$/
/** Regex special characters escaped for RegExp construction. */
const RE_ESCAPE = /[.*+?^$()|[\]{}\\]/g

/** Visible width of a string with tabs expanded to 4 columns. */
function indentWidth(s: string): number {
  let w = 0
  for (const ch of s) w += ch === '\t' ? 4 - (w % 4) : 1
  return w
}

/** True when a line starts a block that interrupts a paragraph. */
function interruptsParagraph(line: string): boolean {
  return line.trim() === ''
    || HEADING_RE.test(line)
    || HR_RE.test(line)
    || FENCE_RE.test(line)
    || QUOTE_RE.test(line)
    || BULLET_RE.test(line)
    || ORDERED_RE.test(line)
}

/** Split one table row on unescaped pipes; drops the wrapping border pipes. */
function splitRow(line: string): string[] {
  const cells = line.replace(/\\\|/g, '\u0000').split('|').map(c => c.replace(/\u0000/g, '|').trim())
  if (cells.length > 1 && cells[0] === '') cells.shift()
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
  return cells
}

/** Parsed footnote set: the body with definitions removed, definition ids in
 * first-appearance order, and each definition's text. */
interface FootnoteSet { readonly body: string; readonly ids: readonly string[]; readonly texts: ReadonlyMap<string, string> }

/** Extract footnote definitions (with indented continuations) from the body. */
function extractFootnotes(src: string): FootnoteSet {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const ids: string[] = []
  const texts = new Map<string, string>()
  const kept: string[] = []
  let i = 0
  while (i < lines.length) {
    const m = lines[i]!.match(FOOTDEF_RE)
    if (m === null) { kept.push(lines[i]!); i += 1; continue }
    const id = m[1]!
    const parts = [m[2] ?? '']
    i += 1
    while (i < lines.length && /^(\s{4,}|\t)\S/.test(lines[i]!)) {
      parts.push(lines[i]!.trim())
      i += 1
    }
    if (!texts.has(id)) ids.push(id)
    texts.set(id, parts.join(' '))
  }
  return { body: kept.join('\n'), ids, texts }
}

/**
 * Parse markdown source into a block tree (Obsidian-flavored subset).
 * @param src - the full markdown text.
 * @returns the top-level blocks in order.
 */
export function parseBlocks(src: string): readonly Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  // YAML frontmatter: a '---' first line closed by the next '---'.
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    let j = 1
    while (j < lines.length && lines[j]!.trim() !== '---') j += 1
    if (j < lines.length) {
      blocks.push({ kind: 'frontmatter', text: lines.slice(1, j).join('\n') })
      i = j + 1
    }
  }
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') { i += 1; continue }

    // Math block: $$ opens (and may close on the same line).
    if (line.trim().startsWith('$$')) {
      const first = line.trim()
      const parts: string[] = []
      if (first.endsWith('$$') && first.length > 4) {
        parts.push(first.slice(2, -2))
        i += 1
      } else {
        if (first.length > 2) parts.push(first.slice(2))
        i += 1
        while (i < lines.length && !lines[i]!.trim().endsWith('$$')) {
          parts.push(lines[i]!)
          i += 1
        }
        if (i < lines.length) {
          const last = lines[i]!.trim()
          parts.push(last.slice(0, last.length - 2))
          i += 1
        }
      }
      blocks.push({ kind: 'math', text: parts.join('\n').trim() })
      continue
    }

    const fence = line.match(FENCE_RE)
    if (fence !== null) {
      const marker = fence[1]!
      const ch = marker[0]!
      const count = marker.length
      const body: string[] = []
      i += 1
      while (i < lines.length) {
        const t = lines[i]!.trim()
        const tCount = t.length - t.replaceAll(ch, '').length
        if (tCount === t.length && tCount >= count) break
        body.push(lines[i]!)
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push({ kind: 'code', lang: (fence[2] ?? '').trim(), text: body.join('\n') })
      continue
    }

    if (HR_RE.test(line)) { blocks.push({ kind: 'hr' }); i += 1; continue }

    const heading = line.match(HEADING_RE)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2] ?? '' })
      i += 1
      continue
    }

    if (QUOTE_RE.test(line)) {
      const body: string[] = []
      while (i < lines.length) {
        const m = lines[i]!.match(QUOTE_RE)
        if (m !== null) { body.push(m[1]!); i += 1; continue }
        // Lazy continuation: a non-blank plain line extends the quote.
        if (lines[i]!.trim() !== '' && body.length > 0 && !interruptsParagraph(lines[i]!)) {
          body.push(lines[i]!)
          i += 1
          continue
        }
        break
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(body.join('\n')) })
      continue
    }

    const bullet = line.match(BULLET_RE)
    const orderedM = line.match(ORDERED_RE)
    if (bullet !== null || orderedM !== null) {
      const isOrdered = orderedM !== null
      const firstM = isOrdered ? orderedM! : bullet!
      const indent = indentWidth(firstM[1]!)
      const markerW = isOrdered ? firstM[2]!.length + 1 : 1
      const contentIndent = indent + markerW + 1
      const start = isOrdered ? Number(firstM[2]) : 1
      const items: ListItem[] = []
      while (i < lines.length) {
        const mb = lines[i]!.match(BULLET_RE)
        const mo = lines[i]!.match(ORDERED_RE)
        const m = isOrdered ? mo : mb
        // A sibling item must carry the same marker family at the same indent.
        if (m === null || indentWidth(m[1]!) !== indent) break
        const first = m[m.length - 1]!
        i += 1
        const body: string[] = []
        const taskMatch = first.match(TASK_RE)
        const task = taskMatch !== null
        const checked = task && taskMatch![1]!.toLowerCase() === 'x'
        body.push(task ? first.slice(taskMatch![0]!.length) : first)
        while (i < lines.length) {
          const cont = lines[i]!
          if (cont.trim() === '') {
            let j = i + 1
            while (j < lines.length && lines[j]!.trim() === '') j += 1
            const next = j < lines.length ? lines[j]! : ''
            const nextIndent = indentWidth(next.match(/^(\s*)/)![1]!)
            const nextIsItem = BULLET_RE.test(next) || ORDERED_RE.test(next)
            if (next.trim() !== '' && (nextIndent >= contentIndent || nextIsItem)) { body.push(''); i += 1; continue }
            break
          }
          if (indentWidth(cont.match(/^(\s*)/)![1]!) >= contentIndent) {
            body.push(cont.trimStart())
            i += 1
            continue
          }
          if (BULLET_RE.test(cont) || ORDERED_RE.test(cont) || FENCE_RE.test(cont) || HEADING_RE.test(cont) || HR_RE.test(cont) || QUOTE_RE.test(cont)) break
          // Lazy paragraph continuation of this item.
          body.push(cont.trimStart())
          i += 1
        }
        items.push({ blocks: parseBlocks(body.join('\n')), task, checked })
      }
      blocks.push({ kind: 'list', ordered: isOrdered, start, items })
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_DELIM_RE.test(lines[i + 1]!)) {
      const header = splitRow(line)
      const align = splitRow(lines[i + 1]!).map((c) => {
        const left = c.startsWith(':')
        const right = c.endsWith(':')
        return left && right ? 'center' : right ? 'right' : 'left'
      })
      i += 2
      const rows: string[][] = [header]
      while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|')) {
        rows.push(splitRow(lines[i]!))
        i += 1
      }
      blocks.push({ kind: 'table', align, rows })
      continue
    }

    // Paragraph: accumulate until a blank line or an interrupting block.
    const para: string[] = [line]
    i += 1
    while (i < lines.length && !interruptsParagraph(lines[i]!)
      && !(lines[i]!.includes('|') && i + 1 < lines.length && TABLE_DELIM_RE.test(lines[i + 1]!))) {
      para.push(lines[i]!)
      i += 1
    }
    blocks.push({ kind: 'para', text: para.join('\n') })
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

/** Emphasis markers applied by the inline scanner, longest first. */
const EMPHASIS: ReadonlyArray<{ readonly marker: string; readonly tags: readonly string[] }> = [
  { marker: '***', tags: ['strong', 'em'] },
  { marker: '___', tags: ['strong', 'em'] },
  { marker: '**', tags: ['strong'] },
  { marker: '__', tags: ['strong'] },
  { marker: '~~', tags: ['s'] },
  { marker: '==', tags: ['mark'] },
  { marker: '*', tags: ['em'] },
  { marker: '_', tags: ['em'] },
]

/** Escape a literal marker for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(RE_ESCAPE, '\\$&')
}

/** One attribute value of a raw HTML tag (double or single quoted). */
function attrOf(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"', 'i'))
    ?? tag.match(new RegExp("\\s" + name + "\\s*=\\s*'([^']*)'", 'i'))
  return m?.[1]
}

/** One inline image: loadable URLs render; local image files render through
 * the host asset route; anything else falls back to a file chip. */
function renderEmbed(target: string, alt: string, key: string, rctx: Rctx, width?: string): ReactNode {
  const name = (target.split(/[\\/]/).pop() || alt || target).split('?')[0]!
  if (isLoadableImage(target)) {
    return <img key={key} src={target} alt={alt || name} className={css.mdImg} loading="lazy" />
  }
  if (LOCAL_IMAGE_RE.test(target)) {
    const abs = resolveLocal(target, rctx.baseDir)
    if (abs !== undefined) {
      return <img key={key} src={assetUrl(abs)} alt={alt || name} className={css.mdImg} loading="lazy" style={width !== undefined ? { width: Number(width) || undefined } : undefined} />
    }
  }
  return <span key={key} className={css.mdFileChip} title={target}><span aria-hidden>🗎</span> {name}</span>
}

/**
 * Render one text run as inline nodes: emphasis, code spans, links, embeds,
 * math, footnotes and raw <img> tags.
 * @param text - the raw inline text.
 * @param keyBase - stable React key prefix for produced nodes.
 * @param rctx - rendering context (base directory, footnote numbers).
 * @returns the inline nodes in order.
 */
export function renderInline(text: string, keyBase = 'i', rctx: Rctx = {}): readonly ReactNode[] {
  const nodes: ReactNode[] = []
  let buf = ''
  let k = 0
  const flush = (): void => {
    if (buf !== '') { nodes.push(buf); buf = '' }
  }
  const key = (): string => keyBase + '-' + String(k++)
  let pos = 0
  while (pos < text.length) {
    const rest = text.slice(pos)
    const ch = text[pos]!
    // Backslash escape of an inline punctuation char.
    if (ch === '\\' && pos + 1 < text.length && /[\\\x60*_{}[\]()#+\-.!~>|=$]/.test(text[pos + 1]!)) {
      buf += text[pos + 1]!
      pos += 2
      continue
    }
    // Code span: a same-length run closes it.
    if (ch === '\x60') {
      const m = rest.match(/^(\x60+)([\s\S]*?)\1/)
      if (m !== null) {
        let code = m[2] ?? ''
        if (code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1)
        flush()
        nodes.push(<code key={key()} className={css.mdCode}>{code}</code>)
        pos += m[0].length
        continue
      }
    }
    // Inline math $...$ (no space just inside either delimiter).
    if (ch === '$') {
      const m = rest.match(/^\$(?!\s)([^$\n]*[^\s$])\$/)
      if (m !== null) {
        flush()
        nodes.push(<span key={key()} className={css.mdMath}>{m[1]}</span>)
        pos += m[0].length
        continue
      }
    }
    // Footnote reference [^id].
    if (ch === '[' && rest.startsWith('[^')) {
      const m = rest.match(/^\[\^([^\]\s]+)\]/)
      const num = m !== null ? rctx.footnotes?.get(m[1]!) : undefined
      if (m !== null && num !== undefined) {
        flush()
        nodes.push(<sup key={key()} className={css.mdFtRef} id={'file-trace-ftref-' + String(num)}>{String(num)}</sup>)
        pos += m[0].length
        continue
      }
    }
    // Obsidian wiki embed ![[target]]
    let m: RegExpMatchArray | null = rest.match(/^!\[\[([^\]]+)\]\]/)
    if (m !== null) {
      flush()
      nodes.push(renderEmbed(m[1]!.trim(), '', key(), rctx))
      pos += m[0].length
      continue
    }
    // Obsidian wiki link [[target|label]]
    m = rest.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/)
    if (m !== null) {
      flush()
      const target = m[1]!.trim()
      const label = (m[2] ?? target).trim()
      nodes.push(<span key={key()} className={css.mdWiki} title={target}>{renderInline(label, keyBase + 'w', rctx)}</span>)
      pos += m[0].length
      continue
    }
    // Image ![alt](url)
    m = rest.match(/^!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\)/)
    if (m !== null) {
      flush()
      nodes.push(renderEmbed(m[2]!.trim(), ((m[1] ?? '') + ' ' + (m[3] ?? '')).trim(), key(), rctx))
      pos += m[0].length
      continue
    }
    // Link [text](url)
    m = rest.match(/^\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\)/)
    if (m !== null) {
      flush()
      const href = m[2] ?? ''
      const safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : ''
      nodes.push(
        <a key={key()} className={css.mdLink} href={safe} target="_blank" rel="noreferrer noopener" title={safe || href}>
          {renderInline(m[1] ?? '', keyBase + 'l', rctx)}
        </a>,
      )
      pos += m[0].length
      continue
    }
    // Raw <img> tag: keep only src/width/alt.
    if (ch === '<') {
      m = rest.match(/^<img\s[^>]*\/?>/i)
      if (m !== null) {
        const src = attrOf(m[0], 'src')
        if (src !== undefined && src !== '') {
          flush()
          nodes.push(renderEmbed(src.trim(), attrOf(m[0], 'alt') ?? '', key(), rctx, attrOf(m[0], 'width')))
          pos += m[0].length
          continue
        }
      }
      // Angle autolink <https://...>
      m = rest.match(/^<(https?:\/\/[^\s<>]+)>/)
      if (m !== null) {
        flush()
        nodes.push(<a key={key()} className={css.mdLink} href={m[1]!} target="_blank" rel="noreferrer noopener">{m[1]}</a>)
        pos += m[0].length
        continue
      }
    }
    // Bare autolink.
    if (rest.startsWith('http://') || rest.startsWith('https://')) {
      m = rest.match(/^https?:\/\/[^\s<>()\[\]\x60]+/)
      if (m !== null) {
        flush()
        nodes.push(<a key={key()} className={css.mdLink} href={m[0]} target="_blank" rel="noreferrer noopener">{m[0]}</a>)
        pos += m[0].length
        continue
      }
    }
    // Emphasis runs, longest marker first; '_' stays literal inside words.
    let matched = false
    for (const e of EMPHASIS) {
      if (!rest.startsWith(e.marker)) continue
      if (e.marker.includes('_') && pos > 0 && /\w/.test(text[pos - 1]!)) continue
      const re = new RegExp(escapeRe(e.marker) + '(?=\\S)([\\s\\S]*?\\S)' + escapeRe(e.marker))
      const em = text.slice(pos).match(re)
      if (em === null) continue
      flush()
      let inner: ReactNode = renderInline(em[1]!, keyBase + 'e', rctx)
      for (const tag of e.tags) inner = nest(tag, inner, key())
      nodes.push(inner)
      pos += em[0].length
      matched = true
      break
    }
    if (matched) continue
    buf += ch
    pos += 1
  }
  flush()
  return nodes
}

/** Wrap inline nodes in one emphasis element. */
function nest(tag: string, children: ReactNode, key: string): ReactElement {
  if (tag === 'strong') return <strong key={key}>{children}</strong>
  if (tag === 'em') return <em key={key}>{children}</em>
  if (tag === 's') return <s key={key}>{children}</s>
  return <mark key={key} className={css.mdMark}>{children}</mark>
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

/** Render one block (recursively) as an element. */
function renderBlock(b: Block, key: string, rctx: Rctx): ReactElement {
  switch (b.kind) {
    case 'heading': {
      const Tag = ('h' + String(b.level)) as 'h1'
      return <Tag key={key} className={css.mdHeading} data-level={String(b.level)}>{renderInline(b.text, key, rctx)}</Tag>
    }
    case 'para':
      return <p key={key} className={css.mdP}>{renderInline(b.text, key, rctx)}</p>
    case 'code':
      return (
        <pre key={key} className={css.mdPre} data-lang={b.lang || undefined}>
          <code>{b.text}</code>
        </pre>
      )
    case 'frontmatter':
      return <pre key={key} className={css.mdPre} data-lang="yaml"><code>{b.text}</code></pre>
    case 'math':
      return <div key={key} className={css.mdMathBlock}>{b.text}</div>
    case 'hr':
      return <hr key={key} className={css.mdHr} />
    case 'quote':
      return <blockquote key={key} className={css.mdQuote}>{b.blocks.map((q, n) => renderBlock(q, key + '-' + String(n), rctx))}</blockquote>
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag key={key} className={css.mdList} start={b.ordered && b.start !== 1 ? b.start : undefined}>
          {b.items.map((item, n) => (
            <li key={key + '-' + String(n)} className={css.mdItem} data-task={item.task ? 'true' : undefined}>
              {item.task && <input type="checkbox" checked={item.checked} readOnly className={css.mdTask} />}
              {item.blocks.length === 1 && item.blocks[0]!.kind === 'para'
                ? renderInline(item.blocks[0]!.text, key + '-' + String(n), rctx)
                : item.blocks.map((ib, j) => renderBlock(ib, key + '-' + String(n) + '-' + String(j), rctx))}
            </li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <div key={key} className={css.mdTableWrap}>
          <table className={css.mdTable}>
            <thead>
              <tr>{b.rows[0]!.map((cell, n) => <th key={key + '-h-' + String(n)} style={{ textAlign: b.align[n] === 'right' ? 'right' : b.align[n] === 'center' ? 'center' : 'left' }}>{renderInline(cell, key + 'h' + String(n), rctx)}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.slice(1).map((row, r) => (
                <tr key={key + '-r-' + String(r)}>
                  {row.map((cell, n) => <td key={key + '-r-' + String(r) + '-' + String(n)} style={{ textAlign: b.align[n] === 'right' ? 'right' : b.align[n] === 'center' ? 'center' : 'left' }}>{renderInline(cell, key + 'c' + String(r) + String(n), rctx)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

/** Reading-mode view of one markdown document. */
export function MarkdownView({ src, baseDir }: { readonly src: string; readonly baseDir?: string }): ReactElement {
  const { blocks, footnotes } = useMemo(() => {
    const set = extractFootnotes(src)
    const map = new Map<string, number>()
    set.ids.forEach((id, n) => { map.set(id, n + 1) })
    return { blocks: parseBlocks(set.body), footnotes: { set, map } }
  }, [src])
  const rctx: Rctx = { ...(baseDir === undefined ? {} : { baseDir }), footnotes: footnotes.map }
  return (
    <div className={css.mdBody} data-file-trace-md>
      {blocks.map((b, i) => renderBlock(b, String(i), rctx))}
      {footnotes.set.ids.length > 0 && (
        <section key="footnotes" className={css.mdFootnotes}>
          {footnotes.set.ids.map((id, n) => (
            <div key={'ft-' + String(n)} className={css.mdFtItem} id={'file-trace-ft-' + String(n + 1)}>
              <span className={css.mdFtNum}>{String(n + 1)}.</span>
              {renderInline(footnotes.set.texts.get(id) ?? '', 'ft' + String(n), rctx)}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
