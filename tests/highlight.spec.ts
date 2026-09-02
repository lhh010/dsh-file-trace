/** highlight: language detection and line tokenization. */
import { describe, expect, it } from 'vitest'
import { langOfPath, tokenizeLine, scanLine, isColored, hasBlockComment } from '../src/client/highlight.ts'

describe('langOfPath', () => {
  it('maps common extensions and stays case-insensitive', () => {
    expect(langOfPath('src/main.cpp')).toBe('cpp')
    expect(langOfPath('Main.JAVA')).toBe('java')
    expect(langOfPath('run.cmd')).toBe('cmd')
    expect(langOfPath('a/b/c.ts')).toBe('ts')
    expect(langOfPath('C:\\dir\\x.ps1')).toBe('ps1')
  })

  it('yields undefined for dotfiles and unknown extensions', () => {
    expect(langOfPath('.gitignore')).toBeUndefined()
    expect(langOfPath('data.xyz')).toBeUndefined()
    expect(langOfPath('noext')).toBeUndefined()
  })
})

/** Shorthand: joined (text, type) pairs of one line's tokens. */
function pairs(line: string, lang: string | undefined) {
  return tokenizeLine(line, lang).map(t => [t.text, t.type])
}

describe('langOfPath: v0.2.1 additions', () => {
  it('maps the JS/TS module suffixes to their families', () => {
    expect(langOfPath('tool/config.mjs')).toBe('mjs')
    expect(langOfPath('tool/config.cjs')).toBe('cjs')
    expect(langOfPath('src/env.mts')).toBe('mts')
    expect(langOfPath('src/env.cts')).toBe('cts')
  })

  it('maps markup, style and graphql suffixes', () => {
    expect(langOfPath('site/index.html')).toBe('html')
    expect(langOfPath('site/logo.svg')).toBe('svg')
    expect(langOfPath('app/App.vue')).toBe('vue')
    expect(langOfPath('data/feed.xml')).toBe('xml')
    expect(langOfPath('style/main.css')).toBe('css')
    expect(langOfPath('style/theme.scss')).toBe('scss')
    expect(langOfPath('style/vars.less')).toBe('less')
    expect(langOfPath('api/schema.graphql')).toBe('graphql')
    expect(langOfPath('api/query.gql')).toBe('gql')
    expect(langOfPath('cfg/settings.jsonc')).toBe('jsonc')
  })
})

describe('tokenizeLine: CSS / markup', () => {
  it('colors CSS block comments, hyphenated properties, strings and hex numbers', () => {
    const toks = tokenizeLine('body { color: #333; background-color: var(--fg); content: "x" }', 'css')
    expect(toks).toContainEqual(expect.objectContaining({ text: 'body', type: 'keyword' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: 'color', type: 'keyword' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: 'background-color', type: 'keyword' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: '"x"', type: 'string' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: '333', type: 'number' }))
    const cmt = tokenizeLine('/* one line comment */ body', 'css')
    expect(cmt[0]).toMatchObject({ text: '/* one line comment */', type: 'comment' })
  })

  it('threads CSS block comments across lines', () => {
    expect(hasBlockComment('css')).toBe(true)
    const open = scanLine('/* starts here', 'css')
    expect(open.inBlock).toBe(true)
    expect(open.tokens[0]).toMatchObject({ type: 'comment' })
    const close = scanLine('ends here */ p {}', 'css', true)
    expect(close.tokens[0]).toMatchObject({ type: 'comment' })
    expect(close.tokens).toContainEqual(expect.objectContaining({ text: 'p', type: 'keyword' }))
  })

  it('colors markup comments, tags and attributes', () => {
    const toks = tokenizeLine('<div class="box">hi</div>', 'html')
    expect(toks).toContainEqual(expect.objectContaining({ text: 'div', type: 'keyword' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: 'class', type: 'keyword' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: '"box"', type: 'string' }))
    const cmt = tokenizeLine('<!-- header -->', 'html')
    expect(cmt[0]).toMatchObject({ text: '<!-- header -->', type: 'comment' })
    expect(hasBlockComment('html')).toBe(true)
  })

  it('colors mjs like js (import/await keywords)', () => {
    const toks = tokenizeLine('const x = await import("./mod.js")', 'mjs')
    expect(toks).toContainEqual(expect.objectContaining({ text: 'const', type: 'keyword' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: 'await', type: 'keyword' }))
    // keywords win over the call-site function rule
    expect(toks).toContainEqual(expect.objectContaining({ text: 'import', type: 'keyword' }))
  })
})

describe('langOfPath: tex/latex', () => {
  it('maps tex/latex/sty/cls/bib suffixes', () => {
    expect(langOfPath('docs/paper.tex')).toBe('tex')
    expect(langOfPath('docs/paper.latex')).toBe('latex')
    expect(langOfPath('style.sty')).toBe('sty')
    expect(langOfPath('class.cls')).toBe('cls')
    expect(langOfPath('refs.bib')).toBe('bib')
  })
})

