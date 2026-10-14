// @vitest-environment jsdom
/** markdown: Obsidian-flavored block parsing and reading-mode rendering. */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownView, parseBlocks, renderInline, isMarkdownPath } from '../src/client/markdown.tsx'

afterEach(cleanup)

describe('isMarkdownPath', () => {
  it('accepts md/markdown/mdx and stays case-insensitive', () => {
    expect(isMarkdownPath('README.md')).toBe(true)
    expect(isMarkdownPath('docs/notes.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('a/b/c.mdx')).toBe(true)
    expect(isMarkdownPath('src/main.ts')).toBe(false)
    expect(isMarkdownPath('noext')).toBe(false)
  })
})

describe('parseBlocks', () => {
  it('parses headings, thematic breaks, paragraphs and blank-line separation', () => {
    const blocks = parseBlocks('# Title\n\ntext one\nline two\n\n---\n\n## Sub *em*')
    expect(blocks.map(b => b.kind)).toEqual(['heading', 'para', 'hr', 'heading'])
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1, text: 'Title' })
    expect(blocks[1]).toMatchObject({ kind: 'para', text: 'text one\nline two' })
  })

  it('parses fenced code with a language and keeps interior blank lines', () => {
    const blocks = parseBlocks('```ts\nconst a = 1\n\nconst b = 2\n```\n\nafter')
    expect(blocks[0]).toMatchObject({ kind: 'code', lang: 'ts', text: 'const a = 1\n\nconst b = 2' })
    expect(blocks[1]).toMatchObject({ kind: 'para' })
  })

  it('parses nested blockquotes with lazy continuation', () => {
    const blocks = parseBlocks('> outer\n> > inner\ncontinued')
    expect(blocks[0]).toMatchObject({ kind: 'quote' })
    const quote = blocks[0] as { blocks: readonly { kind: string }[] }
    expect(quote.blocks.map(b => b.kind)).toEqual(['para', 'quote'])
  })

  it('parses nested lists, ordered starts and task checkboxes', () => {
    const blocks = parseBlocks('- a\n  - a1\n- b\n\n3. three\n4. four\n\n- [x] done\n- [ ] todo')
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false })
    const ul = blocks[0] as { items: readonly { blocks: readonly { kind: string }[] }[] }
    // The first item holds its own text paragraph plus the nested sublist.
    expect(ul.items[0]!.blocks.map(b => b.kind)).toEqual(['para', 'list'])
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true, start: 3 })
    const tasks = blocks[2] as { items: readonly { task: boolean; checked: boolean }[] }
    expect(tasks.items.map(i => [i.task, i.checked])).toEqual([[true, true], [true, false]])
  })

  it('parses GFM tables with alignment', () => {
    const blocks = parseBlocks('| L | C | R |\n|:---|:---:|---:|\n| 1 | 2 | 3 |')
    expect(blocks[0]).toMatchObject({ kind: 'table' })
    const table = blocks[0] as { align: readonly string[]; rows: readonly string[][] }
    expect(table.align).toEqual(['left', 'center', 'right'])
    expect(table.rows).toEqual([['L', 'C', 'R'], ['1', '2', '3']])
  })

  it('treats a leading --- block as YAML frontmatter when closed', () => {
    const blocks = parseBlocks('---\ntitle: x\n---\n\nbody')
    expect(blocks[0]).toMatchObject({ kind: 'frontmatter', text: 'title: x' })
  })

  it('treats a leading --- as a thematic break when the closed block has no YAML mapping key', () => {
    // A fragment that starts with a divider followed by a heading (and a later
    // divider) must not swallow the heading as frontmatter.
    const blocks = parseBlocks('---\n## Section\nbody\n---\n\n## Next')
    expect(blocks.map((b) => b.kind)).toEqual(['hr', 'heading', 'para', 'hr', 'heading'])
  })

  it('does not treat a closed --- block whose content is prose as frontmatter', () => {
    const blocks = parseBlocks('---\nCorridor verification record text\n---')
    expect(blocks.map((b) => b.kind)).toEqual(['hr', 'para', 'hr'])
  })

  it('parses a raw <svg> block with an optional <?xml?> declaration', () => {
    const src = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">\n  <rect x="30" y="70" width="120" height="60" fill="#4a90d9"/>\n</svg>\n\nafter'
    const blocks = parseBlocks(src)
    expect(blocks.map((b) => b.kind)).toEqual(['svg', 'para'])
    expect(blocks[0]).toMatchObject({ kind: 'svg' })
    expect((blocks[0] as { text: string }).text).toContain('<rect')
  })

  it('leaves an unclosed <svg> opener in the paragraph path', () => {
    const blocks = parseBlocks('<svg xmlns="…">\nno close here')
    expect(blocks.map((b) => b.kind)).toEqual(['para'])
  })

  it('parses a <details> wrapper with a summary and a nested svg block', () => {
    const src = '<details>\n<summary>渲染预览</summary>\n<svg xmlns="http://www.w3.org/2000/svg">\n  <rect x="1" y="1" width="2" height="2"/>\n</svg>\n</details>\n\ntail'
    const blocks = parseBlocks(src)
    expect(blocks.map((b) => b.kind)).toEqual(['details', 'para'])
    const d = blocks[0] as { summary: string; blocks: readonly { kind: string }[] }
    expect(d.summary).toBe('渲染预览')
    expect(d.blocks.map((b) => b.kind)).toEqual(['svg'])
  })
})

