/**
 * The Markdown subset of the network (spec 5.6, CL-30): headings # - ####,
 * lists -, * and 1., paragraphs, **bold**, `code`, fenced code blocks and
 * [text](url) links. Everything else is plain text; HTML is never interpreted,
 * and only http(s) links become links. The result is a tree that React renders
 * as text nodes, so no markup from a body ever reaches the DOM as HTML.
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

    const heading = HEADING.exec(line)
    if (heading) {
      const level = (heading[1] ?? '#').length as 1 | 2 | 3 | 4
      blocks.push({ t: 'h', level, c: parseInline((heading[2] ?? '').trim()) })
      i += 1
      continue
    }

    if (BULLET.test(line)) {
      const items: Inline[][] = []
      while (i < lines.length) {
        const m = BULLET.exec(lines[i] ?? '')
        if (!m) break
        items.push(parseInline(m[1] ?? ''))
        i += 1
      }
      blocks.push({ t: 'ul', items })
      continue
    }

    const ordered = ORDERED.exec(line)
    if (ordered) {
      const items: Inline[][] = []
      const start = Number(ordered[1])
      while (i < lines.length) {
        const m = ORDERED.exec(lines[i] ?? '')
        if (!m) break
        items.push(parseInline(m[2] ?? ''))
        i += 1
      }
      blocks.push({ t: 'ol', start, items })
      continue
    }

    const paragraph: string[] = []
    while (i < lines.length) {
      const next = lines[i] ?? ''
      if (next.trim() === '' || FENCE.test(next) || HEADING.test(next) || BULLET.test(next) || ORDERED.test(next)) break
      paragraph.push(next.trim())
      i += 1
    }
    blocks.push({ t: 'p', c: parseInline(paragraph.join(' ')) })
  }

  return blocks
}
