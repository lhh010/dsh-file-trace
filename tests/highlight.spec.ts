/** highlight: language detection and line tokenization. */
import { describe, expect, it } from 'vitest'
import { langOfPath, tokenizeLine, scanLine, isColored } from '../src/client/highlight.ts'

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