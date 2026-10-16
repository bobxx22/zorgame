import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Inlines the favicon so the single-file build asks for nothing after opening
 * (part 3 requirement P3-03: one self-contained index.html, no network requests).
 */
function inlineFavicon(): Plugin {
  return {
    name: 'zoria-inline-favicon',
    transformIndexHtml(html) {
      const svg = readFileSync(fileURLToPath(new URL('./public/favicon.svg', import.meta.url)), 'utf8')
      const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
      return html.replace('/favicon.svg', dataUri)
    },
  }
}

// `--mode single` builds one self-contained index.html that opens from disk:
// module scripts cannot be loaded from file:// (no origin, CORS), so all code
// and styles are inlined into the page.
export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  return {
    base: single ? './' : '/',
    // Nothing is copied next to the page: everything lives inside index.html.
    publicDir: single ? false : 'public',
    plugins: single ? [react(), inlineFavicon(), viteSingleFile()] : [react()],
    // The site's public draw files (who went on, who left) for the roll: zoria.net sends no
    // CORS headers, so the dev server fetches them for the page (src/pages/use-field.ts).
    server: {
      proxy: {
        '/site': { target: 'https://zoria.net', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/site/, '') },
      },
    },
    build: single
      ? { outDir: 'dist-single', assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false }
      : {},
    test: {
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      environment: 'node',
    },
  }
})
