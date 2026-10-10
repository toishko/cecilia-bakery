// The bakery's site on its own server (the VPS), doing what Vercel did for it:
//  - serves the built pages from dist/, with the rewrites in vercel.json (/menu → /menu.html, …);
//  - runs each function in api/ at /api/<name>, with Vercel's request and response helpers
//    (req.body, req.query, req.cookies, res.status().json(), res.send(), res.redirect()).
// No framework and no outside packages. Traefik sits in front (HTTPS); this listens inside Docker only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SITE_ROOT || path.join(HERE, '..'));
const DIST = path.join(ROOT, 'dist');
const API = path.join(HERE, '.out', 'api');
const PORT = Number(process.env.PORT || 3000);
const require = createRequire(import.meta.url);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.map': 'application/json',
};

// vercel.json's rewrites: "/admin-dashboard/:path*" style sources, tried in order after the files themselves.
export function rewriteRules(config) {
  return (config.rewrites || []).map(({ source, destination }) => {
    const re = '^' + source.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\/:(\w+)\*/g, '(?:/(.*))?').replace(/:(\w+)/g, '([^/]+)') + '/?$';
    return { re: new RegExp(re), destination };
  });
}
const RULES = rewriteRules(JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')));

function fileFor(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  const full = path.join(DIST, p);
  if (!full.startsWith(DIST + path.sep) && full !== DIST) return null;
  for (const f of [full, path.join(full, 'index.html')]) {
    try { if (fs.statSync(f).isFile()) return f; } catch { /* not there */ }
  }
  return null;
}

export function resolvePage(urlPath) {
  const direct = fileFor(urlPath);
  if (direct) return { file: direct, status: 200 };
  for (const r of RULES) {
    if (r.re.test(urlPath)) {
      const f = fileFor(r.destination);
      if (f) return { file: f, status: 200 };
    }
  }
  const missing = fileFor('/404.html');
  return { file: missing, status: 404 };
}

function sendFile(req, res, { file, status }) {
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('404: NOT_FOUND');
  }
  const rel = path.relative(DIST, file);
  // Vite's hashed files never change; everything else is checked each time, as on Vercel.
  const cache = rel.startsWith('assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate';
  const stat = fs.statSync(file);
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const headers = { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
                    'cache-control': cache, etag };
  if (status === 200 && req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(status, { ...headers, 'content-length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------- the functions ----------

function bytes(limit) {
  const m = String(limit).trim().match(/^([\d.]+)\s*(b|kb|mb)?$/i);
  if (!m) return 4.5 * 1024 * 1024;
  return Math.floor(Number(m[1]) * { b: 1, kb: 1024, mb: 1024 * 1024 }[(m[2] || 'b').toLowerCase()]);
}

const handlers = new Map();
function load(name) {
  if (!/^[\w-]+$/.test(name)) return null;
  if (handlers.has(name)) return handlers.get(name);
  const file = path.join(API, name + '.cjs');
  if (!fs.existsSync(file)) return null;
  const mod = require(file);
  const fn = typeof mod === 'function' ? mod : (mod.default || mod.handler);
  const config = mod.config || (mod.default && mod.default.config) || {};
  // Vercel's default request body limit is 4.5 MB; a function may ask for more (voice-order: 10mb).
  const limit = bytes(config.api?.bodyParser?.sizeLimit || config.bodyParser?.sizeLimit || '4.5mb');
  const entry = typeof fn === 'function' ? { fn, limit } : null;
  handlers.set(name, entry);
  return entry;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {  // answer 413 and close; the rest of the upload is dropped, not stored
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error('too large'), { status: 413 }));
        return;
      }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

export function parseBody(buf, type) {
  if (!buf.length) return undefined;
  const t = (type || '').split(';')[0].trim().toLowerCase();
  if (t === 'application/json' || t.endsWith('+json')) {
    try { return JSON.parse(buf.toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  if (t === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(buf.toString('utf8')));
  if (t.startsWith('text/')) return buf.toString('utf8');
  return buf;
}

function query(url) {
  const q = {};
  for (const [k, v] of url.searchParams) q[k] = k in q ? [].concat(q[k], v) : v;
  return q;
}

function cookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function helpers(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => {
    if (body === undefined || body === null) { res.end(); return res; }
    if (Buffer.isBuffer(body)) {
      if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/octet-stream');
      res.end(body);
    } else if (typeof body === 'object') {
      return res.json(body);
    } else {
      if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(String(body));
    }
    return res;
  };
  res.redirect = (a, b) => {
    const [code, to] = b === undefined ? [307, a] : [a, b];
    res.writeHead(code, { location: to });
    res.end();
    return res;
  };
}

async function runFunction(name, req, res, url) {
  const entry = load(name);
  if (!entry) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('404: NOT_FOUND');
  }
  helpers(res);
  try {
    req.query = query(url);
    req.cookies = cookies(req.headers.cookie);
    req.body = parseBody(await readBody(req, entry.limit), req.headers['content-type']);
  } catch (e) {
    res.writeHead(e.status || 400, { 'content-type': 'text/plain; charset=utf-8', ...(e.status === 413 ? { connection: 'close' } : {}) });
    return res.end(e.status === 413 ? 'Request Entity Too Large' : e.message);
  }
  try {
    await entry.fn(req, res);
  } catch (e) {
    console.error(`api/${name}:`, e && e.stack || e);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('A server error has occurred');
    } else if (!res.writableEnded) res.end();
  }
}

export const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/api\/([^/]+?)\/?$/);
  if (m) return void runFunction(m[1], req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }
  sendFile(req, res, resolvePage(url.pathname));
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`the bakery's site on :${PORT} (${DIST})`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}
