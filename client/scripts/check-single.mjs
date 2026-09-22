// Checks the single-file build: one index.html, nothing referenced from
// outside it, so that opening it from disk makes no network request
// (part 3 requirement P3-03).
//
//   node scripts/check-single.mjs [dist-single]

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'dist-single'
const problems = []

const extra = readdirSync(dir).filter((name) => name !== 'index.html')
if (extra.length > 0) problems.push(`next to index.html: ${extra.join(', ')}`)

const html = readFileSync(join(dir, 'index.html'), 'utf8')

// Inlined code and styles may contain such strings themselves; only the markup counts.
const markup = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>')

/** Every src/href that is not inline data: is a request after opening. */
for (const match of markup.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)) {
  const url = match[1] ?? ''
  if (url.startsWith('data:') || url.startsWith('#')) continue
  problems.push(`external reference: ${url.slice(0, 80)}`)
}

// Vite adds these when it splits the bundle; in a single file they must be gone.
for (const marker of ['modulepreload', 'rel="preload"', 'rel="stylesheet"']) {
  if (markup.includes(marker)) problems.push(`split-bundle marker: ${marker}`)
}

const kb = Math.round(statSync(join(dir, 'index.html')).size / 1024)

if (problems.length > 0) {
  console.error(`check-single: ${dir}/index.html is not self-contained`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`check-single: ${dir}/index.html is self-contained, ${kb} KB, opens from disk`)
