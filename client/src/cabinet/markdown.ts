/**
 * The Markdown subset of the network (spec 5.6, CL-30): headings # - ####,
 * lists -, * and 1., paragraphs, **bold**, `code`, fenced code blocks and
 * [text](url) links. Everything else is plain text; HTML is never interpreted,
 * and only http(s) links become links. The result is a tree that React renders
 * as text nodes, so no markup from a body ever reaches the DOM as HTML.
 *
 * A few readings beyond the subset keep long texts usable: a pipe table with
 * its `|---|` line is a table; other lines of a drawing (starting with `|` or
 * `+-`, or with box-drawing characters) stay as they are in a preformatted
 * block instead of melting into one paragraph; a wrapped list item stays
 * whole; a bare http(s) address is a link.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }

export type Block =
  | { t: 'h'; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] }
  | { t: 'pre'; v: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

export function safeHref(raw: string): string | null {
  const value = raw.trim()
  if (!/^https?:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function pushText(out: Inline[], v: string): void {
  if (v === '') return
  const last = out[out.length - 1]
  if (last?.t === 'text') last.v += v
  else out.push({ t: 'text', v })
}

const LINK_TEXT_MAX = 300
const LINK_URL_MAX = 2_000

/**
 * `[text](url)` starting at `i`. The url may hold balanced parentheses; both
 * parts are searched within a bound, so a long body full of `[` stays linear.
 */
function readLink(source: string, i: number): { text: string; url: string; end: number } | null {
  const close = source.slice(i + 1, i + 2 + LINK_TEXT_MAX).indexOf(']')
  if (close <= 0) return null
  const textEnd = i + 1 + close
  const text = source.slice(i + 1, textEnd)
  if (text.includes('\n') || source.charAt(textEnd + 1) !== '(') return null
  let depth = 0
  for (let j = textEnd + 2; j < source.length && j - textEnd - 2 <= LINK_URL_MAX; j += 1) {
    const c = source.charAt(j)
    if (/\s/.test(c)) return null
    if (c === '(') depth += 1
    else if (c === ')') {
      if (depth === 0) {
        const url = source.slice(textEnd + 2, j)
        return url ? { text, url, end: j + 1 } : null
      }
      depth -= 1
    }
  }
  return null
}

const URL_MAX = 2_000

