#!/usr/bin/env node
/*
 * P2-07 and scoring 8.2: no secret reaches the repository.
 *
 * Takes the secret values from where they live outside git - `token` and
 * `auth` of the registry from ~/.zoria-registry.json (the hub's answer) and
 * the application code from client/.env.local - and looks for them in every
 * file git would take, in what is staged and in the whole history, binary
 * files included. Every .npmrc may hold only the ${ZORIA_NPM_AUTH} reference.
 * The values are never printed; exit code 1 on a find.
 *
 *   node scripts/check-secrets.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
const root = git('rev-parse', '--show-toplevel').trim()

const readText = (path) => {
  const text = readFileSync(path, 'utf8')
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/* [what, value]: the value is searched for, only `what` is ever printed */
const secrets = []
const saved = join(homedir(), '.zoria-registry.json')
if (existsSync(saved)) {
  const answer = JSON.parse(readText(saved))
  for (const key of ['token', 'auth']) {
    if (typeof answer[key] === 'string' && answer[key].length >= 16) secrets.push(['секрет реєстру', answer[key]])
  }
} else {
  console.log('~/.zoria-registry.json немає: значень секрету реєстру не знаю, перевіряю лише .npmrc')
}
const envLocal = join(root, 'client', '.env.local')
if (existsSync(envLocal)) {
  const code = /^VITE_ZORIA_INVITATION\s*=\s*"?([^"\r\n]*)"?\s*$/m.exec(readText(envLocal))?.[1]?.trim()
  if (code && code.length >= 8) secrets.push(['код заявки', code])
}
const found = (text) => secrets.find(([, value]) => text.includes(value))?.[0] ?? null

const problems = []
const files = git('-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean)

for (const file of files) {
  const path = join(root, file)
  if (!existsSync(path)) continue
  // bytes as latin1: the values are ASCII, and a binary file is searched as it is
  const what = found(readFileSync(path, 'latin1'))
  if (what) problems.push(`${what} у файлі ${file}`)
  if (basename(file) === '.npmrc') {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const auth = /:_auth(?:Token)?\s*=\s*(.*)$/.exec(line)
      if (auth && auth[1].trim() !== '${ZORIA_NPM_AUTH}') problems.push(`${file}: _auth не посилання на \${ZORIA_NPM_AUTH}`)
    }
  }
}

// --text: without it git prints "Binary files differ" and hides the bytes
const staged = found(git('-C', root, 'diff', '--cached', '--no-color', '--text'))
if (staged) problems.push(`${staged} у підготовленому коміті`)

const history = found(git('-C', root, 'log', '--all', '-p', '--no-color', '--text'))
if (history) problems.push(`${history} в історії репозиторію`)

if (problems.length > 0) {
  for (const problem of problems) console.error(`P2-07: ${problem}`)
  process.exit(1)
}
const kinds = [...new Set(secrets.map(([what]) => what))].join(', ') || 'лише .npmrc'
console.log(`P2-07: чисто (${kinds}; файлів ${files.length}, історія й підготовлений коміт перевірені)`)
