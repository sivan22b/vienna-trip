// Service worker: האפליקציה עובדת גם בלי אינטרנט
const VERSION = 'v8';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v1';
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'data.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/leaflet.css', 'fonts.css', 'img/edge-left.svg', 'img/edge-right.svg', 'fonts/ibm-plex-sans-hebrew-hebrew-400-normal.woff2', 'fonts/ibm-plex-sans-hebrew-hebrew-500-normal.woff2', 'fonts/ibm-plex-sans-hebrew-hebrew-600-normal.woff2', 'fonts/ibm-plex-sans-hebrew-latin-400-normal.woff2', 'fonts/ibm-plex-sans-hebrew-latin-500-normal.woff2', 'fonts/ibm-plex-sans-hebrew-latin-600-normal.woff2', 'fonts/karantina-hebrew-400-normal.woff2', 'fonts/karantina-hebrew-700-normal.woff2', 'fonts/karantina-latin-400-normal.woff2', 'fonts/karantina-latin-700-normal.woff2',
  'vendor/leaflet/leaflet.js',
];
const MAX_TILES = 600;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(ASSETS.map((a) => c.add(new Request(a, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES); const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // מזג אוויר וחיפוש מיקום: תמיד מהרשת (האפליקציה שומרת עותק אחרון בעצמה)
  if (/open-meteo\.com|nominatim/.test(url.host)) return;
  // אריחי מפה: מהמטמון קודם, כדי שמה שכבר ראיתם יעבוד בלי רשת
  if (url.host.endsWith('tile.openstreetmap.org')) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); } return res; }
      catch { return new Response('', { status: 504 }); }
    }));
    return;
  }
  // קבצי האפליקציה: קודם מהרשת (תמיד הגרסה העדכנית), ואם אין רשת מהמטמון
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const sameOrigin = url.origin === location.origin;
    try {
      const res = await fetch(sameOrigin ? new Request(req, { cache: 'no-cache' }) : req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    } catch {
      const hit = await c.match(req, { ignoreSearch: sameOrigin });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await c.match('index.html')) || (await c.match('./')) || Response.error();
      return Response.error();
    }
  }));
});