describe('tokenizeLine: LaTeX (TeXstudio-style)', () => {
  it('colors % comments to end of line', () => {
    const toks = tokenizeLine('% this is a comment', 'tex')
    expect(toks[0]).toMatchObject({ text: '% this is a comment', type: 'comment' })
  })

  it('colors \\commands as macro tokens', () => {
    const toks = tokenizeLine('\\documentclass{article}', 'tex')
    expect(toks).toContainEqual(expect.objectContaining({ text: '\\documentclass', type: 'macro' }))
  })

  it('colors inline $math$ and display $$math$$ as string', () => {
    const toks = tokenizeLine('the value $x^2 + y$ here', 'tex')
    expect(toks).toContainEqual(expect.objectContaining({ text: '$x^2 + y$', type: 'string' }))
    const d = tokenizeLine('display $$E=mc^2$$ end', 'tex')
    expect(d).toContainEqual(expect.objectContaining({ text: '$$E=mc^2$$', type: 'string' }))
  })

  it('colors display-math \\[ and \\( delimiters as string', () => {
    const toks = tokenizeLine('text \\[ E=mc^2 \\] tail', 'tex')
    expect(toks).toContainEqual(expect.objectContaining({ text: '\\[', type: 'string' }))
  })

  it('colors { } braces as type (structure)', () => {
    const toks = tokenizeLine('{\\bfseries bold text}', 'tex')
    expect(toks).toContainEqual(expect.objectContaining({ text: '{', type: 'type' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: '}', type: 'type' }))
  })

  it('colors keywords like document inside braces', () => {
    const toks = tokenizeLine('\\begin{document}', 'tex')
    expect(toks).toContainEqual(expect.objectContaining({ text: '\\begin', type: 'macro' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: 'document', type: 'keyword' }))
  })

  it('colors & alignment and ^ _ scripts as type', () => {
    const toks = tokenizeLine('a & b & c_x^y', 'tex')
    expect(toks).toContainEqual(expect.objectContaining({ text: '&', type: 'type' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: '^', type: 'type' }))
    expect(toks).toContainEqual(expect.objectContaining({ text: '_', type: 'type' }))
  })
})
describe('tokenizeLine', () => {
  it('colors a C++ line: keyword, type, function, string, number, comment', () => {
    const toks = pairs('int main() { std::string s = "hi"; return 42; } // done', 'cpp')
    expect(toks).toContainEqual(['int', 'keyword'])
    expect(toks).toContainEqual(['return', 'keyword'])
    expect(toks).toContainEqual(['main', 'function'])
    expect(toks).toContainEqual(['"hi"', 'string'])
    expect(toks).toContainEqual(['42', 'number'])
    expect(toks).toContainEqual(['// done', 'comment'])
  })

  it('colors C++ preprocessor directives as macro', () => {
    const toks = pairs('#include <cstdio>', 'cpp')
    expect(toks[0]).toEqual(['#include', 'macro'])
  })

  it('colors Java keywords, types, and a javadoc comment', () => {
    const toks = pairs('public class Foo extends Bar { /* x */', 'java')
    expect(toks).toContainEqual(['public', 'keyword'])
    expect(toks).toContainEqual(['Foo', 'type'])
    expect(toks.at(-1)).toEqual(['/* x */', 'comment'])
  })

  it('colors batch keywords and REM/:: comments', () => {
    expect(pairs(':: setup', 'cmd')).toEqual([[':: setup', 'comment']])
    expect(pairs('REM cleanup', 'cmd')).toEqual([['REM cleanup', 'comment']])
    const toks = pairs('if not defined VERBOSE echo off', 'cmd')
    expect(toks).toContainEqual(['if', 'keyword'])
    expect(toks).toContainEqual(['not', 'keyword'])
    expect(toks).toContainEqual(['defined', 'keyword'])
    expect(toks).toContainEqual(['echo', 'keyword'])
  })

  it('colors python keywords and literals', () => {
    const toks = pairs('def f(x): return None if True else 0', 'py')
    expect(toks).toContainEqual(['def', 'keyword'])
    expect(toks).toContainEqual(['None', 'keyword'])
    expect(toks).toContainEqual(['0', 'number'])
    expect(toks).toContainEqual(['f', 'function'])
  })

  it('colors quoted strings and numbers in json', () => {
    const toks = pairs('"key": 42,', 'json')
    expect(toks).toContainEqual(['"key"', 'string'])
    expect(toks).toContainEqual(['42', 'number'])
  })

  it('treats unknown languages as plain', () => {
    expect(tokenizeLine('int x = 1;', undefined)).toEqual([{ text: 'int x = 1;', type: 'plain' }])
  })

  it('handles escaped quotes inside strings without splitting', () => {
    const toks = tokenizeLine("const s = 'a\\'b'", 'ts')
    const str = toks.find(t => t.type === 'string')
    expect(str?.text).toBe("'a\\'b'")
  })
})

describe('scanLine block-comment threading', () => {
  it('colors interior and closing lines of a multi-line comment', () => {
    const open = scanLine('/* header', 'ts')
    expect(open.inBlock).toBe(true)
    expect(open.tokens).toEqual([{ text: '/* header', type: 'comment' }])
    const mid = scanLine(' * Graceful helper text', 'ts', true)
    expect(mid.tokens).toEqual([{ text: ' * Graceful helper text', type: 'comment' }])
    expect(mid.inBlock).toBe(true)
    const close = scanLine(' */', 'ts', true)
    expect(close.inBlock).toBe(false)
    expect(close.tokens).toEqual([{ text: ' */', type: 'comment' }])
  })

  it('resumes code after the close marker on the same line', () => {
    const r = scanLine(' */ const x = 1', 'ts', true)
    expect(r.tokens).toEqual([
      { text: ' */', type: 'comment' },
      { text: ' ', type: 'plain' },
      { text: 'const', type: 'keyword' },
      { text: ' x = ', type: 'plain' },
      { text: '1', type: 'number' },
    ])
  })

  it('reports no block state for languages without block comments', () => {
    expect(scanLine('# note', 'py', true).inBlock).toBe(false)
  })
})

describe('isColored', () => {
  it('marks only color-carrying token types', () => {
    expect(isColored({ text: 'x', type: 'keyword' })).toBe(true)
    expect(isColored({ text: 'x', type: 'plain' })).toBe(false)
  })
})