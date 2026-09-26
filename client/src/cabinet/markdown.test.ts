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

describe('markdown edge cases', () => {
  it('keeps parentheses inside a link address', () => {
    expect(parseInline('див. [вікі](https://uk.wikipedia.org/wiki/Зоря_(значення)).')).toEqual([
      { t: 'text', v: 'див. ' },
      { t: 'link', href: 'https://uk.wikipedia.org/wiki/%D0%97%D0%BE%D1%80%D1%8F_(%D0%B7%D0%BD%D0%B0%D1%87%D0%B5%D0%BD%D0%BD%D1%8F)', c: [{ t: 'text', v: 'вікі' }] },
      { t: 'text', v: '.' },
    ])
  })
  it('stays fast on a long paragraph full of unclosed marks', () => {
    const body = '[a '.repeat(20_000) + '**b '.repeat(20_000) + '`c '.repeat(20_000)
    const started = performance.now()
    parseInline(body)
    expect(performance.now() - started).toBeLessThan(500)
  })
  it('reads a line that starts with a year as a sentence', () => {
    expect(parseMarkdown('2026. Сезон почався.')).toEqual([{ t: 'p', c: [{ t: 'text', v: '2026. Сезон почався.' }] }])
    expect(parseMarkdown('1. раз\n2. два')[0]).toMatchObject({ t: 'ol', start: 1 })
  })

  it('keeps a table or a drawing line by line instead of one paragraph', () => {
    const source = 'Поле:\n| A | B |\n|---|---|\n| 1 | 2 |\nДалі текст.\n+--+\n|ab|\n+--+\n┌─┐ схема'
    expect(parseMarkdown(source)).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'Поле:' }] },
      { t: 'pre', v: '| A | B |\n|---|---|\n| 1 | 2 |' },
      { t: 'p', c: [{ t: 'text', v: 'Далі текст.' }] },
      { t: 'pre', v: '+--+\n|ab|\n+--+\n┌─┐ схема' },
    ])
  })

  it('links a bare http(s) address and leaves the sentence around it', () => {
    expect(parseInline('Див. https://zoria.net/spec/part2/ (або http://a.b/c_(d)).')).toEqual([
      { t: 'text', v: 'Див. ' },
      { t: 'link', href: 'https://zoria.net/spec/part2/', c: [{ t: 'text', v: 'https://zoria.net/spec/part2/' }] },
      { t: 'text', v: ' (або ' },
      { t: 'link', href: 'http://a.b/c_(d)', c: [{ t: 'text', v: 'http://a.b/c_(d)' }] },
      { t: 'text', v: ').' },
    ])
    expect(parseInline('[сайт](https://zoria.net) і `https://x.y`')).toEqual([
      { t: 'link', href: 'https://zoria.net/', c: [{ t: 'text', v: 'сайт' }] },
      { t: 'text', v: ' і ' },
      { t: 'code', v: 'https://x.y' },
    ])
    expect(parseInline('javascript:alert(1) https:// xhttps://a.b')).toEqual([
      { t: 'text', v: 'javascript:alert(1) https:// xhttps://a.b' },
    ])
  })
})