/** A bare http(s) address at `i`, after a non-word character; trailing punctuation stays text. */
function readBareUrl(source: string, i: number): { href: string; text: string; end: number } | null {
  const head = source.slice(i, i + 8).toLowerCase()
  if (!head.startsWith('http://') && !head.startsWith('https://')) return null
  if (i > 0 && /[\p{L}\p{N}_/]/u.test(source.charAt(i - 1))) return null
  let end = i
  while (end < source.length && end - i < URL_MAX && !/[\s<>"`]/.test(source.charAt(end))) end += 1
  let text = source.slice(i, end)
  // "(see https://a.b/c)." - the closing parenthesis and the full stop belong to the sentence.
  const open = text.split('(').length - 1
  let close = text.split(')').length - 1
  for (;;) {
    const last = text.charAt(text.length - 1)
    if (/[.,;:!?'*]/.test(last)) text = text.slice(0, -1)
    else if (last === ')' && close > open) {
      text = text.slice(0, -1)
      close -= 1
    } else break
  }
  const href = safeHref(text)
  return href && new URL(href).hostname ? { href, text, end: i + text.length } : null
}

export function parseInline(source: string, allowLinks = true): Inline[] {
  const out: Inline[] = []
  // Once a closing mark was not found after some point, it is not searched for again: linear on any input.
  let noTickAfter = Infinity
  let noStarsAfter = Infinity
  let i = 0
  while (i < source.length) {
    if (source.startsWith('`', i) && i < noTickAfter) {
      const end = source.indexOf('`', i + 1)
      if (end < 0) noTickAfter = i
      else if (end > i + 1) {
        out.push({ t: 'code', v: source.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (source.startsWith('**', i) && i < noStarsAfter) {
      const end = source.indexOf('**', i + 2)
      if (end < 0) noStarsAfter = i
      else if (end > i + 2) {
        out.push({ t: 'strong', c: parseInline(source.slice(i + 2, end), allowLinks) })
        i = end + 2
        continue
      }
    }

    if (allowLinks && source.startsWith('[', i)) {
      const link = readLink(source, i)
      if (link) {
        const href = safeHref(link.url)
        if (href) out.push({ t: 'link', href, c: parseInline(link.text, false) })
        else pushText(out, source.slice(i, link.end))
        i = link.end
        continue
      }
    }

    if (allowLinks && (source.charAt(i) === 'h' || source.charAt(i) === 'H')) {
      const bare = readBareUrl(source, i)
      if (bare) {
        out.push({ t: 'link', href: bare.href, c: [{ t: 'text', v: bare.text }] })
        i = bare.end
        continue
      }
    }

    pushText(out, source.charAt(i))
    i += 1
  }
  return out
}

const HEADING = /^(#{1,4})\s+(.*)$/
const BULLET = /^\s*[-*]\s+(.*)$/
// Up to three digits: a line that starts with a year ("2026. Сезон...") is a sentence, not item 2026.
const ORDERED = /^\s*(\d{1,3})\.\s+(.*)$/
const FENCE = /^\s*```/
/** A line of a table or a drawing: kept as is, not joined into a paragraph. */
const DRAWN = /^\s*(?:\||\+[-=+])|[\u2500-\u257f]/

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (line.trim() === '') {
      i += 1
      continue
    }

    if (FENCE.test(line)) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      i += 1 // closing fence, or past the end if it is missing
      blocks.push({ t: 'pre', v: body.join('\n') })
      continue
    }

    if (DRAWN.test(line)) {
      const body: string[] = []
      while (i < lines.length && DRAWN.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      blocks.push(readTable(body) ?? { t: 'pre', v: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = (heading[1] ?? '#').length as 1 | 2 | 3 | 4
      blocks.push({ t: 'h', level, c: parseInline((heading[2] ?? '').trim()) })
      i += 1
      continue
    }

    const list = BULLET.test(line) ? BULLET : ORDERED.test(line) ? ORDERED : null
    if (list) {
      const start = Number(ORDERED.exec(line)?.[1] ?? 1)
      const texts: string[] = []
      while (i < lines.length) {
        const next = lines[i] ?? ''
        const item = list.exec(next)
        if (item) texts.push(item[list === BULLET ? 1 : 2] ?? '')
        // A wrapped item goes on in the next lines, indented or not, until a blank line or another block.
        else if (texts.length > 0 && !startsBlock(next)) texts.push(`${texts.pop() ?? ''} ${next.trim()}`)
        else break
        i += 1
      }
      const items = texts.map((text) => parseInline(text))
      blocks.push(list === BULLET ? { t: 'ul', items } : { t: 'ol', start, items })
      continue
    }

    const paragraph: string[] = []
    while (i < lines.length && !startsBlock(lines[i] ?? '')) {
      paragraph.push((lines[i] ?? '').trim())
      i += 1
    }
    blocks.push({ t: 'p', c: parseInline(paragraph.join(' ')) })
  }

  return blocks
}

const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * A pipe table: every line starts with `|` and the second one is the `|---|`
 * rule. Rows are cut or padded to the header's width. Anything else is null.
 */
function readTable(lines: string[]): Block | null {
  const [head, rule, ...rest] = lines
  if (head === undefined || rule === undefined || !TABLE_RULE.test(rule)) return null
  if (!lines.every((line) => line.trimStart().startsWith('|'))) return null
  const header = tableCells(head)
  const rows = rest.map((line) => {
    const cells = tableCells(line)
    return header.map((_, n) => parseInline(cells[n] ?? ''))
  })
  return { t: 'table', head: header.map((cell) => parseInline(cell)), rows }
}

/** Cells of a table line; `\|` and a `|` inside `code` stay in the cell. */
function tableCells(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  let code = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i)
    if (c === '\\' && text.charAt(i + 1) === '|') {
      cell += '|'
      i += 1
      continue
    }
    if (c === '`') code = !code
    if (c === '|' && !code) {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += c
  }
  cells.push(cell.trim())
  return cells
}

/** The words of a Markdown text without its marks: for a preview inside a link, where a link cannot be one. */
export function plainText(source: string): string {
  // The server cuts an excerpt at its length, sometimes inside a link: "[специфі" or "[текст](https://zo".
  const cut = /\[([^\]\n]*)(?:\]\([^)\s]*)?$/.exec(source)
  const whole = cut ? `${source.slice(0, cut.index)}${cut[1] ?? ''}…` : source
  return inlineText(parseInline(whole))
}

/** The words of parsed inline nodes, marks dropped. */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((node) => (node.t === 'text' || node.t === 'code' ? node.v : inlineText(node.c))).join('')
}

/** A blank line or the start of another block ends a paragraph or a list item. */
function startsBlock(line: string): boolean {
  return (
    line.trim() === '' ||
    FENCE.test(line) ||
    DRAWN.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line)
  )
}