describe('renderInline', () => {
  /** Node kinds of the produced array, flattening nothing. */
  const kinds = (text: string) => renderInline(text).map(n => typeof n === 'string' ? 'text' : (n as { type: string }).type)

  it('emits strong/em/s/mark elements for emphasis markers', () => {
    expect(kinds('a **b** c')).toEqual(['text', 'strong', 'text'])
    expect(kinds('__b__')).toEqual(['strong'])
    // Bold-italic nests as <em><strong>; the outermost element is em.
    expect(kinds('***bi***')).toEqual(['em'])
    expect(kinds('x ~~gone~~ y')).toEqual(['text', 's', 'text'])
    expect(kinds('==hl==')).toEqual(['mark'])
    expect(kinds('*i*')).toEqual(['em'])
  })

  it('keeps intraword underscores literal (snake_case)', () => {
    expect(kinds('snake_case_name')).toEqual(['text'])
  })

  it('renders code spans and backslash escapes', () => {
    expect(kinds('use `const` now')).toEqual(['text', 'code', 'text'])
    expect(kinds('a \\*not em\\* b')).toEqual(['text'])
  })

  it('routes local svg embeds through the host asset route as <img>', () => {
    const nodes = renderInline('![diagram](./assets/diagram.svg)', 'k', { baseDir: 'E:/work' })
    expect(nodes).toHaveLength(1)
    const img = nodes[0] as { type: string; props: { src: string } }
    expect(img.type).toBe('img')
    expect(img.props.src).toContain('/dsh-file-trace/asset?path=')
    expect(decodeURIComponent(img.props.src)).toContain('E:/work/assets/diagram.svg')
  })
})

