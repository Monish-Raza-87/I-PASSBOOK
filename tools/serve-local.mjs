// Zero-dependency static server for local development.
//
//   node tools/serve-local.mjs            → http://localhost:3000/
//   node tools/serve-local.mjs 8080       → a different port
//
// Why this exists: `npx serve` (the command docs/08 used to recommend) needs to
// download the package on first run, which fails on a machine with no registry
// access and fails *silently* — no error, no server, just a browser that cannot
// reach localhost. This has no dependencies and cannot fail that way.
//
// It serves the repo root with two deliberate behaviours:
//
//   1. `Cache-Control: no-store` on everything. Without it the browser holds the
//      old CSS and you spend ten minutes wondering why an edit did nothing.
//      NOTE: the app registers a service worker, which caches the shell on its
//      own — a hard reload (Ctrl+Shift+R) or unregistering it in DevTools →
//      Application is still needed after a CSS or JS change.
//   2. A path that escapes the root is refused rather than served. It is only
//      ever localhost, but a static server that walks out of its root is a bad
//      habit to keep in a repo.
//
// Then open http://localhost:3000/?dev=1 — the `?dev=1` query parameter is the
// localhost-only auth bypass, so no account or password is needed, and backend
// calls are left unauthorized on purpose so the app falls back to demo data.
// Nothing you do there can write to the live store.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);

    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('403 — outside the served root');
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('404 — ' + rel);
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log('serving ' + ROOT);
    console.log('open    http://localhost:' + PORT + '/?dev=1');
    console.log('^ the ?dev=1 is the localhost-only dev sign-in — no password needed.');
    console.log('Ctrl+C to stop.');
  });
