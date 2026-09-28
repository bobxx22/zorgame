import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, plainText, safeHref } from './markdown'

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

  it('keeps a wrapped list item whole, as in the part 1 text', () => {
    const md = [
      'Вручну:',
      '',
      '1. До просвіту ви відкриваєте клієнт раз на кілька годин, не рідше ніж раз',
      '   на 10 годин.',
      '2. Клієнт показує шум.',
      '- пункт **жирно',
      'далі** без відступу',
      '',
      'Абзац.',
    ].join('\n')
    expect(parseMarkdown(md)).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'Вручну:' }] },
      {
        t: 'ol',
        start: 1,
        items: [
          [{ t: 'text', v: 'До просвіту ви відкриваєте клієнт раз на кілька годин, не рідше ніж раз на 10 годин.' }],
          [{ t: 'text', v: 'Клієнт показує шум.' }],
        ],
      },
      { t: 'ul', items: [[{ t: 'text', v: 'пункт ' }, { t: 'strong', c: [{ t: 'text', v: 'жирно далі' }] }, { t: 'text', v: ' без відступу' }]] },
      { t: 'p', c: [{ t: 'text', v: 'Абзац.' }] },
    ])
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

describe('plainText', () => {
  it('keeps the words of links, bold and code without the marks', () => {
    expect(plainText('Поруч: [легенда](https://zoria.net/lore/legend/), **оцінювання** і `GET /stages`.')).toBe(
      'Поруч: легенда, оцінювання і GET /stages.',
    )
    // An excerpt cut inside a link keeps its words, not the marks.
    expect(plainText('Поруч: [легенда](https://zoria.net/lore/legend/), [специфі')).toBe('Поруч: легенда, специфі…')
    expect(plainText('див. [обрізане посилання](https://zoria.net/sp')).toBe('див. обрізане посилання…')
    expect(plainText('масив [1, 2] і далі')).toBe('масив [1, 2] і далі')
    // The part 2 excerpt: a heading, a sentence and a table cut in its row.
    const excerpt = '## 1. Що видано\n\nДруга частина дає гру цілком.\n\n| Документ | Що в ньому |\n|---|---|\n| 01-rules.md | правил'
    expect(plainText(excerpt)).toBe('1. Що видано Друга частина дає гру цілком.')
    // ... and as the server sends it: one line.
    const oneLine = '1. Що видано Друга частина дає гру цілком. | Документ | Що в ньому | |---|---| | 01-rules.md | правил'
    expect(plainText(oneLine)).toBe('Що видано Друга частина дає гру цілком.')
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

  it('reads a pipe table and keeps a drawing line by line instead of one paragraph', () => {
    const source = [
      'Поле:',
      '| Що | Значення |',
      '|---|:---:|',
      '| Строк | у [календарі](https://zoria.net/reference/calendar/) |',
      '| `a|b` | x \\| y | зайве |',
      '| коротко |',
      'Далі текст.',
      '+--+',
      '|ab|',
      '+--+',
      '┌─┐ схема',
      '| без | лінійки |',
    ].join('\n')
    const text = (v: string) => [{ t: 'text', v }]
    expect(parseMarkdown(source)).toEqual([
      { t: 'p', c: text('Поле:') },
      {
        t: 'table',
        head: [text('Що'), text('Значення')],
        rows: [
          [text('Строк'), [{ t: 'text', v: 'у ' }, { t: 'link', href: 'https://zoria.net/reference/calendar/', c: text('календарі') }]],
          [[{ t: 'code', v: 'a|b' }], text('x | y')],
          [text('коротко'), []],
        ],
      },
      { t: 'p', c: text('Далі текст.') },
      { t: 'pre', v: '+--+\n|ab|\n+--+\n┌─┐ схема\n| без | лінійки |' },
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
