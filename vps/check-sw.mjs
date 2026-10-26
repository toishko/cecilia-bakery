// The offline layer's rules, checked without a browser: public/sw.js runs in Node with a stand-in for the
// service worker's world (self, caches, fetch), and each kind of request is either answered and saved or left
// alone to go straight to the network. Run after any change to public/sw.js: node vps/check-sw.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://ceciliabakery.com';
const failures = [];
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !detail ? '' : `  (${detail})`));
  if (!ok) failures.push(name);
};

// A stand-in for the browser's saved copies: names → {url: response}
function makeCaches() {
  const store = new Map();
  const open = async (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const c = store.get(name);
    return {
      add: async (u) => c.set(new URL(u, SITE).href, new Response('offline page')),
      put: async (req, res) => c.set(typeof req === 'string' ? new URL(req, SITE).href : req.url, res),
      match: async (req) => c.get(typeof req === 'string' ? new URL(req, SITE).href : req.url),
    };
  };
  return {
    store, open,
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
    match: async (req) => {
      for (const c of store.values()) {
        const hit = c.get(typeof req === 'string' ? new URL(req, SITE).href : req.url);
        if (hit) return hit;
      }
    },
  };
}

function load({ online = true } = {}) {
  const handlers = {};
  const caches = makeCaches();
  const self = {
    location: new URL(SITE + '/sw.js'),
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => {}, clients: { claim: async () => {} },
    registration: { showNotification: async () => {} },
  };
  const fetch = async (req) => {
    if (!online) throw new TypeError('Failed to fetch');
    return new Response(`from the network: ${req.url}`, { status: 200 });
  };
  const ctx = vm.createContext({ self, caches, fetch, URL, Response, Request, console, Promise, setTimeout, clients: self.clients });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8'), ctx);
  return { handlers, caches };
}

// One request through the fetch rule: was it answered by the offline layer, what came back, what got saved
async function through(sw, url, { mode = 'no-cors', method = 'GET' } = {}) {
  let answered = null;
  const event = { request: new Request(url, { method }), respondWith: (p) => { answered = p; } };
  Object.defineProperty(event.request, 'mode', { value: mode });
  sw.handlers.fetch(event);
  const response = answered ? await answered : null;
  await new Promise((r) => setTimeout(r, 0));  // the save happens just after the answer
  const saved = !!(await sw.caches.match(url));
  return { answered: !!answered, saved, body: response ? await response.clone().text() : null };
}

const sw = load();
const kept = [
  [`${SITE}/admin-dashboard`, 'a page of the site'],
  [`${SITE}/assets/adminDashboard-CasTnLQ-.js`, "the site's own script"],
  ['https://fonts.googleapis.com/css2?family=Outfit', 'Google Fonts'],
  ['https://fonts.gstatic.com/s/outfit/v11/a.woff2', "Google Fonts' files"],
  ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', 'a library from cdn.jsdelivr.net'],
  ['https://unpkg.com/lucide@latest', 'a library from unpkg.com'],
];
for (const [url, what] of kept) {
  const r = await through(sw, url);
  check(`answered and saved: ${what}`, r.answered && r.saved, JSON.stringify(r));
}
const alone = [
  ['https://robust-wildcat-76.clerk.accounts.dev/v1/client?__clerk_db_jwt=x', "Clerk's sign-in reply (the test setup)"],
  ['https://robust-wildcat-76.clerk.accounts.dev/npm/@clerk/clerk-js@4.73.14/dist/clerk.browser.js', "Clerk's sign-in box"],
  ['https://clerk.ceciliabakery.com/v1/client', "Clerk's sign-in reply (the production setup)"],
  ['https://clerk.ceciliabakery.com/npm/@clerk/clerk-js@4.73.14/dist/clerk.browser.js', "Clerk's sign-in box (the production setup)"],
  ['https://accounts.google.com/gsi/client', 'Google sign-in'],
  ['https://db.ceciliabakery.com/rest/v1/profiles?select=role', 'the database'],
  ['https://db.ceciliabakery.com/storage/v1/object/public/product-images/a.jpg', "the database's files"],
  ['https://dykztphptnytbihpavpa.supabase.co/rest/v1/orders', 'the database on another address'],
  [`${SITE}/rest/v1/orders`, 'a database path on the site itself'],
  [`${SITE}/auth/v1/user`, 'a sign-in path on the site itself'],
  [`${SITE}/api/place-order`, "the site's own live answers (/api/)"],
  [`${SITE}/version.json`, "the site's version stamp"],
  ['https://systems.toisko.com/widget.js', "Toisko's systems"],
];
for (const [url, what] of alone) {
  const r = await through(sw, url);
  check(`left alone, never saved: ${what}`, !r.answered && !r.saved, JSON.stringify(r));
}
const post = await through(sw, `${SITE}/menu`, { method: 'POST' });
check('left alone: anything but GET', !post.answered);

// Starting a new version: old saved copies go, this version's (with the offline page) stays
const fresh = load();
await fresh.caches.open('cecilia-cache-v89');
await (await fresh.caches.open('cecilia-cache-v89')).put('https://robust-wildcat-76.clerk.accounts.dev/v1/client', new Response('old sign-in'));
let installing; fresh.handlers.install({ waitUntil: (p) => { installing = p; } }); await installing;
let activating; fresh.handlers.activate({ waitUntil: (p) => { activating = p; } }); await activating;
const names = await fresh.caches.keys();
check('starting: old saved copies are deleted (Clerk\'s old replies with them)', !names.includes('cecilia-cache-v89'), names.join(', '));
check('starting: the offline page is still saved', !!(await fresh.caches.match('/offline.html')), names.join(', '));

// Offline: a page opened before comes back from its saved copy, a page never opened gets the offline page
const off = load({ online: false });
let i2; off.handlers.install({ waitUntil: (p) => { i2 = p; } }); await i2;
let a2; off.handlers.activate({ waitUntil: (p) => { a2 = p; } }); await a2;
await (await off.caches.open([...off.caches.store.keys()][0])).put(`${SITE}/menu`, new Response('saved menu'));
const seen = await through(off, `${SITE}/menu`, { mode: 'navigate' });
check('offline: a page opened before comes back from its saved copy', seen.body === 'saved menu', seen.body);
const unseen = await through(off, `${SITE}/wholesale`, { mode: 'navigate' });
check('offline: a page never opened shows the offline page', unseen.body === 'offline page', unseen.body);
const clerkOff = await through(off, 'https://robust-wildcat-76.clerk.accounts.dev/v1/client');
check("offline: Clerk's request is left to the browser, no old copy handed back", !clerkOff.answered);

console.log(failures.length ? `\n${failures.length} failed` : '\nall offline layer checks passed');
process.exit(failures.length ? 1 : 0);
