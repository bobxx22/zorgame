/* HQ :: show server
   serves the built show directory and nothing else. No dependencies on
   purpose: a static server is forty lines, and an extra package in the
   image is one more way to fail to build on submission day.

   CSP is computed from the page itself at startup: hashes of the inline
   script and style blocks plus connect-src 'none'. This way the header
   allows exactly this bundle and nothing else - a show that reached out to
   the network for a font or data breaks for you, not on the broadcast
   (part 3, the HQ contract).

   Admission and the broadcast open the show in a frame with an opaque
   origin, where an external file cannot load in principle; so index.html
   must be self-sufficient. The server does not fix this - it only stays
   out of the way. */

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.env.HQ_ROOT || 'show');
const PORT = Number(process.env.HQ_PORT || 8080);
const HOST = process.env.HQ_HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/* hashes of the page's inline blocks: exactly these go into the CSP */
function hashes(html, tag) {
  const out = new Set();
  for (const m of html.matchAll(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'gi'))) {
    out.add("'sha256-" + createHash('sha256').update(m[1], 'utf8').digest('base64') + "'");
  }
  return [...out];
}

function policy(html) {
  const script = ["'unsafe-eval'", ...hashes(html, 'script')];
  const style = hashes(html, 'style');
  return [
    "default-src 'none'",
    'script-src ' + script.join(' '),
    'style-src ' + (style.length ? style.join(' ') : "'none'"),
    'font-src data:',
    'img-src data: blob:',
    /* the show computes the truth of the world in workers started from a blob of its own code */
    'worker-src blob:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const index = join(ROOT, 'index.html');
const csp = policy(readFileSync(index, 'utf8'));
const files = readdirSync(ROOT, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .length;

const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/livez') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end('{"status":"ok"}');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  /* only into the show directory: '..' in the address does not step out of it */
  const rel = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '');
  const path = url === '/' || url.endsWith('/') ? join(ROOT, rel, 'index.html') : join(ROOT, rel);
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  let body;
  try {
    if (!statSync(path).isFile()) throw new Error('not a file');
    body = readFileSync(path);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
    return;
  }
  const head = {
    'content-type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (path === index) head['content-security-policy'] = csp;
  res.writeHead(200, head);
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(PORT, HOST, () => {
  process.stdout.write('[hq] ' + HOST + ':' + PORT + ', files ' + files + '\n');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
