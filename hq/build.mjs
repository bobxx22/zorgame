/* building the show: src -> dist/index.html, one self-contained file

   The show opens in a frame with an opaque origin under connect-src 'none'
   (HQ contract, 1.2 and 6.2): no file next to index.html can be loaded, so the
   code, the styles and the worker all live inside it.

   Two bundles: the worker (the engine and the pass over a journal) is built
   first and handed to the page bundle as text - the page starts workers from a
   blob of it. Then the page bundle and the stylesheet are inlined into the
   markup. */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'src')
const OUT = join(HERE, 'dist')

const common = {
  bundle: true,
  write: false,
  /* HQ_MINIFY=0 keeps the names: for reading a profile of the built show */
  minify: process.env.HQ_MINIFY !== '0',
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
  logLevel: 'warning',
}

async function bundle(entry, format, plugins = []) {
  const result = await build({ ...common, entryPoints: [join(SRC, entry)], format, plugins })
  const file = result.outputFiles[0]
  if (!file) throw new Error('esbuild produced nothing for ' + entry)
  return file.text
}

const worker = await bundle('worker/indexer.ts', 'iife')

/* `virtual:worker` resolves to the worker bundle as a string */
const workerText = {
  name: 'worker-text',
  setup(b) {
    b.onResolve({ filter: /^virtual:worker$/ }, () => ({ path: 'worker', namespace: 'worker-text' }))
    b.onLoad({ filter: /.*/, namespace: 'worker-text' }, () => ({ contents: worker, loader: 'text' }))
  },
}

const page = await bundle('main.ts', 'esm', [workerText])

/* inside a <script> the only thing that may not appear is its own closing tag */
const inline = (code) => code.replace(/<\/script/gi, '<\\/script')

const css = readFileSync(join(SRC, 'style.css'), 'utf8')
const html = readFileSync(join(SRC, 'index.html'), 'utf8')
  .replace(/[ \t]*<link rel="stylesheet"[^>]*>/, () => '    <style>\n' + css + '    </style>')
  .replace(/[ \t]*<script type="module" src="[^"]*"><\/script>/, () => '    <script type="module">\n' + inline(page) + '\n    </script>')

if (html.includes('./style.css') || html.includes('./main.ts')) throw new Error('index.html still points at a file next to it')

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'index.html'), html)
process.stdout.write('show built: ' + join(OUT, 'index.html') + ', ' + Math.round(html.length / 1024) + ' KiB\n')