describe('MarkdownView', () => {
  it('renders the required document features', () => {
    render(
      <MarkdownView
        src={[
          '# 大标题',
          '',
          'plain **bold** ~~del~~ ==hl== `code` and __bold2__',
          '',
          '---',
          '',
          '> quoted line',
          '',
          '- item one',
          '- item two',
          '',
          '| A | B |',
          '| --- | --- |',
          '| 1 | 2 |',
          '',
          '![logo](https://example.com/a.png)',
          '',
          '![[attachment.pdf]] and [[Some Note|label]]',
        ].join('\n')}
      />,
    )
    expect(screen.getByText('大标题').tagName).toBe('H1')
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('bold2').tagName).toBe('STRONG')
    expect(screen.getByText('del').tagName).toBe('S')
    expect(screen.getByText('hl').tagName).toBe('MARK')
    expect(screen.getByText('code').tagName).toBe('CODE')
    expect(screen.getByText('quoted line').tagName).toBe('P')
    expect(screen.getByText('item one').tagName).toBe('LI')
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.com/a.png')
    // Non-image embed: generic file chip with the file name.
    expect(screen.getByText('attachment.pdf')).toBeTruthy()
    expect(screen.getByText('label')).toBeTruthy()
  })

  it('renders local absolute-path images through the host asset route', () => {
    render(<MarkdownView src={'![鲸鱼](E:\\docs\\frames\\whale.gif)'} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('/dsh-file-trace/asset?path=' + encodeURIComponent('E:/docs/frames/whale.gif'))
  })

  it('resolves relative images against baseDir', () => {
    render(<MarkdownView src={'![a](./img/a.png)'} baseDir={'E:\\docs\\notes'} />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('/dsh-file-trace/asset?path=' + encodeURIComponent('E:/docs/notes/img/a.png'))
  })

  it('renders raw <img> tags with width, angle autolinks and math', () => {
    render(<MarkdownView src={'<img src="E:/pics/x.png" width="400" alt="x"/>\n\n<https://example.com>\n\n$a^2$\n\n$$E = mc^2$$'} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toContain('/dsh-file-trace/asset?path=')
    expect(img.style.width).toBe('400px')
    expect(screen.getByText('https://example.com').tagName).toBe('A')
    expect(screen.getByText('a^2').className).toContain('mdMath')
    expect(screen.getByText('E = mc^2').className).toContain('mdMathBlock')
  })

  it('renders footnote refs as numbers and a bottom section', () => {
    render(<MarkdownView src={'Text with a note[^1] and another[^big].\n\n[^1]: first note\n[^big]: second note'} />)
    expect(screen.getByText('1').tagName).toBe('SUP')
    expect(screen.getByText('2').tagName).toBe('SUP')
    expect(screen.getByText('first note')).toBeTruthy()
    expect(screen.getByText('second note')).toBeTruthy()
  })

  it('renders a mermaid fence as a code block when the chunk cannot load', () => {
    // In jsdom the /dsh-file-trace/resources/mermaid-chunk.js import fails
    // (no server), so the lazy renderer must fall back to the code block.
    const src = ['```mermaid', 'graph TD;', '  A-->B', '```'].join('\n')
    render(<MarkdownView src={src} />)
    const block = document.querySelector('[data-file-trace-md] pre[data-lang="mermaid"]')
    expect(block).not.toBeNull()
    expect(block?.textContent).toContain('graph TD')
  })

  it('falls back to a file chip for local-path images', () => {
    render(<MarkdownView src={'![pic](./images/photo.png)'} />)
    expect(screen.getByText('photo.png')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('renders a raw svg block inside a details wrapper via a blob <img>', async () => {
    // jsdom lacks URL.createObjectURL: stub it so the blob <img> path runs.
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg-test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const src = [
      '<details>',
      '<summary>渲染预览</summary>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">',
      '  <rect x="30" y="70" width="120" height="60" fill="#4a90d9"/>',
      '</svg>',
      '</details>',
    ].join('\n')
    render(<MarkdownView src={src} />)
    expect(screen.getByText('渲染预览').tagName).toBe('SUMMARY')
    await waitFor(() => {
      const host = document.querySelector('[data-svg-state="rendered"]')
      expect(host).not.toBeNull()
      expect(host?.querySelector('img')?.getAttribute('src')).toBe('blob:svg-test')
    })
    create.mockRestore()
    revoke.mockRestore()
  })

  it('degrades non-well-formed svg markup to a source code block', async () => {
    // <rect> never closes: XML mode reports a parsererror → source fallback.
    const src = '<svg xmlns="http://www.w3.org/2000/svg">\n  <rect x="1">\n</svg>'
    render(<MarkdownView src={src} />)
    await waitFor(() => {
      const block = document.querySelector('pre[data-lang="svg"][data-svg-state="invalid"]')
      expect(block).not.toBeNull()
      expect(block?.textContent).toContain('<rect')
    })
  })
})
