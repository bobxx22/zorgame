#!/usr/bin/env node
/*
 * P2-07: the registry secret never reaches the repository.
 *
 * Takes the values of `token` and `auth` from ~/.zoria-registry.json (the
 * hub's answer, kept outside the repository) and looks for them in every file
 * git would take, in what is staged and in the whole history. Every .npmrc
 * may hold only the ${ZORIA_NPM_AUTH} reference. The values are never
 * printed; exit code 1 on a find.
 *
 *   node scripts/check-secrets.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
const root = git('rev-parse', '--show-toplevel').trim()

const saved = join(homedir(), '.zoria-registry.json')
let secrets = []
if (existsSync(saved)) {
  const answer = JSON.parse(readFileSync(saved, 'utf8').replace(/^﻿/, ''))
  secrets = [answer.token, answer.auth].filter((value) => typeof value === 'string' && value.length >= 16)
} else {
  console.log(`~/.zoria-registry.json немає: значень секрету не знаю, перевіряю лише .npmrc`)
}

const problems = []
const files = git('-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean)

for (const file of files) {
  const path = join(root, file)
  if (!existsSync(path)) continue
  const text = readFileSync(path, 'latin1')
  if (secrets.some((secret) => text.includes(secret))) problems.push(`секрет реєстру у файлі ${file}`)
  if (basename(file) === '.npmrc') {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const auth = /:_auth(?:Token)?\s*=\s*(.*)$/.exec(line)
      if (auth && auth[1].trim() !== '${ZORIA_NPM_AUTH}') problems.push(`${file}: _auth не посилання на \${ZORIA_NPM_AUTH}`)
    }
  }
}

const staged = git('-C', root, 'diff', '--cached', '--no-color')
if (secrets.some((secret) => staged.includes(secret))) problems.push('секрет реєстру в підготовленому коміті')

const history = git('-C', root, 'log', '--all', '-p', '--no-color')
if (secrets.some((secret) => history.includes(secret))) problems.push('секрет реєстру в історії репозиторію')

if (problems.length > 0) {
  for (const problem of problems) console.error(`P2-07: ${problem}`)
  process.exit(1)
}
console.log(`P2-07: чисто (файлів ${files.length}, історія й підготовлений коміт перевірені)`)
