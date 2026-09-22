import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref } from './markdown'

describe('parseMarkdown (CL-30)', () => {
  it('reads headings, lists, paragraphs and code blocks', () => {
    const md = [
      '# Частина 2',
      '',
      'Перший рядок',
      'другий рядок.',
      '',
      '- один',
      '* два',
      '',
      '3. третій',
      '4. четвертий',
      '',
      '```ts',
      'const x = "<b>";',
      '```',
      '#### Малий',
    ].join('\n')
    expect(parseMarkdown(md)).toEqual([
      { t: 'h', level: 1, c: [{ t: 'text', v: 'Частина 2' }] },
      { t: 'p', c: [{ t: 'text', v: 'Перший рядок другий рядок.' }] },
      { t: 'ul', items: [[{ t: 'text', v: 'один' }], [{ t: 'text', v: 'два' }]] },
      { t: 'ol', start: 3, items: [[{ t: 'text', v: 'третій' }], [{ t: 'text', v: 'четвертий' }]] },
      { t: 'pre', v: 'const x = "<b>";' },
      { t: 'h', level: 4, c: [{ t: 'text', v: 'Малий' }] },
    ])
  })

  it('keeps five hashes and HTML as plain text', () => {
    expect(parseMarkdown('##### not a heading\n<script>alert(1)</script>')).toEqual([
      { t: 'p', c: [{ t: 'text', v: '##### not a heading <script>alert(1)</script>' }] },
    ])
  })

  it('closes an unterminated code block at the end', () => {
    expect(parseMarkdown('```\nline')).toEqual([{ t: 'pre', v: 'line' }])
  })
})

describe('parseInline', () => {
  it('reads bold, code and links', () => {
    expect(parseInline('a **b** `c` [d](https://zoria.net/x)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'c' },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://zoria.net/x', c: [{ t: 'text', v: 'd' }] },
    ])
  })

  it('links only http and https', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ t: 'text', v: '[x](javascript:alert(1))' }])
    expect(parseInline('[x](data:text/html,hi)')).toEqual([{ t: 'text', v: '[x](data:text/html,hi)' }])
    expect(parseInline('[x](//evil.example)')).toEqual([{ t: 'text', v: '[x](//evil.example)' }])
  })

  it('leaves unclosed markers as text and does not bold inside code', () => {
    expect(parseInline('**open `x')).toEqual([{ t: 'text', v: '**open `x' }])
    expect(parseInline('`**x**`')).toEqual([{ t: 'code', v: '**x**' }])
  })
})

describe('safeHref', () => {
  it('accepts http(s) only', () => {
    expect(safeHref('https://github.com/a/b')).toBe('https://github.com/a/b')
    expect(safeHref(' HTTP://zoria.net ')).toBe('http://zoria.net/')
    expect(safeHref('mailto:x@y')).toBeNull()
  })
})
